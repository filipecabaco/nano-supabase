/**
 * Runtime detection utilities
 * Detects which JavaScript runtime environment we're in
 */
export type Runtime = 'node' | 'deno' | 'bun' | 'workerd' | 'unknown';
/**
 * Detect the current runtime environment
 */
export declare function detectRuntime(): Runtime;
/**
 * Current detected runtime
 */
export declare const RUNTIME: Runtime;
/**
 * Runtime checks
 */
export declare const isNode: boolean;
export declare const isDeno: boolean;
export declare const isBun: boolean;
export declare const isWorkerd: boolean;
//# sourceMappingURL=runtime.d.ts.map