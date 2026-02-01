/**
 * Supabase-compatible client for PGlite
 * Intercepts PostgREST-style API calls and converts them to SQL
 */

import type { PGlite } from '@electric-sql/pglite'
import { PostgrestParser } from './postgrest-parser.js'

/**
 * Query builder interface compatible with Supabase-js
 */
export interface QueryBuilder<T = unknown> {
  select(columns?: string): QueryBuilder<T>
  insert(data: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder<T>
  update(data: Record<string, unknown>): QueryBuilder<T>
  delete(): QueryBuilder<T>
  eq(column: string, value: unknown): QueryBuilder<T>
  neq(column: string, value: unknown): QueryBuilder<T>
  gt(column: string, value: unknown): QueryBuilder<T>
  gte(column: string, value: unknown): QueryBuilder<T>
  lt(column: string, value: unknown): QueryBuilder<T>
  lte(column: string, value: unknown): QueryBuilder<T>
  like(column: string, pattern: string): QueryBuilder<T>
  ilike(column: string, pattern: string): QueryBuilder<T>
  in(column: string, values: unknown[]): QueryBuilder<T>
  is(column: string, value: null | boolean): QueryBuilder<T>
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder<T>
  limit(count: number): QueryBuilder<T>
  range(from: number, to: number): QueryBuilder<T>
  single(): QueryBuilder<T>
  maybeSingle(): QueryBuilder<T>
  then<TResult>(
    onfulfilled?: ((value: { data: T | null; error: Error | null }) => TResult) | null
  ): Promise<TResult>
}

/**
 * Supabase-compatible database client
 */
export class SupabaseClient {
  private readonly db: PGlite
  private readonly parser: PostgrestParser

  constructor(db: PGlite, parser: PostgrestParser) {
    this.db = db
    this.parser = parser
  }

  /**
   * Access a table for querying
   */
  from<T = unknown>(table: string): QueryBuilder<T> {
    return new PostgrestQueryBuilder<T>(this.db, this.parser, table)
  }

  /**
   * Call a stored procedure
   */
  async rpc<T = unknown>(
    functionName: string,
    params?: Record<string, unknown>
  ): Promise<{ data: T | null; error: Error | null }> {
    try {
      const parsed = this.parser.parseRpc(functionName, params)
      const result = await this.db.query(parsed.sql, [...parsed.params])
      return { data: result.rows as T, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  }
}

/**
 * Query builder implementation
 */
class PostgrestQueryBuilder<T> implements QueryBuilder<T> {
  private readonly db: PGlite
  private readonly parser: PostgrestParser
  private readonly table: string
  private selectColumns?: string
  private filters: string[] = []
  private orderBy?: string
  private limitCount?: number
  private offsetCount?: number
  private insertData?: Record<string, unknown> | Record<string, unknown>[]
  private updateData?: Record<string, unknown>
  private isDelete = false
  private expectSingle = false
  private expectMaybeSingle = false

  constructor(db: PGlite, parser: PostgrestParser, table: string) {
    this.db = db
    this.parser = parser
    this.table = table
  }

  select(columns = '*'): QueryBuilder<T> {
    this.selectColumns = columns
    return this
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder<T> {
    this.insertData = data
    return this
  }

  update(data: Record<string, unknown>): QueryBuilder<T> {
    this.updateData = data
    return this
  }

  delete(): QueryBuilder<T> {
    this.isDelete = true
    return this
  }

  eq(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`${column}=eq.${String(value)}`)
    return this
  }

  neq(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`${column}=neq.${String(value)}`)
    return this
  }

  gt(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`${column}=gt.${String(value)}`)
    return this
  }

  gte(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`${column}=gte.${String(value)}`)
    return this
  }

  lt(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`${column}=lt.${String(value)}`)
    return this
  }

  lte(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`${column}=lte.${String(value)}`)
    return this
  }

  like(column: string, pattern: string): QueryBuilder<T> {
    this.filters.push(`${column}=like.${pattern}`)
    return this
  }

  ilike(column: string, pattern: string): QueryBuilder<T> {
    this.filters.push(`${column}=ilike.${pattern}`)
    return this
  }

  in(column: string, values: unknown[]): QueryBuilder<T> {
    const joined = values.map(String).join(',')
    this.filters.push(`${column}=in.(${joined})`)
    return this
  }

  is(column: string, value: null | boolean): QueryBuilder<T> {
    const val = value === null ? 'null' : value ? 'true' : 'false'
    this.filters.push(`${column}=is.${val}`)
    return this
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder<T> {
    const direction = options?.ascending === false ? 'desc' : 'asc'
    const nulls = options?.nullsFirst ? 'nullsfirst' : 'nullslast'
    this.orderBy = `${column}.${direction}.${nulls}`
    return this
  }

  limit(count: number): QueryBuilder<T> {
    this.limitCount = count
    return this
  }

  range(from: number, to: number): QueryBuilder<T> {
    this.offsetCount = from
    this.limitCount = to - from + 1
    return this
  }

  single(): QueryBuilder<T> {
    this.expectSingle = true
    this.limitCount = 1
    return this
  }

  maybeSingle(): QueryBuilder<T> {
    this.expectMaybeSingle = true
    this.limitCount = 1
    return this
  }

  async then<TResult>(
    onfulfilled?: ((value: { data: T | null; error: Error | null }) => TResult) | null
  ): Promise<TResult> {
    const result = await this.execute()
    return onfulfilled ? onfulfilled(result) : (result as unknown as TResult)
  }

  private async execute(): Promise<{ data: T | null; error: Error | null }> {
    try {
      const queryString = this.buildQueryString()

      let parsed
      if (this.insertData !== undefined) {
        const data: Record<string, unknown> = Array.isArray(this.insertData)
          ? (this.insertData[0] ?? {})
          : this.insertData
        parsed = this.parser.parseInsert(this.table, data, queryString)
      } else if (this.updateData !== undefined) {
        parsed = this.parser.parseUpdate(this.table, this.updateData, queryString)
      } else if (this.isDelete) {
        parsed = this.parser.parseDelete(this.table, queryString)
      } else {
        parsed = this.parser.parseSelect(this.table, queryString)
      }

      const result = await this.db.query(parsed.sql, [...parsed.params])

      if (this.expectSingle && result.rows.length === 0) {
        throw new Error('No rows returned')
      }

      if (this.expectSingle && result.rows.length > 1) {
        throw new Error('Multiple rows returned')
      }

      const data = this.expectSingle || this.expectMaybeSingle
        ? (result.rows[0] as T) ?? null
        : (result.rows as T)

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  }

  private buildQueryString(): string {
    const parts: string[] = []

    if (this.selectColumns) {
      parts.push(`select=${this.selectColumns}`)
    }

    parts.push(...this.filters)

    if (this.orderBy) {
      parts.push(`order=${this.orderBy}`)
    }

    if (this.limitCount !== undefined) {
      parts.push(`limit=${this.limitCount}`)
    }

    if (this.offsetCount !== undefined) {
      parts.push(`offset=${this.offsetCount}`)
    }

    return parts.join('&')
  }
}

/**
 * Create a Supabase-compatible client with schema introspection
 */
export async function createSupabaseClient(db: PGlite): Promise<SupabaseClient> {
  await PostgrestParser.init()

  // Initialize schema introspection from the database
  await PostgrestParser.initSchema(async (sql: string) => {
    const result = await db.query(sql)
    return { rows: result.rows }
  })

  const parser = new PostgrestParser()
  return new SupabaseClient(db, parser)
}
