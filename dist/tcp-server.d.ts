import type { PGlite } from "@electric-sql/pglite";
import { PGlitePooler } from "./pooler.ts";
import type { PoolerConfig } from "./types.ts";
export interface TCPServerOptions {
    host?: string;
    port?: number;
}
export declare class PGliteTCPServer {
    private readonly pooler;
    private readonly password;
    private server;
    private readonly connections;
    private readonly probeCache;
    constructor(pooler: PGlitePooler, password?: string);
    static create(db: PGlite, config?: Partial<PoolerConfig>, password?: string): Promise<PGliteTCPServer>;
    start(port?: number, host?: string): Promise<void>;
    stop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    private drain;
    private handleStartup;
    private handlePasswordMessage;
    private readMessage;
    private handleMessage;
    private onSimpleQuery;
    private onParse;
    private onBind;
    private onDescribe;
    private onExecute;
    private execute;
    private executeMulti;
    private updateTxStatus;
    private buildStartupResponse;
    private buildResultMessages;
    private buildRowDescription;
    private pgText;
    private buildDataRow;
    private encodeBinary;
    private buildReadyForQuery;
    private sqlstate;
    private buildError;
    private msg;
    private cstring;
    private int32;
    private int16;
}
//# sourceMappingURL=tcp-server.d.ts.map