/**
 * Simplified Supabase-compatible client for React demo
 * Standalone version without external dependencies
 */

import type { PGlite } from '@electric-sql/pglite'

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

export class SupabaseClient {
  constructor(private readonly db: PGlite) {}

  from<T = unknown>(table: string): QueryBuilder<T> {
    return new SimpleQueryBuilder<T>(this.db, table)
  }

  async rpc<T = unknown>(
    functionName: string,
    params?: Record<string, unknown>
  ): Promise<{ data: T | null; error: Error | null }> {
    try {
      const paramList = params
        ? Object.entries(params)
            .map(([key, val]) => `"${key}" := $${Object.keys(params).indexOf(key) + 1}`)
            .join(', ')
        : ''
      const sql = `SELECT * FROM "public"."${functionName}"(${paramList})`
      const paramValues = params ? Object.values(params) : []
      const result = await this.db.query(sql, paramValues)
      return { data: result.rows as T, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  }
}

class SimpleQueryBuilder<T> implements QueryBuilder<T> {
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

  constructor(
    private readonly db: PGlite,
    private readonly table: string
  ) {}

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
    this.filters.push(`"${column}" = ${this.toSqlValue(value)}`)
    return this
  }

  neq(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`"${column}" <> ${this.toSqlValue(value)}`)
    return this
  }

  gt(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`"${column}" > ${this.toSqlValue(value)}`)
    return this
  }

  gte(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`"${column}" >= ${this.toSqlValue(value)}`)
    return this
  }

  lt(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`"${column}" < ${this.toSqlValue(value)}`)
    return this
  }

  lte(column: string, value: unknown): QueryBuilder<T> {
    this.filters.push(`"${column}" <= ${this.toSqlValue(value)}`)
    return this
  }

  like(column: string, pattern: string): QueryBuilder<T> {
    this.filters.push(`"${column}" LIKE '${pattern}'`)
    return this
  }

  ilike(column: string, pattern: string): QueryBuilder<T> {
    this.filters.push(`"${column}" ILIKE '${pattern}'`)
    return this
  }

  in(column: string, values: unknown[]): QueryBuilder<T> {
    const valueList = values.map((v) => this.toSqlValue(v)).join(', ')
    this.filters.push(`"${column}" IN (${valueList})`)
    return this
  }

  is(column: string, value: null | boolean): QueryBuilder<T> {
    const val = value === null ? 'NULL' : value ? 'TRUE' : 'FALSE'
    this.filters.push(`"${column}" IS ${val}`)
    return this
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder<T> {
    const direction = options?.ascending === false ? 'DESC' : 'ASC'
    const nulls = options?.nullsFirst ? 'NULLS FIRST' : 'NULLS LAST'
    this.orderBy = `"${column}" ${direction} ${nulls}`
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
      let sql: string

      if (this.insertData !== undefined) {
        sql = this.buildInsertSQL()
      } else if (this.updateData !== undefined) {
        sql = this.buildUpdateSQL()
      } else if (this.isDelete) {
        sql = this.buildDeleteSQL()
      } else {
        sql = this.buildSelectSQL()
      }

      console.log('Executing SQL:', sql)
      const result = await this.db.query(sql)

      if (this.expectSingle && result.rows.length === 0) {
        throw new Error('No rows returned')
      }

      if (this.expectSingle && result.rows.length > 1) {
        throw new Error('Multiple rows returned')
      }

      const data = this.expectSingle || this.expectMaybeSingle ? (result.rows[0] as T) ?? null : (result.rows as T)

      return { data, error: null }
    } catch (error) {
      console.error('Query error:', error)
      return { data: null, error: error as Error }
    }
  }

  private buildSelectSQL(): string {
    const columns = this.selectColumns || '*'
    let sql = `SELECT ${columns} FROM "${this.table}"`

    if (this.filters.length > 0) {
      sql += ` WHERE ${this.filters.join(' AND ')}`
    }

    if (this.orderBy) {
      sql += ` ORDER BY ${this.orderBy}`
    }

    if (this.limitCount !== undefined) {
      sql += ` LIMIT ${this.limitCount}`
    }

    if (this.offsetCount !== undefined) {
      sql += ` OFFSET ${this.offsetCount}`
    }

    return sql
  }

  private buildInsertSQL(): string {
    if (!this.insertData) throw new Error('No insert data')

    const data = Array.isArray(this.insertData) ? this.insertData[0]! : this.insertData
    const columns = Object.keys(data)
    const values = Object.values(data)

    const columnList = columns.map((c) => `"${c}"`).join(', ')
    const valueList = values.map((v) => this.toSqlValue(v)).join(', ')

    return `INSERT INTO "${this.table}" (${columnList}) VALUES (${valueList})`
  }

  private buildUpdateSQL(): string {
    if (!this.updateData) throw new Error('No update data')

    const setClauses = Object.entries(this.updateData)
      .map(([key, value]) => `"${key}" = ${this.toSqlValue(value)}`)
      .join(', ')

    let sql = `UPDATE "${this.table}" SET ${setClauses}`

    if (this.filters.length > 0) {
      sql += ` WHERE ${this.filters.join(' AND ')}`
    }

    return sql
  }

  private buildDeleteSQL(): string {
    let sql = `DELETE FROM "${this.table}"`

    if (this.filters.length > 0) {
      sql += ` WHERE ${this.filters.join(' AND ')}`
    }

    return sql
  }

  private toSqlValue(value: unknown): string {
    if (value === null) return 'NULL'
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (value instanceof Date) return `'${value.toISOString()}'`
    return `'${String(value)}'`
  }
}

export async function createSupabaseClient(db: PGlite): Promise<SupabaseClient> {
  return new SupabaseClient(db)
}
