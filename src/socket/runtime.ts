/**
 * Runtime detection utilities
 * Detects which JavaScript runtime environment we're in
 */

// Declare global types for runtime detection
declare const Deno: { version?: { deno?: string } } | undefined
declare const Bun: { version?: string } | undefined

export type Runtime = 'node' | 'deno' | 'bun' | 'workerd' | 'unknown'

/**
 * Detect the current runtime environment
 */
export function detectRuntime(): Runtime {
  // Check for Deno
  if (typeof Deno !== 'undefined' && Deno?.version?.deno) {
    return 'deno'
  }

  // Check for Bun
  if (typeof Bun !== 'undefined' && Bun?.version) {
    return 'bun'
  }

  // Check for Cloudflare Workers (workerd)
  if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
    return 'workerd'
  }

  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node'
  }

  return 'unknown'
}

/**
 * Current detected runtime
 */
export const RUNTIME = detectRuntime()

/**
 * Runtime checks
 */
export const isNode = RUNTIME === 'node'
export const isDeno = RUNTIME === 'deno'
export const isBun = RUNTIME === 'bun'
export const isWorkerd = RUNTIME === 'workerd'
