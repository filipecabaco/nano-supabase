/**
 * Node.js socket adapter
 * Wraps Node.js net module to match WinterCG Socket interface
 */

import { type Socket as NetSocket, createServer as createNetServer } from 'node:net'

import type {
  ServerOptions,
  SocketAddress,
  SocketInfo,
  SocketOptions,
  UniversalSocket,
} from '../types.js'

/**
 * Node.js socket adapter implementing WinterCG Socket interface
 */
export class NodeSocket implements UniversalSocket {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  readonly opened: Promise<SocketInfo>
  readonly closed: Promise<void>

  private socket: NetSocket
  private openedResolve!: (info: SocketInfo) => void
  private openedReject!: (error: Error) => void
  private closedResolve!: () => void

  constructor(socket: NetSocket) {
    this.socket = socket

    // Create opened promise
    this.opened = new Promise((resolve, reject) => {
      this.openedResolve = resolve
      this.openedReject = reject
    })

    // Create closed promise
    this.closed = new Promise((resolve) => {
      this.closedResolve = resolve
    })

    // Convert Node.js socket to ReadableStream
    this.readable = new ReadableStream({
      start: (controller) => {
        socket.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })

        socket.on('end', () => {
          controller.close()
        })

        socket.on('error', (error) => {
          controller.error(error)
          this.openedReject(error)
        })
      },

      cancel: () => {
        socket.destroy()
      },
    })

    // Convert Node.js socket to WritableStream
    this.writable = new WritableStream({
      write: (chunk: Uint8Array) => {
        return new Promise((resolve, reject) => {
          const canContinue = socket.write(chunk, (error) => {
            if (error) reject(error)
            else resolve()
          })

          // Handle backpressure
          if (!canContinue) {
            socket.once('drain', resolve)
          }
        })
      },

      close: () => {
        return new Promise((resolve) => {
          socket.end(() => resolve())
        })
      },

      abort: (reason) => {
        socket.destroy(reason instanceof Error ? reason : new Error(String(reason)))
      },
    })

    // Handle socket events
    // For server sockets, the connection is already established
    // For client sockets, wait for 'connect' event
    const resolveOpened = () => {
      const localAddr = socket.address()
      const remoteAddr = socket.remoteAddress
      const remotePort = socket.remotePort

      if (
        typeof localAddr === 'object' &&
        localAddr &&
        'address' in localAddr &&
        'port' in localAddr &&
        remoteAddr &&
        typeof remotePort === 'number'
      ) {
        this.openedResolve({
          localAddress: {
            hostname: localAddr.address as string,
            port: localAddr.port as number,
          },
          remoteAddress: {
            hostname: remoteAddr,
            port: remotePort,
          },
        })
      }
    }

    // If socket is already connected (server-side), resolve immediately
    if (socket.remoteAddress && socket.remotePort) {
      // Use setImmediate to ensure promise is created first
      setImmediate(resolveOpened)
    } else {
      // Client-side: wait for connect event
      socket.on('connect', resolveOpened)
    }

    socket.on('close', () => {
      this.closedResolve()
    })
  }

  async close(): Promise<void> {
    this.socket.destroy()
    return this.closed
  }
}

/**
 * Create a client socket connection (Node.js)
 */
export async function connect(
  address: SocketAddress,
  _options?: SocketOptions
): Promise<UniversalSocket> {
  const { createConnection } = await import('node:net')

  const socket = createConnection({
    host: address.hostname,
    port: address.port,
  })

  return new NodeSocket(socket)
}

/**
 * Create a TCP server (Node.js)
 */
export async function listen(options: ServerOptions): Promise<void> {
  const server = createNetServer((socket) => {
    const universalSocket = new NodeSocket(socket)
    void options.handler.onConnection(universalSocket)
  })

  server.on('error', (error) => {
    options.handler.onError?.(error)
  })

  return new Promise((resolve) => {
    server.listen(options.port, options.hostname ?? '0.0.0.0', () => {
      resolve()
    })
  })
}
