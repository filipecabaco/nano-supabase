import { Buffer } from "node:buffer";
import { createServer, type Server, type Socket } from "node:net";
import type { PGlite } from "@electric-sql/pglite";
import { AuthHandler } from "./auth/handler.ts";
import { PGlitePooler } from "./pooler.ts";
import { StorageHandler } from "./storage/handler.ts";
import type { PoolerConfig, QueryResult } from "./types.ts";

interface PreparedStatement {
	query: string;
	paramCount: number;
	fields?: { name: string; dataTypeID: number }[];
}

interface Portal {
	query: string;
	params: (string | null)[];
	result: QueryResult;
	offset: number;
	resultFormats: number[];
}

interface ConnectionState {
	buffer: Buffer;
	startupDone: boolean;
	statements: Map<string, PreparedStatement>;
	portals: Map<string, Portal>;
	processing: boolean;
	errorState: boolean;
	txStatus: "I" | "T" | "E";
}

export interface TCPServerOptions {
	host?: string;
	port?: number;
}

export class PGliteTCPServer {
	private readonly pooler: PGlitePooler;
	private server: Server | null = null;
	private readonly connections = new Map<Socket, ConnectionState>();
	private readonly probeCache = new Map<string, { name: string; dataTypeID: number }[]>();

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
				txStatus: "I",
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
			socket.write(Buffer.from("N"));
			return true;
		}
		if (code === 80877102) {
			socket.end();
			return true;
		}
		if (code === 196608) {
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
				socket.write(this.buildReadyForQuery(state.txStatus));
			} else if (type === 0x58) socket.end();
			return;
		}
		switch (type) {
			case 0x51:
				await this.onSimpleQuery(socket, state, body);
				break;
			case 0x50:
				await this.onParse(socket, state, body);
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
				socket.write(this.buildReadyForQuery(state.txStatus));
				break;
			case 0x48:
				break;
			case 0x43: {
				const kind = body[0];
				const name = body.slice(1, body.indexOf(0, 1)).toString();
				if (kind === 0x53) state.statements.delete(name);
				else if (kind === 0x50) state.portals.delete(name);
				socket.write(this.msg(0x33, Buffer.alloc(0)));
				break;
			}
			case 0x58:
				socket.end();
				break;
		}
	}

	private async onSimpleQuery(
		socket: Socket,
		state: ConnectionState,
		body: Buffer,
	): Promise<void> {
		const sql = body.slice(0, -1).toString("utf8");
		if (!sql.trim()) {
			socket.write(
				Buffer.concat([
					this.msg(0x49, Buffer.alloc(0)),
					this.buildReadyForQuery(state.txStatus),
				]),
			);
			return;
		}
		const bufs: Buffer[] = [];
		let errorOccurred = false;
		try {
			const result = await this.execute(sql);
			bufs.push(...this.buildResultMessages(result, sql));
		} catch (err) {
			errorOccurred = true;
			bufs.push(this.buildError(err));
		}
		this.updateTxStatus(state, sql, errorOccurred);
		bufs.push(this.buildReadyForQuery(state.txStatus));
		socket.write(Buffer.concat(bufs));
	}

	private async onParse(
		socket: Socket,
		state: ConnectionState,
		body: Buffer,
	): Promise<void> {
		const nameEnd = body.indexOf(0);
		const name = body.slice(0, nameEnd).toString();
		const queryEnd = body.indexOf(0, nameEnd + 1);
		const query = body.slice(nameEnd + 1, queryEnd).toString();

		const { paramCount, probeQuery } = scanQuery(query);
		let fields: { name: string; dataTypeID: number }[] | undefined;
		if (/^\s*(SELECT|WITH)\b/i.test(query)) {
			if (this.probeCache.has(probeQuery)) {
				fields = this.probeCache.get(probeQuery);
			} else {
				try {
					const r = await this.execute(`SELECT * FROM (${probeQuery}) AS _probe LIMIT 0`);
					fields = (r.fields ?? []) as { name: string; dataTypeID: number }[];
				} catch {
					fields = [];
				}
				this.probeCache.set(probeQuery, fields);
			}
		}

		state.statements.set(name, { query, paramCount, fields });
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

		const resultFmtCount = body.readInt16BE(offset);
		offset += 2;
		const resultFormats: number[] = [];
		for (let i = 0; i < resultFmtCount; i++) {
			resultFormats.push(body.readInt16BE(offset));
			offset += 2;
		}

		const query = state.statements.get(stmtName)?.query ?? "";

		let result: QueryResult | null = null;
		try {
			result = await this.execute(query, params.length ? params : undefined);
			this.updateTxStatus(state, query, false);
		} catch (err) {
			this.updateTxStatus(state, query, true);
			state.errorState = true;
			socket.write(this.buildError(err));
			return;
		}

		state.portals.set(portalName, { query, params, result: result!, offset: 0, resultFormats });
		socket.write(this.msg(0x32, Buffer.alloc(0)));
	}

	private onDescribe(socket: Socket, state: ConnectionState, body: Buffer): void {
		const kind = body[0];
		if (kind === 0x53) {
			const stmtName = body.slice(1, body.indexOf(0, 1)).toString();
			const stmt = state.statements.get(stmtName);
			const paramCount = stmt?.paramCount ?? 0;
			const pd = Buffer.alloc(2 + paramCount * 4);
			pd.writeInt16BE(paramCount, 0);
			for (let i = 0; i < paramCount; i++) pd.writeInt32BE(25, 2 + i * 4);
			socket.write(this.msg(0x74, pd));
			if (stmt?.fields && stmt.fields.length > 0) {
				socket.write(this.buildRowDescription(stmt.fields));
			} else {
				socket.write(this.msg(0x6e, Buffer.alloc(0)));
			}
		} else if (kind === 0x50) {
			const portalName = body.slice(1, body.indexOf(0, 1)).toString();
			if (!state.portals.has(portalName)) {
				socket.write(this.buildError(new Error(`portal "${portalName}" does not exist`)));
				return;
			}
			const portal = state.portals.get(portalName)!;
			const fields = portal.result?.fields as { name: string; dataTypeID: number }[] | undefined;
			if (fields && fields.length > 0) {
				socket.write(this.buildRowDescription(fields, portal.resultFormats));
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
		const rowLimit = body.readInt32BE(portalEnd + 1);

		const bufs: Buffer[] = [];
		if (portal) {
			const { rows, fields } = portal.result as {
				rows: Record<string, unknown>[];
				fields?: { name: string; dataTypeID: number }[];
			};
			const allRows = rows ?? [];
			const start = portal.offset;
			const chunk =
				rowLimit > 0
					? allRows.slice(start, start + rowLimit)
					: allRows.slice(start);
			const hasMore = rowLimit > 0 && start + rowLimit < allRows.length;

			if (fields && fields.length > 0) {
				for (const row of chunk) bufs.push(this.buildDataRow(row, fields, portal.resultFormats));
			}

			if (hasMore) {
				portal.offset = start + rowLimit;
				bufs.push(this.msg(0x73, Buffer.alloc(0)));
			} else {
				bufs.push(
					this.msg(
						0x43,
						this.cstring(commandTag(portal.query, chunk.length)),
					),
				);
			}
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
		await this.pooler.transaction(async (query) => {
			for (const stmt of statements) last = await query(stmt);
		});
		return last;
	}

	private updateTxStatus(
		state: ConnectionState,
		sql: string,
		didError: boolean,
	): void {
		const s = sql.trimStart().slice(0, 20).toUpperCase();
		if (didError && state.txStatus === "T") {
			state.txStatus = "E";
			return;
		}
		if (s.startsWith("BEGIN") || s.startsWith("START TRANSACTION")) {
			state.txStatus = "T";
			return;
		}
		if (s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
			state.txStatus = "I";
		}
	}

	private buildStartupResponse(): Buffer {
		const parts: Buffer[] = [this.msg(0x52, this.int32(0))];
		for (const [k, v] of [
			["server_version", "15.1"],
			["client_encoding", "UTF8"],
			["DateStyle", "ISO, MDY"],
			["TimeZone", "UTC"],
			["integer_datetimes", "on"],
			["standard_conforming_strings", "on"],
			["application_name", ""],
			["IntervalStyle", "postgres"],
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
		resultFormats: number[] = [],
	): Buffer {
		const header = Buffer.alloc(2);
		header.writeInt16BE(fields.length, 0);
		const parts: Buffer[] = [header];
		for (let idx = 0; idx < fields.length; idx++) {
			const f = fields[idx]!;
			const fmt = effectiveFormat(f.dataTypeID, resultFormats, idx);
			parts.push(
				this.cstring(f.name),
				this.int32(0),
				this.int16(0),
				this.int32(fmt === 1 ? (f.dataTypeID || 25) : 25),
				this.int16(-1),
				this.int32(-1),
				this.int16(fmt),
			);
		}
		return this.msg(0x54, Buffer.concat(parts));
	}

	private pgText(val: unknown): string {
		if (Array.isArray(val)) {
			if (val.length === 0) return "{}";
			return (
				"{" +
				val
					.map((v) =>
						v === null
							? "NULL"
							: `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
					)
					.join(",") +
				"}"
			);
		}
		if (val !== null && typeof val === "object") return JSON.stringify(val);
		return String(val);
	}

	private buildDataRow(
		row: Record<string, unknown>,
		fields: { name: string; dataTypeID: number }[],
		resultFormats: number[] = [],
	): Buffer {
		const parts: Buffer[] = [this.int16(fields.length)];
		for (let idx = 0; idx < fields.length; idx++) {
			const f = fields[idx]!;
			const val = row[f.name];
			if (val === null || val === undefined) {
				parts.push(this.int32(-1));
			} else {
				const fmt = effectiveFormat(f.dataTypeID, resultFormats, idx);
				const bytes =
					fmt === 1
						? this.encodeBinary(val, f.dataTypeID)
						: Buffer.from(this.pgText(val), "utf8");
				parts.push(this.int32(bytes.length), bytes);
			}
		}
		return this.msg(0x44, Buffer.concat(parts));
	}

	private encodeBinary(val: unknown, oid: number): Buffer {
		switch (oid) {
			case 16: {
				const b = Buffer.alloc(1);
				b[0] = val ? 1 : 0;
				return b;
			}
			case 21: {
				const b = Buffer.alloc(2);
				b.writeInt16BE(Number(val), 0);
				return b;
			}
			case 23:
			case 26: {
				const b = Buffer.alloc(4);
				b.writeInt32BE(Number(val), 0);
				return b;
			}
			case 20: {
				const b = Buffer.alloc(8);
				b.writeBigInt64BE(BigInt(typeof val === "string" ? val : Math.trunc(Number(val))));
				return b;
			}
			case 700: {
				const b = Buffer.alloc(4);
				b.writeFloatBE(Number(val), 0);
				return b;
			}
			case 701: {
				const b = Buffer.alloc(8);
				b.writeDoubleBE(Number(val), 0);
				return b;
			}
			case 114:
			case 25:
			case 1042:
			case 1043:
				return Buffer.from(
					typeof val === "object" ? JSON.stringify(val) : String(val),
					"utf8",
				);
			case 3802: {
				const json = Buffer.from(JSON.stringify(val), "utf8");
				const b = Buffer.alloc(1 + json.length);
				b[0] = 1;
				json.copy(b, 1);
				return b;
			}
			case 17: {
				if (val instanceof Uint8Array) return Buffer.from(val);
				const s = String(val);
				return s.startsWith("\\x")
					? Buffer.from(s.slice(2), "hex")
					: Buffer.from(s, "utf8");
			}
			case 2950:
				return Buffer.from(String(val).replace(/-/g, ""), "hex");
			case 1082: {
				const b = Buffer.alloc(4);
				const d = val instanceof Date ? val : new Date(String(val));
				b.writeInt32BE(Math.floor((d.getTime() - 946684800000) / 86400000), 0);
				return b;
			}
			case 1114:
			case 1184: {
				const d = val instanceof Date ? val : new Date(String(val));
				const us = BigInt(d.getTime()) * 1000n - BigInt(946684800) * 1000000n;
				const b = Buffer.alloc(8);
				b.writeBigInt64BE(us);
				return b;
			}
			default:
				return Buffer.from(this.pgText(val), "utf8");
		}
	}

	private buildReadyForQuery(txStatus: "I" | "T" | "E" = "I"): Buffer {
		return this.msg(0x5a, Buffer.from(txStatus));
	}

	private sqlstate(err: unknown): string {
		const msg = err instanceof Error ? err.message : String(err);
		if (/unique.*constraint|duplicate key/i.test(msg)) return "23505";
		if (/relation.*does not exist/i.test(msg)) return "42P01";
		if (/syntax error/i.test(msg)) return "42601";
		if (/column.*does not exist/i.test(msg)) return "42703";
		if (/permission denied/i.test(msg)) return "42501";
		return "XX000";
	}

	private buildError(err: unknown): Buffer {
		const message = err instanceof Error ? err.message : String(err);
		return this.msg(
			0x45,
			Buffer.concat([
				Buffer.from("S"),
				this.cstring("ERROR"),
				Buffer.from("V"),
				this.cstring("ERROR"),
				Buffer.from("C"),
				this.cstring(this.sqlstate(err)),
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

const BINARY_OIDS = new Set([
	16, 17, 20, 21, 23, 25, 26, 114, 700, 701, 1042, 1043, 1082, 1114, 1184, 2950, 3802,
]);

function effectiveFormat(oid: number, formats: number[], idx: number): 0 | 1 {
	if (formats.length === 0) return 0;
	const requested = formats.length === 1 ? formats[0] : (formats[idx] ?? 0);
	return requested === 1 && BINARY_OIDS.has(oid) ? 1 : 0;
}

function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = "";
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "-" && sql[i + 1] === "-") {
			const end = sql.indexOf("\n", i);
			const stop = end === -1 ? sql.length : end;
			current += sql.slice(i, stop);
			i = stop;
			continue;
		}
		if (sql[i] === "/" && sql[i + 1] === "*") {
			const end = sql.indexOf("*/", i + 2);
			const stop = end === -1 ? sql.length : end + 2;
			current += sql.slice(i, stop);
			i = stop;
			continue;
		}
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
			if (tagEnd !== -1 && !/^\d+$/.test(sql.slice(i + 1, tagEnd))) {
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

function scanQuery(query: string): { paramCount: number; probeQuery: string } {
	let max = 0;
	let result = "";
	let i = 0;
	while (i < query.length) {
		if (query[i] === "-" && query[i + 1] === "-") {
			const end = query.indexOf("\n", i);
			const stop = end === -1 ? query.length : end + 1;
			result += query.slice(i, stop);
			i = stop;
			continue;
		}
		if (query[i] === "/" && query[i + 1] === "*") {
			const end = query.indexOf("*/", i + 2);
			const stop = end === -1 ? query.length : end + 2;
			result += query.slice(i, stop);
			i = stop;
			continue;
		}
		if (query[i] === "'") {
			let j = i + 1;
			while (j < query.length) {
				if (query[j] === "'" && query[j + 1] === "'") { j += 2; continue; }
				if (query[j] === "'") { j++; break; }
				j++;
			}
			result += query.slice(i, j);
			i = j;
			continue;
		}
		if (query[i] === "$") {
			let j = i + 1;
			while (j < query.length && (query[j] ?? "") >= "0" && (query[j] ?? "") <= "9") j++;
			if (j > i + 1) {
				max = Math.max(max, parseInt(query.slice(i + 1, j)));
				result += "NULL";
				i = j;
				continue;
			}
			const tagEnd = query.indexOf("$", i + 1);
			if (tagEnd !== -1) {
				const tag = query.slice(i, tagEnd + 1);
				const closeIdx = query.indexOf(tag, tagEnd + 1);
				if (closeIdx !== -1) {
					result += query.slice(i, closeIdx + tag.length);
					i = closeIdx + tag.length;
					continue;
				}
			}
		}
		result += query[i++];
	}
	return { paramCount: max, probeQuery: result };
}

function commandTag(sql: string, rowCount: number): string {
	const s = sql.trimStart().slice(0, 20).toUpperCase();
	if (s.startsWith("SELECT") || s.startsWith("WITH"))
		return `SELECT ${rowCount}`;
	if (s.startsWith("INSERT")) return `INSERT 0 ${rowCount}`;
	if (s.startsWith("UPDATE")) return `UPDATE ${rowCount}`;
	if (s.startsWith("DELETE")) return `DELETE ${rowCount}`;
	return s.split(/\s+/).slice(0, 2).join(" ");
}
