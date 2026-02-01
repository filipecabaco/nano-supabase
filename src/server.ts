/**
 * TCP Server for PGlite
 * Accepts TCP connections and routes SQL queries through the pooler
 */

import type { PGlitePooler } from './pooler.js'
import { listen } from './socket/index.js'
import type { UniversalSocket } from './socket/index.js'
import { QueryPriority } from './types.js'

/**
 * Server configuration
 */
export interface ServerConfig {
  readonly hostname?: string
  readonly port: number
  readonly pooler: PGlitePooler
}

/**
 * Simple TCP server for PGlite queries
 * Protocol: Newline-delimited SQL queries
 * Response: JSON with status and results
 */
export class PGliteServer {
  private readonly config: ServerConfig
  private readonly clients = new Set<string>()

  constructor(config: ServerConfig) {
    this.config = config
  }

  /**
   * Start the TCP server
   */
  async start(): Promise<void> {
    await this.config.pooler.start()

    await listen({
      hostname: this.config.hostname ?? '0.0.0.0',
      port: this.config.port,
      handler: {
        onConnection: (socket) => this.handleConnection(socket),
        onError: (error) => console.error('[Server] Error:', error),
      },
    })

    console.log(`[Server] Listening on ${this.config.hostname ?? '0.0.0.0'}:${this.config.port}`)
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.config.pooler.stop()
    console.log('[Server] Stopped')
  }

  /**
   * Handle incoming connection
   */
  private async handleConnection(socket: UniversalSocket): Promise<void> {
    const info = await socket.opened
    const clientId = `${info.remoteAddress.hostname}:${info.remoteAddress.port}`

    this.clients.add(clientId)
    console.log(`[Server] Client connected: ${clientId}`)

    try {
      await this.processQueries(socket, clientId)
    } catch (error) {
      console.error(`[Server] Error handling client ${clientId}:`, error)
    } finally {
      this.clients.delete(clientId)
      console.log(`[Server] Client disconnected: ${clientId}`)
    }
  }

  /**
   * Process queries from a client
   */
  private async processQueries(socket: UniversalSocket, clientId: string): Promise<void> {
    const reader = socket.readable.getReader()
    const writer = socket.writable.getWriter()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        // Accumulate data in buffer
        buffer += decoder.decode(value, { stream: true })

        // Process complete lines (queries separated by newlines)
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          await this.handleQuery(writer, encoder, clientId, trimmed)
        }
      }
    } finally {
      reader.releaseLock()
      writer.releaseLock()
    }
  }

  /**
   * Handle a single query
   */
  private async handleQuery(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    encoder: TextEncoder,
    _clientId: string,
    sql: string
  ): Promise<void> {
    try {
      // Execute query through pooler with default priority
      const result = await this.config.pooler.query(sql, [], QueryPriority.MEDIUM)

      // Send success response
      const response = JSON.stringify({
        status: 'success',
        rows: result.rows,
        rowCount: result.rows.length,
        fields: result.fields,
      })

      await writer.write(encoder.encode(response + '\n'))
    } catch (error) {
      // Send error response
      const response = JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })

      await writer.write(encoder.encode(response + '\n'))
    }
  }

  /**
   * Get connected clients
   */
  getClients(): readonly string[] {
    return Array.from(this.clients)
  }
}
