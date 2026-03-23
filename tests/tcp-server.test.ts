import { createConnection, type Socket } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { PGlitePooler } from "../src/index.ts";
import { PGliteTCPMuxServer, PGliteTCPServer } from "../src/tcp.ts";
import { assertEquals, assertExists, describe, test } from "./compat.ts";

const TEST_PORT = 54399;

class PgWireClient {
	private socket: Socket;
	private buffer: Buffer = Buffer.alloc(0);
	private waiters: Array<(chunk: Buffer) => void> = [];

	private constructor(socket: Socket) {
		this.socket = socket;
		socket.on("data", (chunk: Buffer) => {
			this.buffer = Buffer.concat([this.buffer, chunk]);
			while (this.waiters.length > 0 && this.buffer.length > 0) {
				const waiter = this.waiters.shift();
				if (!waiter) break;
				waiter(this.buffer);
			}
		});
	}

	static connect(host: string, port: number): Promise<PgWireClient> {
		return new Promise((resolve, reject) => {
			const socket = createConnection({ host, port }, () => {
				resolve(new PgWireClient(socket));
			});
			socket.once("error", reject);
		});
	}

	private readBytes(n: number): Promise<Buffer> {
		return new Promise((resolve) => {
			const tryRead = () => {
				if (this.buffer.length >= n) {
					const chunk = this.buffer.subarray(0, n);
					this.buffer = this.buffer.subarray(n);
					resolve(Buffer.from(chunk));
				} else {
					this.waiters.push(() => tryRead());
				}
			};
			tryRead();
		});
	}

	private async readMessage(): Promise<{ type: string; body: Buffer }> {
		const typeBuf = await this.readBytes(1);
		const type = String.fromCharCode(typeBuf[0]);
		const lenBuf = await this.readBytes(4);
		const len = lenBuf.readInt32BE(0);
		const body = await this.readBytes(len - 4);
		return { type, body };
	}

	private parseRowDescription(body: Buffer): Array<{
		name: string;
		tableOid: number;
		attrNum: number;
		typeOid: number;
		typeSize: number;
		typeMod: number;
		formatCode: number;
	}> {
		const count = body.readInt16BE(0);
		let offset = 2;
		const fields = [];
		for (let i = 0; i < count; i++) {
			const nameEnd = body.indexOf(0, offset);
			const name = body.subarray(offset, nameEnd).toString("utf8");
			offset = nameEnd + 1;
			const tableOid = body.readInt32BE(offset);
			offset += 4;
			const attrNum = body.readInt16BE(offset);
			offset += 2;
			const typeOid = body.readInt32BE(offset);
			offset += 4;
			const typeSize = body.readInt16BE(offset);
			offset += 2;
			const typeMod = body.readInt32BE(offset);
			offset += 4;
			const formatCode = body.readInt16BE(offset);
			offset += 2;
			fields.push({
				name,
				tableOid,
				attrNum,
				typeOid,
				typeSize,
				typeMod,
				formatCode,
			});
		}
		return fields;
	}

	private parseDataRow(body: Buffer): Array<Buffer | null> {
		const count = body.readInt16BE(0);
		let offset = 2;
		const cols: Array<Buffer | null> = [];
		for (let i = 0; i < count; i++) {
			const len = body.readInt32BE(offset);
			offset += 4;
			if (len === -1) {
				cols.push(null);
			} else {
				cols.push(Buffer.from(body.subarray(offset, offset + len)));
				offset += len;
			}
		}
		return cols;
	}

	private parseErrorResponse(body: Buffer): { code: string; message: string } {
		let offset = 0;
		let code = "";
		let message = "";
		while (offset < body.length) {
			const fieldType = String.fromCharCode(body[offset]);
			offset++;
			if (fieldType === "\0") break;
			const end = body.indexOf(0, offset);
			const value = body.subarray(offset, end).toString("utf8");
			offset = end + 1;
			if (fieldType === "C") code = value;
			if (fieldType === "M") message = value;
		}
		return { code, message };
	}

	async startup(params: Record<string, string> = {}): Promise<void> {
		const defaultParams = { user: "postgres", database: "postgres", ...params };
		const pairs = Object.entries(defaultParams).flat();
		let bodyLen = 4;
		for (const s of pairs) bodyLen += Buffer.byteLength(s, "utf8") + 1;
		bodyLen += 1;

		const buf = Buffer.alloc(4 + bodyLen);
		buf.writeInt32BE(4 + bodyLen, 0);
		buf.writeInt32BE(196608, 4);
		let offset = 8;
		for (const s of pairs) {
			buf.write(s, offset, "utf8");
			offset += Buffer.byteLength(s, "utf8");
			buf[offset++] = 0;
		}
		buf[offset] = 0;
		this.socket.write(buf);

		await this.drainUntilReady();
	}

	private async drainUntilReady(): Promise<void> {
		while (true) {
			const msg = await this.readMessage();
			if (msg.type === "Z") return;
			if (msg.type === "E") {
				const err = this.parseErrorResponse(msg.body);
				throw Object.assign(new Error(err.message), { code: err.code });
			}
		}
	}

	async simpleQuery(sql: string): Promise<{
		fields: Array<{ name: string; typeOid: number }>;
		rows: Array<Array<Buffer | null>>;
		error: string | null;
		errorCode: string | null;
	}> {
		const sqlBuf = Buffer.from(`${sql}\0`, "utf8");
		const msg = Buffer.alloc(1 + 4 + sqlBuf.length);
		msg[0] = 0x51;
		msg.writeInt32BE(4 + sqlBuf.length, 1);
		sqlBuf.copy(msg, 5);
		this.socket.write(msg);

		const fields: Array<{ name: string; typeOid: number }> = [];
		const rows: Array<Array<Buffer | null>> = [];
		let error: string | null = null;
		let errorCode: string | null = null;

		while (true) {
			const { type, body } = await this.readMessage();
			if (type === "T") {
				const parsed = this.parseRowDescription(body);
				for (const f of parsed)
					fields.push({ name: f.name, typeOid: f.typeOid });
			} else if (type === "D") {
				rows.push(this.parseDataRow(body));
			} else if (type === "E") {
				const err = this.parseErrorResponse(body);
				error = err.message;
				errorCode = err.code;
			} else if (type === "Z") {
				break;
			}
		}

		return { fields, rows, error, errorCode };
	}

	async extendedQuery(
		sql: string,
		paramValues: Buffer[],
		resultFormats: number[] = [],
	): Promise<{
		fields: Array<{ name: string; typeOid: number }>;
		rows: Array<Array<Buffer | null>>;
		error: string | null;
		errorCode: string | null;
	}> {
		const encodeString = (s: string) => Buffer.from(`${s}\0`, "utf8");

		const writeMsgBuf = (type: number, body: Buffer): Buffer => {
			const out = Buffer.alloc(1 + 4 + body.length);
			out[0] = type;
			out.writeInt32BE(4 + body.length, 1);
			body.copy(out, 5);
			return out;
		};

		const stmtName = Buffer.alloc(1);
		const portalName = Buffer.alloc(1);

		const sqlBuf = encodeString(sql);
		const parseBody = Buffer.concat([
			stmtName,
			sqlBuf,
			Buffer.from([0, 0, 0, 0]),
		]);
		const parseMsg = writeMsgBuf(0x50, parseBody);

		const paramCount = paramValues.length;
		const bindBodyParts: Buffer[] = [portalName, stmtName];
		const paramFormatsBuf = Buffer.alloc(2 + paramCount * 2);
		paramFormatsBuf.writeInt16BE(paramCount, 0);
		for (let i = 0; i < paramCount; i++)
			paramFormatsBuf.writeInt16BE(0, 2 + i * 2);
		bindBodyParts.push(paramFormatsBuf);

		const paramCountBuf = Buffer.alloc(2);
		paramCountBuf.writeInt16BE(paramCount, 0);
		bindBodyParts.push(paramCountBuf);

		for (const v of paramValues) {
			const lenBuf = Buffer.alloc(4);
			lenBuf.writeInt32BE(v.length, 0);
			bindBodyParts.push(lenBuf, v);
		}

		const resultFormatCount = resultFormats.length;
		const resultFormatsBuf = Buffer.alloc(2 + resultFormatCount * 2);
		resultFormatsBuf.writeInt16BE(resultFormatCount, 0);
		for (let i = 0; i < resultFormatCount; i++)
			resultFormatsBuf.writeInt16BE(resultFormats[i], 2 + i * 2);
		bindBodyParts.push(resultFormatsBuf);

		const bindMsg = writeMsgBuf(0x42, Buffer.concat(bindBodyParts));

		const describeBody = Buffer.concat([Buffer.from([0x50]), portalName]);
		const describeMsg = writeMsgBuf(0x44, describeBody);

		const executeBody = Buffer.concat([portalName, Buffer.from([0, 0, 0, 0])]);
		const executeMsg = writeMsgBuf(0x45, executeBody);

		const syncMsg = writeMsgBuf(0x53, Buffer.alloc(0));

		this.socket.write(
			Buffer.concat([parseMsg, bindMsg, describeMsg, executeMsg, syncMsg]),
		);

		const fields: Array<{ name: string; typeOid: number }> = [];
		const rows: Array<Array<Buffer | null>> = [];
		let error: string | null = null;
		let errorCode: string | null = null;

		while (true) {
			const { type, body } = await this.readMessage();
			if (type === "T") {
				const parsed = this.parseRowDescription(body);
				for (const f of parsed)
					fields.push({ name: f.name, typeOid: f.typeOid });
			} else if (type === "D") {
				rows.push(this.parseDataRow(body));
			} else if (type === "E") {
				const err = this.parseErrorResponse(body);
				error = err.message;
				errorCode = err.code;
			} else if (type === "Z") {
				break;
			}
		}

		return { fields, rows, error, errorCode };
	}

	terminate(): void {
		const msg = Buffer.alloc(5);
		msg[0] = 0x58;
		msg.writeInt32BE(4, 1);
		this.socket.write(msg);
		this.socket.destroy();
	}
}

async function startServer() {
	const db = new PGlite();
	const pooler = await PGlitePooler.create(db);
	const server = new PGliteTCPServer(pooler);
	await server.start(TEST_PORT);
	return {
		db,
		server,
		async teardown() {
			await server.stop();
		},
	};
}

async function makeClient(): Promise<PgWireClient> {
	const client = await PgWireClient.connect("127.0.0.1", TEST_PORT);
	await client.startup();
	return client;
}

describe("PGliteTCPServer", () => {
	test("simple SELECT returns rows", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery("SELECT 1 AS num, 'hello' AS str");
			assertEquals(res.rows.length, 1);
			assertEquals(res.rows[0][0]?.toString(), "1");
			assertEquals(res.rows[0][1]?.toString(), "hello");
			assertEquals(res.fields[0].name, "num");
			assertEquals(res.fields[1].name, "str");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("CREATE TABLE and INSERT/SELECT round-trip", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery(
				"CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT)",
			);
			await client.simpleQuery(
				"INSERT INTO items (name) VALUES ('apple'), ('banana')",
			);
			const res = await client.simpleQuery(
				"SELECT name FROM items ORDER BY name",
			);
			assertEquals(res.rows.length, 2);
			assertEquals(res.rows[0][0]?.toString(), "apple");
			assertEquals(res.rows[1][0]?.toString(), "banana");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("parameterized query via extended protocol", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery(
				"CREATE TABLE products (id SERIAL PRIMARY KEY, price NUMERIC)",
			);
			await client.simpleQuery(
				"INSERT INTO products (price) VALUES (9.99), (19.99), (29.99)",
			);
			const res = await client.extendedQuery(
				"SELECT price FROM products WHERE price > $1 ORDER BY price",
				[Buffer.from("15")],
			);
			assertEquals(res.rows.length, 2);
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("multiple concurrent queries are serialized through pooler", async () => {
		const { teardown } = await startServer();
		const setupClient = await makeClient();
		try {
			await setupClient.simpleQuery("CREATE TABLE counters (val INT)");
			await setupClient.simpleQuery("INSERT INTO counters VALUES (0)");
			setupClient.terminate();

			await Promise.all(
				Array.from({ length: 10 }, async () => {
					const c = await PgWireClient.connect("127.0.0.1", TEST_PORT);
					await c.startup();
					await c.simpleQuery("UPDATE counters SET val = val + 1");
					c.terminate();
				}),
			);

			const resultClient = await makeClient();
			const res = await resultClient.simpleQuery("SELECT val FROM counters");
			assertEquals(res.rows[0][0]?.toString(), "10");
			resultClient.terminate();
		} finally {
			await teardown();
		}
	});

	test("SQL error returns error to client without crashing server", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const errRes = await client.simpleQuery(
				"SELECT * FROM nonexistent_table_xyz",
			);
			assertExists(errRes.error);

			const res = await client.simpleQuery("SELECT 42 AS val");
			assertEquals(res.rows[0][0]?.toString(), "42");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("NULL values are handled correctly", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery(
				"SELECT NULL::text AS n, 'hello' AS s",
			);
			assertEquals(res.rows[0][0], null);
			assertEquals(res.rows[0][1]?.toString(), "hello");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSONB columns are returned as parsed objects", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE docs (data JSONB)");
			await client.simpleQuery(
				`INSERT INTO docs VALUES ('{"key": "value", "num": 42}')`,
			);
			const res = await client.simpleQuery("SELECT data FROM docs");
			assertEquals(JSON.parse(res.rows[0][0]?.toString()), {
				key: "value",
				num: 42,
			});
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("multi-statement simple query returns last result", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE things (val INT)");
			await client.simpleQuery("INSERT INTO things VALUES (1)");
			const res = await client.simpleQuery(
				"SET statement_timeout = '5s'; SELECT val FROM things",
			);
			assertEquals(res.rows[0][0]?.toString(), "1");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("pg_catalog queries work (needed for postgres-meta)", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery(
				"SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' ORDER BY nspname",
			);
			const names = res.rows.map((r) => r[0]?.toString());
			assertExists(names.find((n) => n === "public"));
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("empty query does not throw", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery("");
			assertEquals(res.error, null);
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("SQLSTATE 23505 on unique violation", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE uniq_test (id INT PRIMARY KEY)");
			await client.simpleQuery("INSERT INTO uniq_test VALUES (1)");
			const res = await client.simpleQuery("INSERT INTO uniq_test VALUES (1)");
			assertEquals(res.errorCode, "23505");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("SQLSTATE 42P01 on missing table", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery("SELECT * FROM totally_missing_xyz");
			assertEquals(res.errorCode, "42P01");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("res.fields includes column name and dataTypeID", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery(
				"SELECT 1::int4 AS num, 'hi'::text AS str",
			);
			assertEquals(res.fields.length, 2);
			assertEquals(res.fields[0].name, "num");
			assertEquals(res.fields[1].name, "str");
			assertExists(res.fields[0].typeOid);
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("explicit BEGIN/COMMIT transaction works", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE tx_test (val INT)");
			await client.simpleQuery("BEGIN");
			await client.simpleQuery("INSERT INTO tx_test VALUES (42)");
			await client.simpleQuery("COMMIT");
			const res = await client.simpleQuery("SELECT val FROM tx_test");
			assertEquals(res.rows[0][0]?.toString(), "42");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("explicit BEGIN/ROLLBACK discards changes", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE tx_rollback_test (val INT)");
			await client.simpleQuery("BEGIN");
			await client.simpleQuery("INSERT INTO tx_rollback_test VALUES (99)");
			await client.simpleQuery("ROLLBACK");
			const res = await client.simpleQuery(
				"SELECT COUNT(*) AS cnt FROM tx_rollback_test",
			);
			assertEquals(res.rows[0][0]?.toString(), "0");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("multi-statement with error rolls back prior inserts", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE multi_rollback (val INT)");
			const errRes = await client.simpleQuery(
				"INSERT INTO multi_rollback VALUES (1); SELECT * FROM missing_xyz_table",
			);
			assertExists(errRes.error);
			const res = await client.simpleQuery(
				"SELECT COUNT(*) AS cnt FROM multi_rollback",
			);
			assertEquals(res.rows[0][0]?.toString(), "0");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("real OIDs reported in RowDescription (not all OID 25)", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery(
				"SELECT 1::int4 AS a, true AS b, 3.14::float8 AS c, 'x'::text AS d",
			);
			const byName = Object.fromEntries(
				res.fields.map((f) => [f.name, f.typeOid]),
			);
			assertEquals(byName.a, 23);
			assertEquals(byName.b, 16);
			assertEquals(byName.c, 701);
			assertEquals(byName.d, 25);
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("binary encoding: common types round-trip via extended protocol", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.extendedQuery(
				"SELECT 42::int4 AS i4, TRUE AS b, '550e8400-e29b-41d4-a716-446655440000'::uuid AS id",
				[],
				[1, 1, 1],
			);
			const i4Field = res.rows[0]?.[0] ?? Buffer.alloc(0);
			assertEquals(i4Field.length, 4);
			assertEquals(i4Field.readInt32BE(0), 42);
			const boolField = res.rows[0]?.[1] ?? Buffer.alloc(0);
			assertEquals(boolField[0], 1);
			const uuidField = res.rows[0]?.[2] ?? Buffer.alloc(0);
			assertEquals(uuidField.length, 16);
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("binary encoding: jsonb column returns parsed object", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE jsonb_bin (data JSONB)");
			await client.extendedQuery("INSERT INTO jsonb_bin VALUES ($1)", [
				Buffer.from('{"x":1}'),
			]);
			const res = await client.extendedQuery(
				"SELECT data FROM jsonb_bin",
				[],
				[1],
			);
			const raw = res.rows[0]?.[0] ?? Buffer.alloc(0);
			assertEquals(raw[0], 1);
			assertEquals(JSON.parse(raw.subarray(1).toString("utf8")), { x: 1 });
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSON type stores and retrieves text representation", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE json_docs (data JSON)");
			await client.simpleQuery(
				`INSERT INTO json_docs VALUES ('{"name":"alice","score":99}')`,
			);
			const res = await client.simpleQuery("SELECT data FROM json_docs");
			assertEquals(JSON.parse(res.rows[0][0]?.toString() ?? ""), {
				name: "alice",
				score: 99,
			});
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSON type OID is 114, JSONB type OID is 3802", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE json_oid_test (j JSON, jb JSONB)");
			await client.simpleQuery(`INSERT INTO json_oid_test VALUES ('{}', '{}')`);
			const res = await client.simpleQuery("SELECT j, jb FROM json_oid_test");
			const byName = Object.fromEntries(
				res.fields.map((f) => [f.name, f.typeOid]),
			);
			assertEquals(byName.j, 114);
			assertEquals(byName.jb, 3802);
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSONB ->> operator extracts text field", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE events (payload JSONB)");
			await client.simpleQuery(
				`INSERT INTO events VALUES ('{"type":"click","user":"bob"}')`,
			);
			const res = await client.simpleQuery(
				"SELECT payload->>'type' AS event_type FROM events",
			);
			assertEquals(res.rows[0][0]?.toString(), "click");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSONB -> operator extracts nested object", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE nested (data JSONB)");
			await client.simpleQuery(
				`INSERT INTO nested VALUES ('{"meta":{"version":2}}')`,
			);
			const res = await client.simpleQuery(
				"SELECT data->'meta' AS meta FROM nested",
			);
			assertEquals(JSON.parse(res.rows[0][0]?.toString() ?? ""), {
				version: 2,
			});
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSONB @> containment operator filters rows", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE tags (data JSONB)");
			await client.simpleQuery(
				`INSERT INTO tags VALUES ('{"role":"admin","active":true}'), ('{"role":"user","active":true}'), ('{"role":"admin","active":false}')`,
			);
			const res = await client.simpleQuery(
				`SELECT data->>'role' AS role FROM tags WHERE data @> '{"role":"admin","active":true}'`,
			);
			assertEquals(res.rows.length, 1);
			assertEquals(res.rows[0][0]?.toString(), "admin");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSONB array elements: ->> returns text, -> returns JSON-encoded value", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE lists (items JSONB)");
			await client.simpleQuery(`INSERT INTO lists VALUES ('["a","b","c"]')`);
			const res = await client.simpleQuery(
				"SELECT items->>0 AS text_val, items->>1 AS text_val2 FROM lists",
			);
			assertEquals(res.rows[0][0]?.toString(), "a");
			assertEquals(res.rows[0][1]?.toString(), "b");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("jsonb_set updates a nested field", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE settings (cfg JSONB)");
			await client.simpleQuery(
				`INSERT INTO settings VALUES ('{"theme":"light","lang":"en"}')`,
			);
			const res = await client.simpleQuery(
				`SELECT jsonb_set(cfg, '{theme}', '"dark"')::text AS updated FROM settings`,
			);
			assertEquals(JSON.parse(res.rows[0][0]?.toString() ?? "").theme, "dark");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("json_build_object constructs JSON from arguments", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			const res = await client.simpleQuery(
				`SELECT json_build_object('id', 1, 'name', 'alice')::text AS obj`,
			);
			assertEquals(JSON.parse(res.rows[0][0]?.toString() ?? ""), {
				id: 1,
				name: "alice",
			});
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSONB NULL value is stored and returned as SQL NULL", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE nullable_json (data JSONB)");
			await client.simpleQuery("INSERT INTO nullable_json VALUES (NULL)");
			const res = await client.simpleQuery("SELECT data FROM nullable_json");
			assertEquals(res.rows[0][0], null);
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("JSONB parameterized insert and retrieval via extended protocol", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE param_json (data JSONB)");
			const payload = JSON.stringify({ action: "login", uid: 42 });
			await client.extendedQuery("INSERT INTO param_json VALUES ($1)", [
				Buffer.from(payload),
			]);
			const res = await client.simpleQuery(
				"SELECT data->>'action' AS action FROM param_json",
			);
			assertEquals(res.rows[0][0]?.toString(), "login");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("json_agg returns JSON array not Postgres text array format", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE scores (name TEXT, pts INT)");
			await client.simpleQuery(
				"INSERT INTO scores VALUES ('alice',10),('bob',20)",
			);
			const res = await client.simpleQuery(
				"SELECT json_agg(scores ORDER BY pts) AS arr FROM scores",
			);
			const raw = res.rows[0][0]?.toString() ?? "";
			assertExists(raw.startsWith("["), `expected JSON array, got: ${raw}`);
			const arr = JSON.parse(raw);
			assertEquals(arr.length, 2);
			assertEquals(arr[0].name, "alice");
			assertEquals(arr[1].name, "bob");
		} finally {
			client.terminate();
			await teardown();
		}
	});

	test("jsonb_agg returns valid JSON array not Postgres text array format", async () => {
		const { teardown } = await startServer();
		const client = await makeClient();
		try {
			await client.simpleQuery("CREATE TABLE items (label TEXT, val INT)");
			await client.simpleQuery("INSERT INTO items VALUES ('x',1),('y',2)");
			const res = await client.simpleQuery(
				"SELECT jsonb_agg(items ORDER BY val) AS agg FROM items",
			);
			const raw = res.rows[0][0]?.toString() ?? "";
			assertExists(raw.startsWith("["), `expected JSON array, got: ${raw}`);
			const arr = JSON.parse(raw);
			assertEquals(arr.length, 2);
			assertEquals(arr[0].label, "x");
		} finally {
			client.terminate();
			await teardown();
		}
	});
});

const PG_CLIENT_PORT = 54397;

async function startClientServer() {
	const db = new PGlite();
	const pooler = await PGlitePooler.create(db);
	const server = new PGliteTCPServer(pooler);
	await server.start(PG_CLIENT_PORT);
	return {
		db,
		server,
		async teardown() {
			await server.stop();
		},
	};
}

describe("JSON/JSONB via pg.Client (ORM-level compatibility)", () => {
	test("pg.Client parses JSONB column as JavaScript object", async () => {
		const { teardown } = await startClientServer();
		const client = new pg.Client({
			connectionString: `postgresql://postgres@127.0.0.1:${PG_CLIENT_PORT}/postgres`,
		});
		await client.connect();
		try {
			await client.query("CREATE TABLE pg_jsonb (data JSONB)");
			await client.query("INSERT INTO pg_jsonb VALUES ($1)", [
				'{"name":"alice","score":42}',
			]);
			const res = await client.query("SELECT data FROM pg_jsonb");
			assertEquals(res.rows[0].data.name, "alice");
			assertEquals(res.rows[0].data.score, 42);
		} finally {
			await client.end();
			await teardown();
		}
	});

	test("pg.Client parses JSON column as JavaScript object", async () => {
		const { teardown } = await startClientServer();
		const client = new pg.Client({
			connectionString: `postgresql://postgres@127.0.0.1:${PG_CLIENT_PORT}/postgres`,
		});
		await client.connect();
		try {
			await client.query("CREATE TABLE pg_json (data JSON)");
			await client.query("INSERT INTO pg_json VALUES ($1)", [
				'{"active":true,"count":7}',
			]);
			const res = await client.query("SELECT data FROM pg_json");
			assertEquals(res.rows[0].data.active, true);
			assertEquals(res.rows[0].data.count, 7);
		} finally {
			await client.end();
			await teardown();
		}
	});

	test("pg.Client handles jsonb_agg result as parsed array", async () => {
		const { teardown } = await startClientServer();
		const client = new pg.Client({
			connectionString: `postgresql://postgres@127.0.0.1:${PG_CLIENT_PORT}/postgres`,
		});
		await client.connect();
		try {
			await client.query("CREATE TABLE pg_agg_test (label TEXT, val INT)");
			await client.query("INSERT INTO pg_agg_test VALUES ('x',1),('y',2)");
			const res = await client.query(
				"SELECT jsonb_agg(pg_agg_test ORDER BY val) AS agg FROM pg_agg_test",
			);
			const agg = res.rows[0].agg;
			assertEquals(Array.isArray(agg), true);
			assertEquals(agg.length, 2);
			assertEquals(agg[0].label, "x");
			assertEquals(agg[1].label, "y");
		} finally {
			await client.end();
			await teardown();
		}
	});

	test("pg.Client handles NULL JSONB column as null", async () => {
		const { teardown } = await startClientServer();
		const client = new pg.Client({
			connectionString: `postgresql://postgres@127.0.0.1:${PG_CLIENT_PORT}/postgres`,
		});
		await client.connect();
		try {
			await client.query("CREATE TABLE pg_null_json (id INT, data JSONB)");
			await client.query("INSERT INTO pg_null_json VALUES (1, NULL)");
			const res = await client.query("SELECT data FROM pg_null_json");
			assertEquals(res.rows[0].data, null);
		} finally {
			await client.end();
			await teardown();
		}
	});

	test("pg.Client JSONB parameterized insert and round-trip", async () => {
		const { teardown } = await startClientServer();
		const client = new pg.Client({
			connectionString: `postgresql://postgres@127.0.0.1:${PG_CLIENT_PORT}/postgres`,
		});
		await client.connect();
		try {
			await client.query("CREATE TABLE pg_param_json (data JSONB)");
			await client.query("INSERT INTO pg_param_json VALUES ($1)", [
				JSON.stringify({ action: "login", uid: 99 }),
			]);
			const res = await client.query(
				"SELECT data->>'action' AS action, (data->>'uid')::int AS uid FROM pg_param_json",
			);
			assertEquals(res.rows[0].action, "login");
			assertEquals(res.rows[0].uid, 99);
		} finally {
			await client.end();
			await teardown();
		}
	});
});

const MUX_PORT = 54398;

describe("PGliteTCPMuxServer", () => {
	test("routes by username to correct tenant database", async () => {
		const dbA = new PGlite();
		const dbB = new PGlite();
		const poolerA = await PGlitePooler.create(dbA);
		const poolerB = await PGlitePooler.create(dbB);
		await dbA.exec("CREATE TABLE tenant_a_data (val TEXT)");
		await dbA.exec("INSERT INTO tenant_a_data VALUES ('from-a')");
		await dbB.exec("CREATE TABLE tenant_b_data (val TEXT)");
		await dbB.exec("INSERT INTO tenant_b_data VALUES ('from-b')");

		const mux = new PGliteTCPMuxServer(async (user) => {
			if (user === "tenant-a") return { pooler: poolerA, password: "" };
			if (user === "tenant-b") return { pooler: poolerB, password: "" };
			return null;
		});
		await mux.start(MUX_PORT);

		try {
			const clientA = new pg.Client({
				connectionString: `postgresql://tenant-a@127.0.0.1:${MUX_PORT}/postgres`,
			});
			const clientB = new pg.Client({
				connectionString: `postgresql://tenant-b@127.0.0.1:${MUX_PORT}/postgres`,
			});
			await clientA.connect();
			await clientB.connect();
			try {
				const resA = await clientA.query("SELECT val FROM tenant_a_data");
				const resB = await clientB.query("SELECT val FROM tenant_b_data");
				assertEquals(resA.rows[0].val, "from-a");
				assertEquals(resB.rows[0].val, "from-b");
			} finally {
				await clientA.end();
				await clientB.end();
			}
		} finally {
			await mux.stop();
			await poolerA.stop();
			await poolerB.stop();
		}
	});

	test("unknown user causes connection error", async () => {
		const mux = new PGliteTCPMuxServer(async () => null);
		await mux.start(MUX_PORT);
		try {
			const client = new pg.Client({
				connectionString: `postgresql://unknown@127.0.0.1:${MUX_PORT}/postgres`,
			});
			let caught: Error | null = null;
			try {
				await client.connect();
			} catch (e) {
				caught = e as Error;
			} finally {
				client.end().catch(() => {});
			}
			assertExists(caught);
		} finally {
			await mux.stop();
		}
	});

	test("wrong password causes auth failure", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		const mux = new PGliteTCPMuxServer(async (user) => {
			if (user === "myuser") return { pooler, password: "secret" };
			return null;
		});
		await mux.start(MUX_PORT);
		try {
			const client = new pg.Client({
				connectionString: `postgresql://myuser:wrongpass@127.0.0.1:${MUX_PORT}/postgres`,
			});
			let caught: (Error & { code?: string }) | null = null;
			try {
				await client.connect();
			} catch (e) {
				caught = e as Error & { code?: string };
			} finally {
				client.end().catch(() => {});
			}
			assertExists(caught);
			assertEquals(caught?.code, "28P01");
		} finally {
			await mux.stop();
			await pooler.stop();
		}
	});

	test("correct password allows query", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		const mux = new PGliteTCPMuxServer(async (user) => {
			if (user === "myuser") return { pooler, password: "secret" };
			return null;
		});
		await mux.start(MUX_PORT);
		try {
			const client = new pg.Client({
				connectionString: `postgresql://myuser:secret@127.0.0.1:${MUX_PORT}/postgres`,
			});
			await client.connect();
			try {
				const res = await client.query("SELECT 'connected' AS answer");
				assertEquals(res.rows[0].answer, "connected");
			} finally {
				await client.end();
			}
		} finally {
			await mux.stop();
			await pooler.stop();
		}
	});

	test("concurrent connections to different tenants return correct data", async () => {
		const dbA = new PGlite();
		const dbB = new PGlite();
		const poolerA = await PGlitePooler.create(dbA);
		const poolerB = await PGlitePooler.create(dbB);
		await dbA.exec("CREATE TABLE items (name TEXT)");
		await dbA.exec("INSERT INTO items VALUES ('alpha')");
		await dbB.exec("CREATE TABLE items (name TEXT)");
		await dbB.exec("INSERT INTO items VALUES ('beta')");

		const mux = new PGliteTCPMuxServer(async (user) => {
			if (user === "tenant-a") return { pooler: poolerA, password: "" };
			if (user === "tenant-b") return { pooler: poolerB, password: "" };
			return null;
		});
		await mux.start(MUX_PORT);

		try {
			const [resA, resB] = await Promise.all([
				(async () => {
					const c = new pg.Client({
						connectionString: `postgresql://tenant-a@127.0.0.1:${MUX_PORT}/postgres`,
					});
					await c.connect();
					const r = await c.query("SELECT name FROM items");
					await c.end();
					return r;
				})(),
				(async () => {
					const c = new pg.Client({
						connectionString: `postgresql://tenant-b@127.0.0.1:${MUX_PORT}/postgres`,
					});
					await c.connect();
					const r = await c.query("SELECT name FROM items");
					await c.end();
					return r;
				})(),
			]);
			assertEquals(resA.rows[0].name, "alpha");
			assertEquals(resB.rows[0].name, "beta");
		} finally {
			await mux.stop();
			await poolerA.stop();
			await poolerB.stop();
		}
	});

	test("async route with delay still connects and queries", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		const mux = new PGliteTCPMuxServer(async (user) => {
			if (user !== "slowuser") return null;
			await new Promise((r) => setTimeout(r, 50));
			return { pooler, password: "" };
		});
		await mux.start(MUX_PORT);
		try {
			const client = new pg.Client({
				connectionString: `postgresql://slowuser@127.0.0.1:${MUX_PORT}/postgres`,
			});
			await client.connect();
			try {
				const res = await client.query("SELECT 'async-ok' AS status");
				assertEquals(res.rows[0].status, "async-ok");
			} finally {
				await client.end();
			}
		} finally {
			await mux.stop();
			await pooler.stop();
		}
	});
});
