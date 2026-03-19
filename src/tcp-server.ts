import { Buffer } from "node:buffer";
import { createServer, type Server, type Socket } from "node:net";
import type { PGlite } from "@electric-sql/pglite";
import { AuthHandler } from "./auth/handler.ts";
import { PGlitePooler } from "./pooler.ts";
import { StorageHandler } from "./storage/handler.ts";
import type { PoolerConfig, QueryResult } from "./types.ts";

interface PreparedStatement {
	query: string;
}

interface Portal {
	query: string;
	params: (string | null)[];
	result: QueryResult;
}

interface ConnectionState {
	buffer: Buffer;
	startupDone: boolean;
	statements: Map<string, PreparedStatement>;
	portals: Map<string, Portal>;
	processing: boolean;
	errorState: boolean;
}

export interface TCPServerOptions {
	host?: string;
	port?: number;
}

export class PGliteTCPServer {
	private readonly pooler: PGlitePooler;
	private server: Server | null = null;
	private readonly connections = new Map<Socket, ConnectionState>();

	constructor(pooler: PGlitePooler) {
		this.pooler = pooler;
	}

	static async create(
		db: PGlite,
		config?: Partial<PoolerConfig>,
	): Promise<PGliteTCPServer> {
		const auth = new AuthHandler(db);
		const storage = new StorageHandler(db);
		await auth.initialize();
		await storage.initialize();
		const pooler = await PGlitePooler.create(db, config);
		return new PGliteTCPServer(pooler);
	}

	async start(port = 5432, host = "127.0.0.1"): Promise<void> {
		this.server = createServer((socket: Socket) => {
			this.connections.set(socket, {
				buffer: Buffer.alloc(0),
				startupDone: false,
				statements: new Map(),
				portals: new Map(),
				processing: false,
				errorState: false,
			});

			socket.on("data", (data: Buffer) => {
				const state = this.connections.get(socket);
				if (!state) return;
				state.buffer = Buffer.concat([state.buffer, data]);
				this.drain(socket, state).catch(() => {});
			});

			socket.on("close", () => this.connections.delete(socket));
			socket.on("error", () => this.connections.delete(socket));
		});

		return new Promise((resolve, reject) => {
			this.server!.on("error", reject);
			this.server!.listen(port, host, () => resolve());
		});
	}

	async stop(): Promise<void> {
		for (const socket of this.connections.keys()) socket.destroy();
		this.connections.clear();
		await this.pooler.stop();
		return new Promise((resolve) => {
			if (!this.server) return resolve();
			this.server.close(() => resolve());
		});
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.stop();
	}

	private async drain(socket: Socket, state: ConnectionState): Promise<void> {
		if (state.processing) return;
		state.processing = true;
		try {
			while (state.buffer.length > 0) {
				if (!state.startupDone) {
					if (!this.handleStartup(socket, state)) break;
				} else {
					const msg = this.readMessage(state);
					if (!msg) break;
					await this.handleMessage(socket, state, msg.type, msg.body);
				}
			}
		} finally {
			state.processing = false;
			if (state.buffer.length > 0) this.drain(socket, state).catch(() => {});
		}
	}

	private handleStartup(socket: Socket, state: ConnectionState): boolean {
		if (state.buffer.length < 8) return false;
		const len = state.buffer.readInt32BE(0);
		if (state.buffer.length < len) return false;
		const code = state.buffer.readInt32BE(4);
		state.buffer = state.buffer.slice(len);

		if (code === 80877103) {
			// SSL request → reject
			socket.write(Buffer.from("N"));
			return true;
		}
		if (code === 196608) {
			// Protocol 3.0 → accept
			state.startupDone = true;
			socket.write(this.buildStartupResponse());
		}
		return true;
	}

	private readMessage(
		state: ConnectionState,
	): { type: number; body: Buffer } | null {
		if (state.buffer.length < 5) return null;
		const len = state.buffer.readInt32BE(1);
		if (state.buffer.length < 1 + len) return null;
		const type = state.buffer.readUInt8(0);
		const body = state.buffer.slice(5, 1 + len);
		state.buffer = state.buffer.slice(1 + len);
		return { type, body };
	}

	private async handleMessage(
		socket: Socket,
		state: ConnectionState,
		type: number,
		body: Buffer,
	): Promise<void> {
		if (state.errorState) {
			if (type === 0x53) {
				state.errorState = false;
				socket.write(this.buildReadyForQuery());
			} else if (type === 0x58) socket.end();
			return;
		}
		switch (type) {
			case 0x51:
				await this.onSimpleQuery(socket, body);
				break;
			case 0x50:
				this.onParse(socket, state, body);
				break;
			case 0x42:
				await this.onBind(socket, state, body);
				break;
			case 0x44:
				this.onDescribe(socket, state, body);
				break;
			case 0x45:
				this.onExecute(socket, state, body);
				break;
			case 0x53:
				socket.write(this.buildReadyForQuery());
				break;
			case 0x48:
				break;
			case 0x43:
				socket.write(this.msg(0x33, Buffer.alloc(0)));
				break;
			case 0x58:
				socket.end();
				break;
		}
	}

	private async onSimpleQuery(socket: Socket, body: Buffer): Promise<void> {
		const sql = body.slice(0, -1).toString("utf8");
		const bufs: Buffer[] = [];
		try {
			const result = await this.execute(sql);
			bufs.push(...this.buildResultMessages(result, sql));
		} catch (err) {
			bufs.push(this.buildError(err));
		}
		bufs.push(this.buildReadyForQuery());
		socket.write(Buffer.concat(bufs));
	}

	private onParse(socket: Socket, state: ConnectionState, body: Buffer): void {
		const nameEnd = body.indexOf(0);
		const name = body.slice(0, nameEnd).toString();
		const queryEnd = body.indexOf(0, nameEnd + 1);
		const query = body.slice(nameEnd + 1, queryEnd).toString();
		state.statements.set(name, { query });
		socket.write(this.msg(0x31, Buffer.alloc(0)));
	}

	private async onBind(
		socket: Socket,
		state: ConnectionState,
		body: Buffer,
	): Promise<void> {
		let offset = 0;
		const portalEnd = body.indexOf(0, offset);
		const portalName = body.slice(offset, portalEnd).toString();
		offset = portalEnd + 1;

		const stmtEnd = body.indexOf(0, offset);
		const stmtName = body.slice(offset, stmtEnd).toString();
		offset = stmtEnd + 1;

		const formatCount = body.readInt16BE(offset);
		offset += 2;
		offset += formatCount * 2;

		const paramCount = body.readInt16BE(offset);
		offset += 2;
		const params: (string | null)[] = [];
		for (let i = 0; i < paramCount; i++) {
			const len = body.readInt32BE(offset);
			offset += 4;
			if (len === -1) {
				params.push(null);
			} else {
				params.push(body.slice(offset, offset + len).toString("utf8"));
				offset += len;
			}
		}

		const query = state.statements.get(stmtName)?.query ?? "";

		let result: QueryResult | null = null;
		try {
			result = await this.execute(query, params.length ? params : undefined);
		} catch (err) {
			state.errorState = true;
			socket.write(this.buildError(err));
			return;
		}

		state.portals.set(portalName, { query, params, result: result! });
		socket.write(this.msg(0x32, Buffer.alloc(0)));
	}

	private onDescribe(
		socket: Socket,
		state: ConnectionState,
		body: Buffer,
	): void {
		const kind = body[0];
		if (kind === 0x53) {
			const pd = Buffer.alloc(2);
			pd.writeInt16BE(0, 0);
			socket.write(this.msg(0x74, pd));
		}
		if (kind === 0x50) {
			const portalName = body.slice(1, body.indexOf(0, 1)).toString();
			const portal = state.portals.get(portalName);
			const fields = portal?.result?.fields;
			if (fields && fields.length > 0) {
				socket.write(
					this.buildRowDescription(
						fields as { name: string; dataTypeID: number }[],
					),
				);
			} else {
				socket.write(this.msg(0x6e, Buffer.alloc(0)));
			}
		}
	}

	private onExecute(
		socket: Socket,
		state: ConnectionState,
		body: Buffer,
	): void {
		const portalEnd = body.indexOf(0);
		const portalName = body.slice(0, portalEnd).toString();
		const portal = state.portals.get(portalName);

		const bufs: Buffer[] = [];
		if (portal) {
			const { rows, fields } = portal.result as {
				rows: Record<string, unknown>[];
				fields?: { name: string; dataTypeID: number }[];
			};
			if (fields && fields.length > 0) {
				for (const row of rows ?? []) bufs.push(this.buildDataRow(row, fields));
			}
			bufs.push(
				this.msg(
					0x43,
					this.cstring(commandTag(portal.query, rows?.length ?? 0)),
				),
			);
		} else {
			bufs.push(this.msg(0x43, this.cstring("OK")));
		}
		socket.write(Buffer.concat(bufs));
	}

	private async execute(
		sql: string,
		params?: (string | null)[],
	): Promise<QueryResult> {
		if (/pg_stat_statements/i.test(sql)) return { rows: [], fields: [] };
		try {
			return await this.pooler.query(sql, params);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("multiple commands") && !params?.length) {
				return await this.executeMulti(sql);
			}
			throw err;
		}
	}

	private async executeMulti(sql: string): Promise<QueryResult> {
		const statements = splitStatements(sql);
		let last: QueryResult = { rows: [], fields: [] };
		for (const stmt of statements) {
			last = await this.pooler.query(stmt);
		}
		return last;
	}

	private buildStartupResponse(): Buffer {
		const parts: Buffer[] = [this.msg(0x52, this.int32(0))];
		for (const [k, v] of [
			["server_version", "15.1"],
			["client_encoding", "UTF8"],
			["DateStyle", "ISO, MDY"],
			["TimeZone", "UTC"],
			["integer_datetimes", "on"],
		] as [string, string][]) {
			parts.push(
				this.msg(0x53, Buffer.concat([this.cstring(k), this.cstring(v)])),
			);
		}
		parts.push(this.msg(0x4b, Buffer.concat([this.int32(1), this.int32(0)])));
		parts.push(this.buildReadyForQuery());
		return Buffer.concat(parts);
	}

	private buildResultMessages(result: QueryResult, sql: string): Buffer[] {
		const { rows, fields } = result as {
			rows: Record<string, unknown>[];
			fields?: { name: string; dataTypeID: number }[];
		};
		const bufs: Buffer[] = [];
		if (fields && fields.length > 0) {
			bufs.push(this.buildRowDescription(fields));
			for (const row of rows ?? []) bufs.push(this.buildDataRow(row, fields));
		}
		bufs.push(this.msg(0x43, this.cstring(commandTag(sql, rows?.length ?? 0))));
		return bufs;
	}

	private buildRowDescription(
		fields: { name: string; dataTypeID: number }[],
	): Buffer {
		const header = Buffer.alloc(2);
		header.writeInt16BE(fields.length, 0);
		const parts: Buffer[] = [header];
		for (const f of fields) {
			parts.push(
				this.cstring(f.name),
				this.int32(0),
				this.int16(0),
				this.int32(f.dataTypeID || 25),
				this.int16(-1),
				this.int32(-1),
				this.int16(0),
			);
		}
		return this.msg(0x54, Buffer.concat(parts));
	}

	private buildDataRow(
		row: Record<string, unknown>,
		fields: { name: string }[],
	): Buffer {
		const parts: Buffer[] = [this.int16(fields.length)];
		for (const f of fields) {
			const val = row[f.name];
			if (val === null || val === undefined) {
				parts.push(this.int32(-1));
			} else {
				const bytes = Buffer.from(
					typeof val === "object" ? JSON.stringify(val) : String(val),
					"utf8",
				);
				parts.push(this.int32(bytes.length), bytes);
			}
		}
		return this.msg(0x44, Buffer.concat(parts));
	}

	private buildReadyForQuery(): Buffer {
		return this.msg(0x5a, Buffer.from("I"));
	}

	private buildError(err: unknown): Buffer {
		const message = err instanceof Error ? err.message : String(err);
		return this.msg(
			0x45,
			Buffer.concat([
				Buffer.from("S"),
				this.cstring("ERROR"),
				Buffer.from("C"),
				this.cstring("XX000"),
				Buffer.from("M"),
				this.cstring(message),
				Buffer.from([0]),
			]),
		);
	}

	private msg(type: number, body: Buffer): Buffer {
		const out = Buffer.alloc(5 + body.length);
		out[0] = type;
		out.writeInt32BE(4 + body.length, 1);
		body.copy(out, 5);
		return out;
	}

	private cstring(s: string): Buffer {
		return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
	}

	private int32(n: number): Buffer {
		const b = Buffer.alloc(4);
		b.writeInt32BE(n, 0);
		return b;
	}

	private int16(n: number): Buffer {
		const b = Buffer.alloc(2);
		b.writeInt16BE(n, 0);
		return b;
	}
}

function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = "";
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "'") {
			let j = i + 1;
			while (j < sql.length) {
				if (sql[j] === "'" && sql[j + 1] === "'") {
					j += 2;
					continue;
				}
				if (sql[j] === "'") {
					j++;
					break;
				}
				j++;
			}
			current += sql.slice(i, j);
			i = j;
			continue;
		}
		if (sql[i] === "$") {
			const tagEnd = sql.indexOf("$", i + 1);
			if (tagEnd !== -1) {
				const tag = sql.slice(i, tagEnd + 1);
				const closeIdx = sql.indexOf(tag, tagEnd + 1);
				if (closeIdx !== -1) {
					current += sql.slice(i, closeIdx + tag.length);
					i = closeIdx + tag.length;
					continue;
				}
			}
		}
		if (sql[i] === ";") {
			const stmt = current.trim();
			if (stmt) statements.push(stmt);
			current = "";
			i++;
			continue;
		}
		current += sql[i++];
	}
	const last = current.trim();
	if (last) statements.push(last);
	return statements;
}

function commandTag(sql: string, rowCount: number): string {
	const s = sql.trimStart().toUpperCase();
	if (s.startsWith("SELECT") || s.startsWith("WITH"))
		return `SELECT ${rowCount}`;
	if (s.startsWith("INSERT")) return `INSERT 0 ${rowCount}`;
	if (s.startsWith("UPDATE")) return `UPDATE ${rowCount}`;
	if (s.startsWith("DELETE")) return `DELETE ${rowCount}`;
	return s.split(/\s+/).slice(0, 2).join(" ");
}
