import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import type { SecureContextOptions } from "node:tls";
import { TLSSocket } from "node:tls";
import type { PGlite } from "@electric-sql/pglite";
import { AuthHandler } from "./auth/handler.ts";
import { PGlitePooler } from "./pooler.ts";
import { StorageHandler } from "./storage/handler.ts";
import type { PoolerConfig, QueryResult } from "./types.ts";

const MSG_QUERY = 0x51;
const MSG_PARSE = 0x50;
const MSG_BIND = 0x42;
const MSG_DESCRIBE = 0x44;
const MSG_EXECUTE = 0x45;
const MSG_SYNC = 0x53;
const MSG_FLUSH = 0x48;
const MSG_CLOSE = 0x43;
const MSG_TERMINATE = 0x58;

const OID_BOOL = 16;
const OID_INT2 = 21;
const OID_INT4 = 23;
const OID_OID = 26;
const OID_INT8 = 20;
const OID_FLOAT4 = 700;
const OID_FLOAT8 = 701;
const OID_JSON = 114;
const OID_JSON_ARRAY = 199;
const OID_TEXT = 25;
const OID_BPCHAR = 1042;
const OID_VARCHAR = 1043;
const OID_JSONB = 3802;
const OID_JSONB_ARRAY = 3807;
const OID_BYTEA = 17;
const OID_UUID = 2950;
const OID_DATE = 1082;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;

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
	pendingChunks: Buffer[];
	startupDone: boolean;
	authenticated: boolean;
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

export interface TLSConfig {
	cert: Buffer;
	key: Buffer;
}

const TLS_OPTIONS: SecureContextOptions = {
	minVersion: "TLSv1.2",
	maxVersion: "TLSv1.3",
	ciphers: [
		"TLS_AES_128_GCM_SHA256",
		"TLS_AES_256_GCM_SHA384",
		"TLS_CHACHA20_POLY1305_SHA256",
		"ECDHE-ECDSA-AES128-GCM-SHA256",
		"ECDHE-RSA-AES128-GCM-SHA256",
		"ECDHE-ECDSA-AES256-GCM-SHA384",
		"ECDHE-RSA-AES256-GCM-SHA384",
		"ECDHE-ECDSA-CHACHA20-POLY1305",
		"ECDHE-RSA-CHACHA20-POLY1305",
		"DHE-RSA-AES128-GCM-SHA256",
		"DHE-RSA-AES256-GCM-SHA384",
		"DHE-RSA-CHACHA20-POLY1305",
	].join(":"),
	honorCipherOrder: false,
};

export class PGliteTCPServer {
	private readonly pooler: PGlitePooler;
	private readonly password: string | null;
	private readonly tls: TLSConfig | null;
	private server: Server | null = null;
	private readonly connections = new Map<Socket, ConnectionState>();
	private readonly probeCache = new Map<
		string,
		{ name: string; dataTypeID: number }[]
	>();

	constructor(pooler: PGlitePooler, password?: string, tls?: TLSConfig) {
		this.pooler = pooler;
		this.password = password ?? null;
		this.tls = tls ?? null;
	}

	static async create(
		db: PGlite,
		config?: Partial<PoolerConfig>,
		password?: string,
		tls?: TLSConfig,
	): Promise<PGliteTCPServer> {
		const auth = new AuthHandler(db);
		const storage = new StorageHandler(db);
		await auth.initialize();
		await storage.initialize();
		const pooler = await PGlitePooler.create(db, config);
		return new PGliteTCPServer(pooler, password, tls);
	}

	async start(port = 5432, host = "127.0.0.1"): Promise<void> {
		this.server = createServer((rawSocket: Socket) => {
			const state: ConnectionState = {
				buffer: Buffer.alloc(0),
				pendingChunks: [],
				startupDone: false,
				authenticated: this.password === null,
				statements: new Map(),
				portals: new Map(),
				processing: false,
				errorState: false,
				txStatus: "I",
			};
			this.connections.set(rawSocket, state);
			rawSocket.on("close", () => this.connections.delete(rawSocket));
			rawSocket.on("error", () => this.connections.delete(rawSocket));

			if (!this.tls) {
				rawSocket.on("data", (data: Buffer) => {
					const s = this.connections.get(rawSocket);
					if (!s) return;
					s.pendingChunks.push(data);
					this.drain(rawSocket, s).catch(() => {});
				});
				return;
			}

			rawSocket.once("data", (firstChunk: Buffer) => {
				rawSocket.pause();
				if (
					firstChunk.length >= 8 &&
					firstChunk.readInt32BE(0) === 8 &&
					firstChunk.readInt32BE(4) === 80877103
				) {
					rawSocket.write(Buffer.from("S"));
					const tlsSocket = new TLSSocket(rawSocket, {
						isServer: true,
						...TLS_OPTIONS,
						cert: this.tls?.cert,
						key: this.tls?.key,
					});
					tlsSocket.once("secure", () => {
						this.connections.delete(rawSocket);
						rawSocket.removeAllListeners("close");
						rawSocket.removeAllListeners("error");
						const eff = tlsSocket as unknown as Socket;
						this.connections.set(eff, state);
						eff.on("data", (data: Buffer) => {
							const s = this.connections.get(eff);
							if (!s) return;
							s.pendingChunks.push(data);
							this.drain(eff, s).catch(() => {});
						});
						eff.on("close", () => this.connections.delete(eff));
						eff.on("error", () => this.connections.delete(eff));
					});
					tlsSocket.once("error", (err: Error) => {
						process.stderr.write(
							`${JSON.stringify({ event: "tls_handshake_error", error: err.message })}\n`,
						);
						tlsSocket.destroy();
						this.connections.delete(rawSocket);
					});
				} else {
					state.pendingChunks.push(firstChunk);
					rawSocket.on("data", (data: Buffer) => {
						const s = this.connections.get(rawSocket);
						if (!s) return;
						s.pendingChunks.push(data);
						this.drain(rawSocket, s).catch(() => {});
					});
					rawSocket.resume();
					this.drain(rawSocket, state).catch(() => {});
				}
			});
		});

		return new Promise((resolve, reject) => {
			this.server?.on("error", reject);
			this.server?.listen(port, host, () => resolve());
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
		if (state.pendingChunks.length > 0) {
			state.buffer =
				state.buffer.length > 0
					? Buffer.concat([state.buffer, ...state.pendingChunks])
					: Buffer.concat(state.pendingChunks);
			state.pendingChunks = [];
		}
		state.processing = true;
		try {
			while (state.buffer.length > 0) {
				const before = state.buffer.length;
				if (!state.startupDone) {
					if (!this.handleStartup(socket, state)) break;
				} else if (!state.authenticated) {
					const msg = readMessage(state);
					if (!msg) break;
					if (msg.type === 0x70) {
						this.handlePasswordMessage(socket, state, msg.body);
					} else {
						socket.end();
					}
				} else {
					const msg = readMessage(state);
					if (!msg) break;
					await this.handleMessage(socket, state, msg.type, msg.body);
				}
				if (state.buffer.length === before) {
					socket.destroy();
					break;
				}
			}
		} finally {
			state.processing = false;
			if (state.buffer.length > 0)
				setImmediate(() => this.drain(socket, state).catch(() => {}));
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
			if (this.password !== null) {
				const authReq = Buffer.alloc(9);
				authReq.writeUInt8(0x52, 0);
				authReq.writeInt32BE(8, 1);
				authReq.writeInt32BE(3, 5);
				socket.write(authReq);
			} else {
				socket.write(buildStartupResponse());
			}
		}
		return true;
	}

	private handlePasswordMessage(
		socket: Socket,
		state: ConnectionState,
		body: Buffer,
	): void {
		const end = body.indexOf(0);
		const providedBuf = body.slice(0, end < 0 ? undefined : end);
		const expectedBuf = Buffer.from(this.password ?? "", "utf8");
		const mismatch =
			providedBuf.length !== expectedBuf.length ||
			!timingSafeEqual(providedBuf, expectedBuf);
		if (mismatch) {
			const msg = "password authentication failed";
			const errPayload = Buffer.concat([
				Buffer.from("SFATAL\0VFATAL\0C28P01\0M"),
				Buffer.from(msg),
				Buffer.from("\0\0"),
			]);
			socket.write(buildMsg(0x45, errPayload));
			socket.end();
			return;
		}
		state.authenticated = true;
		socket.write(buildStartupResponse());
	}

	private async handleMessage(
		socket: Socket,
		state: ConnectionState,
		type: number,
		body: Buffer,
	): Promise<void> {
		if (state.errorState) {
			if (type === MSG_SYNC) {
				state.errorState = false;
				socket.write(buildReadyForQuery(state.txStatus));
			} else if (type === MSG_TERMINATE) socket.end();
			return;
		}
		switch (type) {
			case MSG_QUERY:
				await onSimpleQuery(socket, state, body, this.pooler);
				break;
			case MSG_PARSE:
				await onParse(socket, state, body, this.pooler, this.probeCache);
				break;
			case MSG_BIND:
				await onBind(socket, state, body, this.pooler);
				break;
			case MSG_DESCRIBE:
				onDescribe(socket, state, body);
				break;
			case MSG_EXECUTE:
				onExecute(socket, state, body);
				break;
			case MSG_SYNC:
				socket.write(buildReadyForQuery(state.txStatus));
				break;
			case MSG_FLUSH:
				break;
			case MSG_CLOSE: {
				const kind = body[0];
				const name = body.slice(1, body.indexOf(0, 1)).toString();
				if (kind === 0x53) state.statements.delete(name);
				else if (kind === 0x50) state.portals.delete(name);
				socket.write(buildMsg(0x33, Buffer.alloc(0)));
				break;
			}
			case MSG_TERMINATE:
				socket.end();
				break;
		}
	}
}

export type MuxRoute = (
	user: string,
) => Promise<{ pooler: PGlitePooler; password: string } | null>;

interface MuxConnectionState extends ConnectionState {
	pooler: PGlitePooler | null;
	password: string | null;
}

function parseStartupParams(buf: Buffer): Record<string, string> {
	const params: Record<string, string> = {};
	let i = 0;
	while (i < buf.length) {
		const keyEnd = buf.indexOf(0, i);
		if (keyEnd === -1 || keyEnd === i) break;
		const key = buf.slice(i, keyEnd).toString();
		i = keyEnd + 1;
		const valEnd = buf.indexOf(0, i);
		if (valEnd === -1) break;
		params[key] = buf.slice(i, valEnd).toString();
		i = valEnd + 1;
	}
	return params;
}

export class PGliteTCPMuxServer {
	private server: Server | null = null;
	private readonly connections = new Map<Socket, MuxConnectionState>();
	private readonly probeCaches = new WeakMap<
		PGlitePooler,
		Map<string, { name: string; dataTypeID: number }[]>
	>();
	private readonly tls: TLSConfig | null;

	constructor(
		private readonly route: MuxRoute,
		opts?: { tls?: TLSConfig },
	) {
		this.tls = opts?.tls ?? null;
	}

	async start(port = 5432, host = "0.0.0.0"): Promise<void> {
		this.server = createServer((rawSocket: Socket) => {
			const state: MuxConnectionState = {
				buffer: Buffer.alloc(0),
				pendingChunks: [],
				startupDone: false,
				authenticated: false,
				statements: new Map(),
				portals: new Map(),
				processing: false,
				errorState: false,
				txStatus: "I",
				pooler: null,
				password: null,
			};
			this.connections.set(rawSocket, state);
			rawSocket.on("close", () => this.connections.delete(rawSocket));
			rawSocket.on("error", () => this.connections.delete(rawSocket));

			if (!this.tls) {
				rawSocket.on("data", (data: Buffer) => {
					const s = this.connections.get(rawSocket);
					if (!s) return;
					s.pendingChunks.push(data);
					this.drainMux(rawSocket, s).catch(() => {});
				});
				return;
			}

			rawSocket.once("data", (firstChunk: Buffer) => {
				rawSocket.pause();
				if (
					firstChunk.length >= 8 &&
					firstChunk.readInt32BE(0) === 8 &&
					firstChunk.readInt32BE(4) === 80877103
				) {
					rawSocket.write(Buffer.from("S"));
					const tlsSocket = new TLSSocket(rawSocket, {
						isServer: true,
						...TLS_OPTIONS,
						cert: this.tls?.cert,
						key: this.tls?.key,
					});
					tlsSocket.once("secure", () => {
						this.connections.delete(rawSocket);
						rawSocket.removeAllListeners("close");
						rawSocket.removeAllListeners("error");
						const eff = tlsSocket as unknown as Socket;
						this.connections.set(eff, state);
						eff.on("data", (data: Buffer) => {
							const s = this.connections.get(eff);
							if (!s) return;
							s.pendingChunks.push(data);
							this.drainMux(eff, s).catch(() => {});
						});
						eff.on("close", () => this.connections.delete(eff));
						eff.on("error", () => this.connections.delete(eff));
					});
					tlsSocket.once("error", (err: Error) => {
						process.stderr.write(
							`${JSON.stringify({ event: "tls_handshake_error", error: err.message })}\n`,
						);
						tlsSocket.destroy();
						this.connections.delete(rawSocket);
					});
				} else {
					state.pendingChunks.push(firstChunk);
					rawSocket.on("data", (data: Buffer) => {
						const s = this.connections.get(rawSocket);
						if (!s) return;
						s.pendingChunks.push(data);
						this.drainMux(rawSocket, s).catch(() => {});
					});
					rawSocket.resume();
					this.drainMux(rawSocket, state).catch(() => {});
				}
			});
		});

		return new Promise((resolve, reject) => {
			this.server?.on("error", reject);
			this.server?.listen(port, host, () => resolve());
		});
	}

	async stop(): Promise<void> {
		for (const socket of this.connections.keys()) socket.destroy();
		this.connections.clear();
		return new Promise((resolve) => {
			if (!this.server) return resolve();
			this.server.close(() => resolve());
		});
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.stop();
	}

	private async drainMux(
		socket: Socket,
		state: MuxConnectionState,
	): Promise<void> {
		if (state.processing) return;
		if (state.pendingChunks.length > 0) {
			state.buffer =
				state.buffer.length > 0
					? Buffer.concat([state.buffer, ...state.pendingChunks])
					: Buffer.concat(state.pendingChunks);
			state.pendingChunks = [];
		}
		state.processing = true;
		try {
			while (state.buffer.length > 0) {
				const before = state.buffer.length;
				if (!state.startupDone) {
					const done = await this.handleMuxStartup(socket, state);
					if (!done) break;
				} else if (!state.authenticated) {
					const msg = readMessage(state);
					if (!msg) break;
					if (msg.type === 0x70) {
						this.handleMuxPassword(socket, state, msg.body);
					} else {
						socket.end();
					}
				} else {
					const msg = readMessage(state);
					if (!msg) break;
					await this.handleMuxMessage(socket, state, msg.type, msg.body);
				}
				if (state.buffer.length === before) {
					socket.destroy();
					break;
				}
			}
		} finally {
			state.processing = false;
			if (state.buffer.length > 0)
				setImmediate(() => this.drainMux(socket, state).catch(() => {}));
		}
	}

	private async handleMuxStartup(
		socket: Socket,
		state: MuxConnectionState,
	): Promise<boolean> {
		if (state.buffer.length < 8) return false;
		const len = state.buffer.readInt32BE(0);
		if (state.buffer.length < len) return false;
		const code = state.buffer.readInt32BE(4);
		const paramData = state.buffer.slice(8, len);
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
			const parsedParams = parseStartupParams(paramData);

			const user = parsedParams.user ?? "";
			const route = await this.route(user);
			if (!route) {
				const errPayload = Buffer.concat([
					Buffer.from("SFATAL\0VFATAL\0C28000\0M"),
					Buffer.from("role does not exist"),
					Buffer.from("\0\0"),
				]);
				socket.write(buildMsg(0x45, errPayload));
				socket.end();
				return false;
			}
			state.pooler = route.pooler;
			state.password = route.password;
			state.startupDone = true;
			if (route.password) {
				const authReq = Buffer.alloc(9);
				authReq.writeUInt8(0x52, 0);
				authReq.writeInt32BE(8, 1);
				authReq.writeInt32BE(3, 5);
				socket.write(authReq);
			} else {
				state.authenticated = true;
				socket.write(buildStartupResponse());
			}
		}
		return true;
	}

	private handleMuxPassword(
		socket: Socket,
		state: MuxConnectionState,
		body: Buffer,
	): void {
		const end = body.indexOf(0);
		const providedBuf = body.slice(0, end < 0 ? undefined : end);
		const expectedBuf = Buffer.from(state.password ?? "", "utf8");
		const mismatch =
			providedBuf.length !== expectedBuf.length ||
			!timingSafeEqual(providedBuf, expectedBuf);
		if (mismatch) {
			const msg = "password authentication failed";
			const errPayload = Buffer.concat([
				Buffer.from("SFATAL\0VFATAL\0C28P01\0M"),
				Buffer.from(msg),
				Buffer.from("\0\0"),
			]);
			socket.write(buildMsg(0x45, errPayload));
			socket.end();
			return;
		}
		state.authenticated = true;
		socket.write(buildStartupResponse());
	}

	private async handleMuxMessage(
		socket: Socket,
		state: MuxConnectionState,
		type: number,
		body: Buffer,
	): Promise<void> {
		const pooler = state.pooler;
		if (!pooler) return;
		const probeCache =
			this.probeCaches.get(pooler) ??
			(() => {
				const m = new Map<string, { name: string; dataTypeID: number }[]>();
				this.probeCaches.set(pooler, m);
				return m;
			})();
		if (state.errorState) {
			if (type === MSG_SYNC) {
				state.errorState = false;
				socket.write(buildReadyForQuery(state.txStatus));
			} else if (type === MSG_TERMINATE) socket.end();
			return;
		}
		switch (type) {
			case MSG_QUERY:
				await onSimpleQuery(socket, state, body, pooler);
				break;
			case MSG_PARSE:
				await onParse(socket, state, body, pooler, probeCache);
				break;
			case MSG_BIND:
				await onBind(socket, state, body, pooler);
				break;
			case MSG_DESCRIBE:
				onDescribe(socket, state, body);
				break;
			case MSG_EXECUTE:
				onExecute(socket, state, body);
				break;
			case MSG_SYNC:
				socket.write(buildReadyForQuery(state.txStatus));
				break;
			case MSG_FLUSH:
				break;
			case MSG_CLOSE: {
				const kind = body[0];
				const name = body.slice(1, body.indexOf(0, 1)).toString();
				if (kind === 0x53) state.statements.delete(name);
				else if (kind === 0x50) state.portals.delete(name);
				socket.write(buildMsg(0x33, Buffer.alloc(0)));
				break;
			}
			case MSG_TERMINATE:
				socket.end();
				break;
		}
	}
}

function readMessage(
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

function buildMsg(type: number, body: Buffer): Buffer {
	const out = Buffer.alloc(5 + body.length);
	out[0] = type;
	out.writeInt32BE(4 + body.length, 1);
	body.copy(out, 5);
	return out;
}

function cstring(s: string): Buffer {
	return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
}

function int32(n: number): Buffer {
	const b = Buffer.alloc(4);
	b.writeInt32BE(n, 0);
	return b;
}

function int16(n: number): Buffer {
	const b = Buffer.alloc(2);
	b.writeInt16BE(n, 0);
	return b;
}

function buildReadyForQuery(txStatus: "I" | "T" | "E" = "I"): Buffer {
	return buildMsg(0x5a, Buffer.from(txStatus));
}

function buildStartupResponse(): Buffer {
	const parts: Buffer[] = [buildMsg(0x52, int32(0))];
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
		parts.push(buildMsg(0x53, Buffer.concat([cstring(k), cstring(v)])));
	}
	parts.push(buildMsg(0x4b, Buffer.concat([int32(1), int32(0)])));
	parts.push(buildReadyForQuery());
	return Buffer.concat(parts);
}

function sqlstate(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (/unique.*constraint|duplicate key/i.test(msg)) return "23505";
	if (/relation.*does not exist/i.test(msg)) return "42P01";
	if (/syntax error/i.test(msg)) return "42601";
	if (/column.*does not exist/i.test(msg)) return "42703";
	if (/permission denied/i.test(msg)) return "42501";
	return "XX000";
}

function buildError(err: unknown): Buffer {
	const message = err instanceof Error ? err.message : String(err);
	return buildMsg(
		0x45,
		Buffer.concat([
			Buffer.from("S"),
			cstring("ERROR"),
			Buffer.from("V"),
			cstring("ERROR"),
			Buffer.from("C"),
			cstring(sqlstate(err)),
			Buffer.from("M"),
			cstring(message),
			Buffer.from([0]),
		]),
	);
}

function buildRowDescriptionBuf(
	fields: { name: string; dataTypeID: number }[],
	resultFormats: number[] = [],
): Buffer {
	const header = Buffer.alloc(2);
	header.writeInt16BE(fields.length, 0);
	const parts: Buffer[] = [header];
	for (let idx = 0; idx < fields.length; idx++) {
		const f = fields[idx];
		if (!f) continue;
		const fmt = effectiveFormat(f.dataTypeID, resultFormats, idx);
		parts.push(
			cstring(f.name),
			int32(0),
			int16(0),
			int32(f.dataTypeID || OID_TEXT),
			int16(-1),
			int32(-1),
			int16(fmt),
		);
	}
	return buildMsg(0x54, Buffer.concat(parts));
}

function pgText(val: unknown, oid?: number): string {
	if (Array.isArray(val)) {
		if (
			oid === OID_JSON ||
			oid === OID_JSONB ||
			oid === OID_JSON_ARRAY ||
			oid === OID_JSONB_ARRAY
		)
			return JSON.stringify(val);
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

function encodeBinaryVal(val: unknown, oid: number): Buffer {
	switch (oid) {
		case OID_BOOL: {
			const b = Buffer.alloc(1);
			b[0] = val ? 1 : 0;
			return b;
		}
		case OID_INT2: {
			const b = Buffer.alloc(2);
			b.writeInt16BE(Number(val), 0);
			return b;
		}
		case OID_INT4:
		case OID_OID: {
			const b = Buffer.alloc(4);
			b.writeInt32BE(Number(val), 0);
			return b;
		}
		case OID_INT8: {
			const b = Buffer.alloc(8);
			b.writeBigInt64BE(
				BigInt(typeof val === "string" ? val : Math.trunc(Number(val))),
			);
			return b;
		}
		case OID_FLOAT4: {
			const b = Buffer.alloc(4);
			b.writeFloatBE(Number(val), 0);
			return b;
		}
		case OID_FLOAT8: {
			const b = Buffer.alloc(8);
			b.writeDoubleBE(Number(val), 0);
			return b;
		}
		case OID_JSON:
		case OID_TEXT:
		case OID_BPCHAR:
		case OID_VARCHAR:
			return Buffer.from(
				typeof val === "object" ? JSON.stringify(val) : String(val),
				"utf8",
			);
		case OID_JSONB: {
			const json = Buffer.from(JSON.stringify(val), "utf8");
			const b = Buffer.alloc(1 + json.length);
			b[0] = 1;
			json.copy(b, 1);
			return b;
		}
		case OID_BYTEA: {
			if (val instanceof Uint8Array) return Buffer.from(val);
			const s = String(val);
			return s.startsWith("\\x")
				? Buffer.from(s.slice(2), "hex")
				: Buffer.from(s, "utf8");
		}
		case OID_UUID:
			return Buffer.from(String(val).replace(/-/g, ""), "hex");
		case OID_DATE: {
			const b = Buffer.alloc(4);
			const d = val instanceof Date ? val : new Date(String(val));
			b.writeInt32BE(Math.floor((d.getTime() - 946684800000) / 86400000), 0);
			return b;
		}
		case OID_TIMESTAMP:
		case OID_TIMESTAMPTZ: {
			const d = val instanceof Date ? val : new Date(String(val));
			const us = BigInt(d.getTime()) * 1000n - BigInt(946684800) * 1000000n;
			const b = Buffer.alloc(8);
			b.writeBigInt64BE(us);
			return b;
		}
		default:
			return Buffer.from(pgText(val), "utf8");
	}
}

function buildDataRowBuf(
	row: Record<string, unknown>,
	fields: { name: string; dataTypeID: number }[],
	resultFormats: number[] = [],
): Buffer {
	const parts: Buffer[] = [int16(fields.length)];
	for (let idx = 0; idx < fields.length; idx++) {
		const f = fields[idx];
		if (!f) continue;
		const val = row[f.name];
		if (val === null || val === undefined) {
			parts.push(int32(-1));
		} else {
			const fmt = effectiveFormat(f.dataTypeID, resultFormats, idx);
			const bytes =
				fmt === 1
					? encodeBinaryVal(val, f.dataTypeID)
					: Buffer.from(pgText(val, f.dataTypeID), "utf8");
			parts.push(int32(bytes.length), bytes);
		}
	}
	return buildMsg(0x44, Buffer.concat(parts));
}

async function execute(
	pooler: PGlitePooler,
	sql: string,
	params?: (string | null)[],
): Promise<QueryResult> {
	if (/pg_stat_statements/i.test(sql)) return { rows: [], fields: [] };
	try {
		return await pooler.query(sql, params);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("multiple commands") && !params?.length) {
			const statements = splitStatements(sql);
			let last: QueryResult = { rows: [], fields: [] };
			await pooler.transaction(async (query) => {
				for (const stmt of statements) last = await query(stmt);
			});
			return last;
		}
		throw err;
	}
}

async function onSimpleQuery(
	socket: Socket,
	state: ConnectionState,
	body: Buffer,
	pooler: PGlitePooler,
): Promise<void> {
	const sql = body.slice(0, -1).toString("utf8");
	if (!sql.trim()) {
		socket.write(
			Buffer.concat([
				buildMsg(0x49, Buffer.alloc(0)),
				buildReadyForQuery(state.txStatus),
			]),
		);
		return;
	}
	const bufs: Buffer[] = [];
	let errorOccurred = false;
	try {
		const result = await execute(pooler, sql);
		const { rows, fields } = result as {
			rows: Record<string, unknown>[];
			fields?: { name: string; dataTypeID: number }[];
		};
		if (fields && fields.length > 0) {
			bufs.push(buildRowDescriptionBuf(fields));
			for (const row of rows ?? []) bufs.push(buildDataRowBuf(row, fields));
		}
		bufs.push(buildMsg(0x43, cstring(commandTag(sql, rows?.length ?? 0))));
	} catch (err) {
		errorOccurred = true;
		bufs.push(buildError(err));
	}
	updateTxStatus(state, sql, errorOccurred);
	bufs.push(buildReadyForQuery(state.txStatus));
	socket.write(Buffer.concat(bufs));
}

async function onParse(
	socket: Socket,
	state: ConnectionState,
	body: Buffer,
	pooler: PGlitePooler,
	probeCache: Map<string, { name: string; dataTypeID: number }[]>,
): Promise<void> {
	const nameEnd = body.indexOf(0);
	const name = body.slice(0, nameEnd).toString();
	const queryEnd = body.indexOf(0, nameEnd + 1);
	const query = body.slice(nameEnd + 1, queryEnd).toString();

	const { paramCount, probeQuery } = scanQuery(query);
	let fields: { name: string; dataTypeID: number }[] | undefined;
	if (/^\s*(SELECT|WITH)\b/i.test(query)) {
		if (probeCache.has(probeQuery)) {
			fields = probeCache.get(probeQuery);
		} else {
			try {
				const r = await execute(
					pooler,
					`SELECT * FROM (${probeQuery}) AS _probe LIMIT 0`,
				);
				fields = (r.fields ?? []) as { name: string; dataTypeID: number }[];
			} catch {
				fields = [];
			}
			if (probeCache.size >= 1000) probeCache.clear();
			probeCache.set(probeQuery, fields);
		}
	}

	state.statements.set(name, { query, paramCount, fields });
	socket.write(buildMsg(0x31, Buffer.alloc(0)));
}

async function onBind(
	socket: Socket,
	state: ConnectionState,
	body: Buffer,
	pooler: PGlitePooler,
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

	let result: QueryResult;
	try {
		result = await execute(pooler, query, params.length ? params : undefined);
		updateTxStatus(state, query, false);
	} catch (err) {
		updateTxStatus(state, query, true);
		state.errorState = true;
		socket.write(buildError(err));
		return;
	}

	state.portals.set(portalName, {
		query,
		params,
		result,
		offset: 0,
		resultFormats,
	});
	socket.write(buildMsg(0x32, Buffer.alloc(0)));
}

function onDescribe(
	socket: Socket,
	state: ConnectionState,
	body: Buffer,
): void {
	const kind = body[0];
	if (kind === 0x53) {
		const stmtName = body.slice(1, body.indexOf(0, 1)).toString();
		const stmt = state.statements.get(stmtName);
		const paramCount = stmt?.paramCount ?? 0;
		const pd = Buffer.alloc(2 + paramCount * 4);
		pd.writeInt16BE(paramCount, 0);
		for (let i = 0; i < paramCount; i++) pd.writeInt32BE(OID_TEXT, 2 + i * 4);
		socket.write(buildMsg(0x74, pd));
		if (stmt?.fields && stmt.fields.length > 0) {
			socket.write(buildRowDescriptionBuf(stmt.fields));
		} else {
			socket.write(buildMsg(0x6e, Buffer.alloc(0)));
		}
	} else if (kind === 0x50) {
		const portalName = body.slice(1, body.indexOf(0, 1)).toString();
		if (!state.portals.has(portalName)) {
			socket.write(
				buildError(new Error(`portal "${portalName}" does not exist`)),
			);
			return;
		}
		const portal = state.portals.get(portalName);
		if (!portal) return;
		const fields = portal.result?.fields as
			| { name: string; dataTypeID: number }[]
			| undefined;
		if (fields && fields.length > 0) {
			socket.write(buildRowDescriptionBuf(fields, portal.resultFormats));
		} else {
			socket.write(buildMsg(0x6e, Buffer.alloc(0)));
		}
	}
}

function onExecute(socket: Socket, state: ConnectionState, body: Buffer): void {
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
			for (const row of chunk)
				bufs.push(buildDataRowBuf(row, fields, portal.resultFormats));
		}

		if (hasMore) {
			portal.offset = start + rowLimit;
			bufs.push(buildMsg(0x73, Buffer.alloc(0)));
		} else {
			bufs.push(
				buildMsg(0x43, cstring(commandTag(portal.query, chunk.length))),
			);
		}
	} else {
		bufs.push(buildMsg(0x43, cstring("OK")));
	}
	socket.write(Buffer.concat(bufs));
}

function updateTxStatus(
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

const BINARY_OIDS = new Set([
	OID_BOOL,
	OID_BYTEA,
	OID_INT8,
	OID_INT2,
	OID_INT4,
	OID_TEXT,
	OID_OID,
	OID_JSON,
	OID_FLOAT4,
	OID_FLOAT8,
	OID_BPCHAR,
	OID_VARCHAR,
	OID_DATE,
	OID_TIMESTAMP,
	OID_TIMESTAMPTZ,
	OID_UUID,
	OID_JSONB,
]);

function effectiveFormat(oid: number, formats: number[], idx: number): 0 | 1 {
	if (formats.length === 0) return 0;
	const requested = formats.length === 1 ? formats[0] : (formats[idx] ?? 0);
	return requested === 1 && BINARY_OIDS.has(oid) ? 1 : 0;
}

function walkSql(
	sql: string,
	callbacks: {
		onStatement?: (stmt: string) => void;
		onParam?: (index: number) => void;
	},
): string {
	let result = "";
	let current = "";
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "-" && sql[i + 1] === "-") {
			const end = sql.indexOf("\n", i);
			const stop = end === -1 ? sql.length : end;
			const slice = sql.slice(i, stop);
			current += slice;
			result += slice;
			i = stop;
			continue;
		}
		if (sql[i] === "/" && sql[i + 1] === "*") {
			const end = sql.indexOf("*/", i + 2);
			const stop = end === -1 ? sql.length : end + 2;
			const slice = sql.slice(i, stop);
			current += slice;
			result += slice;
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
			const slice = sql.slice(i, j);
			current += slice;
			result += slice;
			i = j;
			continue;
		}
		if (sql[i] === "$") {
			if (callbacks.onParam) {
				let j = i + 1;
				while (j < sql.length && (sql[j] ?? "") >= "0" && (sql[j] ?? "") <= "9")
					j++;
				if (j > i + 1) {
					callbacks.onParam(parseInt(sql.slice(i + 1, j), 10));
					result += "NULL";
					i = j;
					continue;
				}
			}
			const tagEnd = sql.indexOf("$", i + 1);
			if (tagEnd !== -1 && !/^\d+$/.test(sql.slice(i + 1, tagEnd))) {
				const tag = sql.slice(i, tagEnd + 1);
				const closeIdx = sql.indexOf(tag, tagEnd + 1);
				if (closeIdx !== -1) {
					const slice = sql.slice(i, closeIdx + tag.length);
					current += slice;
					result += slice;
					i = closeIdx + tag.length;
					continue;
				}
			}
		}
		if (callbacks.onStatement && sql[i] === ";") {
			const stmt = current.trim();
			if (stmt) callbacks.onStatement(stmt);
			current = "";
			result += sql[i];
			i++;
			continue;
		}
		current += sql[i];
		result += sql[i];
		i++;
	}
	if (callbacks.onStatement) {
		const last = current.trim();
		if (last) callbacks.onStatement(last);
	}
	return result;
}

function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	walkSql(sql, { onStatement: (stmt) => statements.push(stmt) });
	return statements;
}

function scanQuery(query: string): { paramCount: number; probeQuery: string } {
	let max = 0;
	const probeQuery = walkSql(query, {
		onParam: (index) => {
			max = Math.max(max, index);
		},
	});
	return { paramCount: max, probeQuery };
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
