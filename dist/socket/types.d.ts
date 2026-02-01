/**
 * Socket abstraction layer following WinterCG Sockets API specification
 * https://sockets-api.proposal.wintertc.org/
 */
/**
 * Socket address configuration
 */
export interface SocketAddress {
    readonly hostname: string;
    readonly port: number;
}
/**
 * Socket connection options
 */
export interface SocketOptions {
    /**
     * TLS configuration
     * - "off": Plain TCP (default)
     * - "on": TLS from the start
     * - "starttls": Upgrade to TLS after connection
     */
    readonly secureTransport?: 'off' | 'on' | 'starttls';
    /**
     * Allow half-open connections (one side closed)
     * Default: false
     */
    readonly allowHalfOpen?: boolean;
}
/**
 * Socket connection info
 */
export interface SocketInfo {
    readonly localAddress: SocketAddress;
    readonly remoteAddress: SocketAddress;
}
/**
 * Universal socket interface following WinterCG specification
 * Works across Node.js, Deno, Bun, Cloudflare Workers
 */
export interface UniversalSocket {
    /**
     * Readable stream for incoming data
     */
    readonly readable: ReadableStream<Uint8Array>;
    /**
     * Writable stream for outgoing data (accepts Uint8Array only)
     */
    readonly writable: WritableStream<Uint8Array>;
    /**
     * Promise that resolves when connection is established
     */
    readonly opened: Promise<SocketInfo>;
    /**
     * Promise that resolves when socket is closed
     */
    readonly closed: Promise<void>;
    /**
     * Close the socket
     */
    close(): Promise<void>;
}
/**
 * Socket server handler interface
 */
export interface SocketHandler {
    /**
     * Called when a new connection is established
     */
    onConnection(socket: UniversalSocket): void | Promise<void>;
    /**
     * Called when an error occurs
     */
    onError?(error: Error): void;
}
/**
 * Socket server configuration
 */
export interface ServerOptions {
    readonly hostname?: string;
    readonly port: number;
    readonly handler: SocketHandler;
}
//# sourceMappingURL=types.d.ts.map