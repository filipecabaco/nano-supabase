// @ts-nocheck — Bun-only file; uses Bun.listen and Node Buffer globals not available in Deno/tsc
import type { PGlite } from "@electric-sql/pglite";
import { PGlitePooler } from "./pooler.ts";
import { AuthHandler } from "./auth/handler.ts";
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
  errorState: boolean; // true after an extended query error, until Sync clears it
}

type TCPSocket = Parameters<NonNullable<Parameters<typeof Bun.listen>[0]["socket"]["data"]>>[0];

export interface TCPServerOptions {
  host?: string;
  port?: number;
}

export class PGliteTCPServer {
  private readonly pooler: PGlitePooler;
  private server: { stop(): void } | null = null;
  private readonly connections = new Map<TCPSocket, ConnectionState>();

  constructor(pooler: PGlitePooler) {
    this.pooler = pooler;
  }

  static async create(db: PGlite, config?: Partial<PoolerConfig>): Promise<PGliteTCPServer> {
    const auth = new AuthHandler(db);
    const storage = new StorageHandler(db);
    await auth.initialize();
    await storage.initialize();
    const pooler = await PGlitePooler.create(db, config);
    return new PGliteTCPServer(pooler);
  }

  async start(port = 5432, host = "127.0.0.1"): Promise<void> {
    const self = this;
    this.server = Bun.listen({
      hostname: host,
      port,
      socket: {
        open(socket) {
          self.connections.set(socket, {
            buffer: Buffer.alloc(0),
            startupDone: false,
            statements: new Map(),
            portals: new Map(),
            processing: false,
            errorState: false,
          });
        },
        data(socket, data) {
          const state = self.connections.get(socket);
          if (!state) return;
          state.buffer = Buffer.concat([state.buffer, Buffer.from(data)]);
          self.drain(socket, state).catch(() => {});
        },
        close(socket) { self.connections.delete(socket); },
        error(socket, _err) { self.connections.delete(socket); },
      },
    });
  }

  async stop(): Promise<void> {
    this.server?.stop();
    await this.pooler.stop();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  private async drain(socket: TCPSocket, state: ConnectionState): Promise<void> {
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

  private handleStartup(socket: TCPSocket, state: ConnectionState): boolean {
    if (state.buffer.length < 8) return false;
    const len = state.buffer.readInt32BE(0);
    if (state.buffer.length < len) return false;
    const code = state.buffer.readInt32BE(4);
    state.buffer = state.buffer.slice(len);

    if (code === 80877103) { // SSL request → reject
      socket.write(Buffer.from("N"));
      return true;
    }
    if (code === 196608) { // Protocol 3.0 → accept
      state.startupDone = true;
      socket.write(this.buildStartupResponse());
    }
    return true;
  }

  private readMessage(state: ConnectionState): { type: number; body: Buffer } | null {
    if (state.buffer.length < 5) return null;
    const len = state.buffer.readInt32BE(1);
    if (state.buffer.length < 1 + len) return null;
    const type = state.buffer.readUInt8(0);
    const body = state.buffer.slice(5, 1 + len);
    state.buffer = state.buffer.slice(1 + len);
    return { type, body };
  }

  private async handleMessage(socket: TCPSocket, state: ConnectionState, type: number, body: Buffer): Promise<void> {
    // In error state, discard all messages until Sync which resets and sends ReadyForQuery
    if (state.errorState) {
      if (type === 0x53) { state.errorState = false; socket.write(this.buildReadyForQuery()); } // S Sync
      else if (type === 0x58) socket.end(); // X Terminate
      return;
    }
    switch (type) {
      case 0x51: await this.onSimpleQuery(socket, body); break;        // Q
      case 0x50: this.onParse(socket, state, body); break;             // P
      case 0x42: await this.onBind(socket, state, body); break;        // B
      case 0x44: this.onDescribe(socket, state, body); break;          // D
      case 0x45: this.onExecute(socket, state, body); break;           // E
      case 0x53: socket.write(this.buildReadyForQuery()); break;       // S Sync
      case 0x48: break;                                                 // H Flush
      case 0x43: socket.write(this.msg(0x33, Buffer.alloc(0))); break; // C Close → CloseComplete
      case 0x58: socket.end(); break;                                   // X Terminate
    }
  }

  // ── Simple Query ──────────────────────────────────────────────────────────

  private async onSimpleQuery(socket: TCPSocket, body: Buffer): Promise<void> {
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

  // ── Extended Query ────────────────────────────────────────────────────────

  private onParse(socket: TCPSocket, state: ConnectionState, body: Buffer): void {
    const nameEnd = body.indexOf(0);
    const name = body.slice(0, nameEnd).toString();
    const queryEnd = body.indexOf(0, nameEnd + 1);
    const query = body.slice(nameEnd + 1, queryEnd).toString();
    state.statements.set(name, { query });
    socket.write(this.msg(0x31, Buffer.alloc(0))); // ParseComplete
  }

  private async onBind(socket: TCPSocket, state: ConnectionState, body: Buffer): Promise<void> {
    let offset = 0;
    const portalEnd = body.indexOf(0, offset);
    const portalName = body.slice(offset, portalEnd).toString();
    offset = portalEnd + 1;

    const stmtEnd = body.indexOf(0, offset);
    const stmtName = body.slice(offset, stmtEnd).toString();
    offset = stmtEnd + 1;

    const formatCount = body.readInt16BE(offset); offset += 2;
    offset += formatCount * 2; // skip format codes

    const paramCount = body.readInt16BE(offset); offset += 2;
    const params: (string | null)[] = [];
    for (let i = 0; i < paramCount; i++) {
      const len = body.readInt32BE(offset); offset += 4;
      if (len === -1) { params.push(null); }
      else { params.push(body.slice(offset, offset + len).toString("utf8")); offset += len; }
    }

    const query = state.statements.get(stmtName)?.query ?? "";

    // Execute at Bind time and cache — so Describe and Execute can use the result
    let result: QueryResult | null = null;
    try {
      result = await this.execute(query, params.length ? params : undefined);
    } catch (err) {
      // Per Postgres extended query protocol: send ErrorResponse on Bind failure,
      // enter error state and wait for Sync before accepting new messages
      state.errorState = true;
      socket.write(this.buildError(err));
      return;
    }

    state.portals.set(portalName, { query, params, result: result! });
    socket.write(this.msg(0x32, Buffer.alloc(0))); // BindComplete
  }

  private onDescribe(socket: TCPSocket, state: ConnectionState, body: Buffer): void {
    const kind = body[0]; // 0x53='S' statement, 0x50='P' portal
    if (kind === 0x53) {
      // ParameterDescription: 0 params (we don't analyse the statement)
      const pd = Buffer.alloc(2); pd.writeInt16BE(0, 0);
      socket.write(this.msg(0x74, pd));
    }

    // RowDescription from cached portal result, or NoData
    if (kind === 0x50) {
      const portalName = body.slice(1, body.indexOf(0, 1)).toString();
      const portal = state.portals.get(portalName);
      const fields = portal?.result?.fields;
      if (fields && fields.length > 0) {
        socket.write(this.buildRowDescription(fields as { name: string; dataTypeID: number }[]));
      } else {
        socket.write(this.msg(0x6e, Buffer.alloc(0))); // NoData
      }
    }
  }

  private onExecute(socket: TCPSocket, state: ConnectionState, body: Buffer): void {
    const portalEnd = body.indexOf(0);
    const portalName = body.slice(0, portalEnd).toString();
    const portal = state.portals.get(portalName);

    const bufs: Buffer[] = [];
    if (portal) {
      // RowDescription already sent via Describe — only send DataRows + CommandComplete
      const { rows, fields } = portal.result as { rows: Record<string, unknown>[]; fields?: { name: string; dataTypeID: number }[] };
      if (fields && fields.length > 0) {
        for (const row of rows ?? []) bufs.push(this.buildDataRow(row, fields));
      }
      bufs.push(this.msg(0x43, this.cstring(commandTag(portal.query, rows?.length ?? 0))));
    } else {
      bufs.push(this.msg(0x43, this.cstring("OK")));
    }
    socket.write(Buffer.concat(bufs));
  }

  // ── Query execution ───────────────────────────────────────────────────────

  private async execute(sql: string, params?: (string | null)[]): Promise<QueryResult> {
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

  // ── Wire protocol builders ────────────────────────────────────────────────

  private buildStartupResponse(): Buffer {
    const parts: Buffer[] = [
      this.msg(0x52, this.int32(0)), // AuthenticationOk
    ];
    for (const [k, v] of [
      ["server_version", "15.1"],
      ["client_encoding", "UTF8"],
      ["DateStyle", "ISO, MDY"],
      ["TimeZone", "UTC"],
      ["integer_datetimes", "on"],
    ] as [string, string][]) {
      parts.push(this.msg(0x53, Buffer.concat([this.cstring(k), this.cstring(v)])));
    }
    parts.push(this.msg(0x4b, Buffer.concat([this.int32(1), this.int32(0)]))); // BackendKeyData
    parts.push(this.buildReadyForQuery());
    return Buffer.concat(parts);
  }

  private buildResultMessages(result: QueryResult, sql: string): Buffer[] {
    const { rows, fields } = result as { rows: Record<string, unknown>[]; fields?: { name: string; dataTypeID: number }[] };
    const bufs: Buffer[] = [];
    if (fields && fields.length > 0) {
      bufs.push(this.buildRowDescription(fields));
      for (const row of rows ?? []) bufs.push(this.buildDataRow(row, fields));
    }
    bufs.push(this.msg(0x43, this.cstring(commandTag(sql, rows?.length ?? 0))));
    return bufs;
  }

  private buildRowDescription(fields: { name: string; dataTypeID: number }[]): Buffer {
    const header = Buffer.alloc(2);
    header.writeInt16BE(fields.length, 0);
    const parts: Buffer[] = [header];
    for (const f of fields) {
      parts.push(
        this.cstring(f.name),
        this.int32(0),                       // table OID
        this.int16(0),                       // column attr number
        this.int32(f.dataTypeID || 25),      // data type OID (25=text)
        this.int16(-1),                      // type size
        this.int32(-1),                      // type modifier
        this.int16(0),                       // format code (text)
      );
    }
    return this.msg(0x54, Buffer.concat(parts));
  }

  private buildDataRow(row: Record<string, unknown>, fields: { name: string }[]): Buffer {
    const parts: Buffer[] = [this.int16(fields.length)];
    for (const f of fields) {
      const val = row[f.name];
      if (val === null || val === undefined) {
        parts.push(this.int32(-1));
      } else {
        const bytes = Buffer.from(typeof val === "object" ? JSON.stringify(val) : String(val), "utf8");
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
    return this.msg(0x45, Buffer.concat([
      Buffer.from("S"), this.cstring("ERROR"),
      Buffer.from("C"), this.cstring("XX000"),
      Buffer.from("M"), this.cstring(message),
      Buffer.from([0]),
    ]));
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
    const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b;
  }

  private int16(n: number): Buffer {
    const b = Buffer.alloc(2); b.writeInt16BE(n, 0); return b;
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
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      current += sql.slice(i, j); i = j; continue;
    }
    if (sql[i] === "$") {
      const tagEnd = sql.indexOf("$", i + 1);
      if (tagEnd !== -1) {
        const tag = sql.slice(i, tagEnd + 1);
        const closeIdx = sql.indexOf(tag, tagEnd + 1);
        if (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length; continue;
        }
      }
    }
    if (sql[i] === ";") {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = ""; i++; continue;
    }
    current += sql[i++];
  }
  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

function commandTag(sql: string, rowCount: number): string {
  const s = sql.trimStart().toUpperCase();
  if (s.startsWith("SELECT") || s.startsWith("WITH")) return `SELECT ${rowCount}`;
  if (s.startsWith("INSERT")) return `INSERT 0 ${rowCount}`;
  if (s.startsWith("UPDATE")) return `UPDATE ${rowCount}`;
  if (s.startsWith("DELETE")) return `DELETE ${rowCount}`;
  return s.split(/\s+/).slice(0, 2).join(" ");
}
