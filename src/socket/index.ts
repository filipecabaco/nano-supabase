/**
 * Universal socket API
 * Automatically selects the appropriate runtime adapter
 */

import { RUNTIME } from './runtime.js'
import type { ServerOptions, SocketAddress, SocketOptions, UniversalSocket } from './types.js'

/**
 * Create a socket connection
 * Automatically uses the correct adapter for the current runtime
 */
export async function connect(
  address: SocketAddress,
  options?: SocketOptions
): Promise<UniversalSocket> {
  switch (RUNTIME) {
    case 'node': {
      const { connect: nodeConnect } = await import('./adapters/node.js')
      return nodeConnect(address, options)
    }

    case 'deno': {
      // TODO: Implement Deno adapter
      throw new Error('Deno adapter not yet implemented')
    }

    case 'bun': {
      // TODO: Implement Bun adapter
      throw new Error('Bun adapter not yet implemented')
    }

    case 'workerd': {
      // TODO: Implement Cloudflare Workers adapter
      throw new Error('Cloudflare Workers adapter not yet implemented')
    }

    default:
      throw new Error(`Unsupported runtime: ${RUNTIME}`)
  }
}

/**
 * Create a TCP server
 * Automatically uses the correct adapter for the current runtime
 */
export async function listen(options: ServerOptions): Promise<void> {
  switch (RUNTIME) {
    case 'node': {
      const { listen: nodeListen } = await import('./adapters/node.js')
      return nodeListen(options)
    }

    case 'deno': {
      // TODO: Implement Deno adapter
      throw new Error('Deno adapter not yet implemented')
    }

    case 'bun': {
      // TODO: Implement Bun adapter
      throw new Error('Bun adapter not yet implemented')
    }

    case 'workerd': {
      // Cloudflare Workers doesn't support inbound TCP connections
      throw new Error('Cloudflare Workers does not support TCP servers (outbound only)')
    }

    default:
      throw new Error(`Unsupported runtime: ${RUNTIME}`)
  }
}

// Re-export types
export type { ServerOptions, SocketAddress, SocketOptions, UniversalSocket } from './types.js'
export { RUNTIME, detectRuntime, isBun, isDeno, isNode, isWorkerd } from './runtime.js'
