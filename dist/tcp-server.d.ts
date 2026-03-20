import { Buffer } from "node:buffer";
import type { PGlite } from "@electric-sql/pglite";
import { PGlitePooler } from "./pooler.ts";
import type { PoolerConfig } from "./types.ts";
export interface TCPServerOptions {
    host?: string;
    port?: number;
}
export interface TLSConfig {
    cert: Buffer;
    key: Buffer;
}
export declare class PGliteTCPServer {
    private readonly pooler;
    private readonly password;
    private readonly tls;
    private server;
    private readonly connections;
    private readonly probeCache;
    constructor(pooler: PGlitePooler, password?: string, tls?: TLSConfig);
    static create(db: PGlite, config?: Partial<PoolerConfig>, password?: string, tls?: TLSConfig): Promise<PGliteTCPServer>;
    start(port?: number, host?: string): Promise<void>;
    stop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    private drain;
    private handleStartup;
    private handlePasswordMessage;
    private handleMessage;
}
export type MuxRoute = (user: string) => Promise<{
    pooler: PGlitePooler;
    password: string;
} | null>;
export declare class PGliteTCPMuxServer {
    private readonly route;
    private server;
    private readonly connections;
    private readonly probeCaches;
    private readonly tls;
    constructor(route: MuxRoute, opts?: {
        tls?: TLSConfig;
    });
    start(port?: number, host?: string): Promise<void>;
    stop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    private drainMux;
    private handleMuxStartup;
    private handleMuxPassword;
    private handleMuxMessage;
}
//# sourceMappingURL=tcp-server.d.ts.map