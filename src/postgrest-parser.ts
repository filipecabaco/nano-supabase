/**
 * PostgREST Query Parser Wrapper
 * Uses native_postgrest_parser WASM to convert PostgREST queries to SQL
 */

import init from 'native_postgrest_parser/wasm'
import { createClient } from 'native_postgrest_parser'
import type { QueryResult as ParserQueryResult } from 'native_postgrest_parser/types'

/**
 * Parsed SQL query with parameters
 */
export interface ParsedQuery {
  readonly sql: string
  readonly params: readonly unknown[]
  readonly tables: readonly string[]
}

/**
 * PostgREST parser for converting REST queries to SQL
 */
export class PostgrestParser {
  private readonly client: ReturnType<typeof createClient>
  private static initPromise: Promise<void> | null = null

  constructor() {
    this.client = createClient()
  }

  /**
   * Initialize the WASM module (must be called before first use)
   * Safe to call multiple times - initialization happens only once
   *
   * Note: This uses the web target build which works in webcontainers and edge workers.
   * For Node.js, the native_postgrest_parser package needs to be built with --target nodejs.
   */
  static async init(): Promise<void> {
    if (!PostgrestParser.initPromise) {
      PostgrestParser.initPromise = init()
    }
    await PostgrestParser.initPromise
  }

  /**
   * Parse a SELECT query from PostgREST format
   *
   * @example
   * parseSelect('users', 'id=eq.1&select=id,name')
   * // => { sql: 'SELECT "id", "name" FROM "users" WHERE "id" = $1', params: [1] }
   */
  parseSelect(table: string, queryString: string = ''): ParsedQuery {
    return this.parseRequest('GET', table, queryString)
  }

  /**
   * Parse an INSERT query from PostgREST format
   *
   * @example
   * parseInsert('users', { name: 'Alice', email: 'alice@example.com' })
   * // => { sql: 'INSERT INTO "users" ("name", "email") VALUES ($1, $2)', params: ['Alice', 'alice@example.com'] }
   */
  parseInsert(
    table: string,
    data: Record<string, unknown>,
    queryString: string = ''
  ): ParsedQuery {
    return this.parseRequest('POST', table, queryString, data)
  }

  /**
   * Parse an UPDATE query from PostgREST format
   *
   * @example
   * parseUpdate('users', { name: 'Alice' }, 'id=eq.1')
   * // => { sql: 'UPDATE "users" SET "name" = $1 WHERE "id" = $2', params: ['Alice', 1] }
   */
  parseUpdate(
    table: string,
    data: Record<string, unknown>,
    queryString: string
  ): ParsedQuery {
    return this.parseRequest('PATCH', table, queryString, data)
  }

  /**
   * Parse a DELETE query from PostgREST format
   *
   * @example
   * parseDelete('users', 'id=eq.1')
   * // => { sql: 'DELETE FROM "users" WHERE "id" = $1', params: [1] }
   */
  parseDelete(table: string, queryString: string): ParsedQuery {
    return this.parseRequest('DELETE', table, queryString)
  }

  /**
   * Parse an RPC (function call) from PostgREST format
   *
   * @example
   * parseRpc('calculate_total', { order_id: 123 })
   * // => { sql: 'SELECT * FROM "calculate_total"($1)', params: [123] }
   */
  parseRpc(
    functionName: string,
    args?: Record<string, unknown>,
    queryString: string = ''
  ): ParsedQuery {
    const path = `rpc/${functionName}`
    return this.parseRequest('POST', path, queryString, args)
  }

  /**
   * Parse a generic HTTP request to SQL
   *
   * @param method - HTTP method (GET, POST, PATCH, DELETE)
   * @param path - Path without leading slash (e.g., 'users' or 'rpc/function_name')
   * @param queryString - URL query parameters
   * @param body - Request body (for POST/PATCH)
   */
  parseRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    queryString: string = '',
    body?: Record<string, unknown>
  ): ParsedQuery {
    const result = this.client.parseRequest(method, path, queryString, body ?? null, null)
    return this.convertResult(result)
  }

  /**
   * Convert WASM result to our ParsedQuery format
   */
  private convertResult(result: ParserQueryResult): ParsedQuery {
    return {
      sql: result.query,
      params: Array.isArray(result.params) ? result.params : [],
      tables: Array.isArray(result.tables) ? result.tables : [],
    }
  }
}
