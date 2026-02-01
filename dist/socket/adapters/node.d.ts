/**
 * Node.js socket adapter
 * Wraps Node.js net module to match WinterCG Socket interface
 */
import { type Socket as NetSocket } from 'node:net';
import type { ServerOptions, SocketAddress, SocketInfo, SocketOptions, UniversalSocket } from '../types.js';
/**
 * Node.js socket adapter implementing WinterCG Socket interface
 */
export declare class NodeSocket implements UniversalSocket {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    readonly opened: Promise<SocketInfo>;
    readonly closed: Promise<void>;
    private socket;
    private openedResolve;
    private openedReject;
    private closedResolve;
    constructor(socket: NetSocket);
    close(): Promise<void>;
}
/**
 * Create a client socket connection (Node.js)
 */
export declare function connect(address: SocketAddress, _options?: SocketOptions): Promise<UniversalSocket>;
/**
 * Create a TCP server (Node.js)
 */
export declare function listen(options: ServerOptions): Promise<void>;
//# sourceMappingURL=node.d.ts.map