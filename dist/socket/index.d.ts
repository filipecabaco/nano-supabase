/**
 * Universal socket API
 * Automatically selects the appropriate runtime adapter
 */
import type { ServerOptions, SocketAddress, SocketOptions, UniversalSocket } from './types.js';
/**
 * Create a socket connection
 * Automatically uses the correct adapter for the current runtime
 */
export declare function connect(address: SocketAddress, options?: SocketOptions): Promise<UniversalSocket>;
/**
 * Create a TCP server
 * Automatically uses the correct adapter for the current runtime
 */
export declare function listen(options: ServerOptions): Promise<void>;
export type { ServerOptions, SocketAddress, SocketOptions, UniversalSocket } from './types.js';
export { RUNTIME, detectRuntime, isBun, isDeno, isNode, isWorkerd } from './runtime.js';
//# sourceMappingURL=index.d.ts.map