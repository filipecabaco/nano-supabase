/**
 * Data routes handler - processes /rest/v1/* requests using PostgREST parser
 */

import type { PGlite } from '@electric-sql/pglite'
import type { PostgrestParser } from '../postgrest-parser.ts'
import { getSetAuthContextSQL, CLEAR_AUTH_CONTEXT_SQL } from '../auth/schema.ts'
import { verifyAccessToken } from '../auth/crypto.ts'

/**
 * Create a JSON response
 */
function jsonResponse(data: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) {
    return null
  }
  return auth.slice(7)
}

/**
 * Parse request body as JSON
 */
async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text()
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Get auth context SQL for RLS policies (returns SQL without executing)
 */
async function getAuthContextSQL(
  db: PGlite,
  token: string | null
): Promise<{ sql: string; userId?: string; role: string; email?: string }> {
  if (!token) {
    // Anonymous access
    return { sql: CLEAR_AUTH_CONTEXT_SQL, role: 'anon' }
  }

  const verified = await verifyAccessToken(db, token)
  if (!verified.valid || !verified.payload) {
    // Invalid token, treat as anonymous
    return { sql: CLEAR_AUTH_CONTEXT_SQL, role: 'anon' }
  }

  // Set authenticated context
  const { sub: userId, role, email } = verified.payload
  const sql = getSetAuthContextSQL(userId, role, email || '')
  return { sql, userId, role, email }
}

/**
 * Handle data routes (PostgREST API)
 */
export async function handleDataRoute(
  request: Request,
  pathname: string,
  db: PGlite,
  parser: PostgrestParser
): Promise<Response> {
  const method = request.method.toUpperCase()
  const url = new URL(request.url)

  // Strip the 'columns' parameter that Supabase JS client adds
  // The parser should derive columns from the body, not from query params
  const params = new URLSearchParams(url.search)
  params.delete('columns')
  const queryString = params.toString()

  // Extract table/resource from path: /rest/v1/{table}
  const pathParts = pathname.split('/').filter(Boolean)
  // pathParts: ['rest', 'v1', 'table'] or ['rest', 'v1', 'rpc', 'function_name']
  if (pathParts.length < 3) {
    return jsonResponse(
      { message: 'Invalid path', code: 'PGRST000' },
      400
    )
  }

  const resourcePath = pathParts.slice(2).join('/') // 'table' or 'rpc/function_name'
  const token = extractBearerToken(request.headers)

  try {
    // Get auth context SQL for RLS (but don't execute yet)
    const authContext = await getAuthContextSQL(db, token)

    let parsed: { sql: string; params: readonly unknown[] }
    let body: Record<string, unknown> | null = null

    // Parse body for POST/PATCH/PUT
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      body = await parseBody(request)
      console.log('📦 [PARSE_BODY] Parsed body:', body)
      console.log('📦 [PARSE_BODY] Body type:', typeof body, Array.isArray(body) ? '(array)' : '(object)')
    }

    // Convert HTTP method to PostgREST parser method
    console.log('🔧 [PARSER] Calling parser with:', {
      method,
      resourcePath,
      queryString,
      body,
      bodyType: typeof body
    })

    switch (method) {
      case 'GET':
        parsed = parser.parseRequest('GET', resourcePath, queryString)
        break
      case 'POST':
        parsed = parser.parseRequest('POST', resourcePath, queryString, body || undefined)
        break
      case 'PATCH':
        parsed = parser.parseRequest('PATCH', resourcePath, queryString, body || undefined)
        break
      case 'PUT':
        // PUT is typically used for upsert, treat as POST with conflict handling
        parsed = parser.parseRequest('POST', resourcePath, queryString, body || undefined)
        break
      case 'DELETE':
        parsed = parser.parseRequest('DELETE', resourcePath, queryString)
        break
      default:
        return jsonResponse(
          { message: 'Method not allowed', code: 'PGRST105' },
          405
        )
    }

    console.log('🔧 [PARSER] Parser returned:', {
      sql: parsed.sql,
      paramsCount: parsed.params.length,
      params: parsed.params
    })

    // Fix parser bug: RETURNING "*" should be RETURNING *
    parsed = {
      sql: parsed.sql.replace(/RETURNING "\*"/g, 'RETURNING *'),
      params: parsed.params
    }

    // Set auth context for RLS (session-local settings)
    // Using set_config(..., false) makes these persist for the entire session
    console.log('🔐 Setting auth context:', {
      userId: authContext.userId,
      role: authContext.role,
      email: authContext.email,
      sql: authContext.sql
    })
    await db.exec(authContext.sql)

    // Verify auth context was set correctly
    const verifyResult = await db.query(`
      SELECT
        current_setting('request.jwt.claim.sub', true) as user_id,
        current_setting('request.jwt.claim.role', true) as role,
        current_setting('request.jwt.claim.email', true) as email
    `)
    console.log('🔍 Verified auth context after setting:', verifyResult.rows[0])

    // Debug: Check what auth.uid() returns
    const uidCheck = await db.query('SELECT auth.uid() as uid')
    console.log('🔍 auth.uid() returns:', uidCheck.rows[0])

    // Execute the actual query with parameters
    console.log('📝 Executing query:', {
      sql: parsed.sql,
      params: parsed.params
    })
    const result = await db.query(parsed.sql, [...parsed.params])
    console.log('✅ Query result:', {
      rowCount: result.rows.length,
      rows: result.rows
    })

    // Verify auth context is still set after query
    const verifyAfter = await db.query(`
      SELECT
        current_setting('request.jwt.claim.sub', true) as user_id,
        current_setting('request.jwt.claim.role', true) as role,
        current_setting('request.jwt.claim.email', true) as email
    `)
    console.log('🔍 Auth context after query execution:', verifyAfter.rows[0])

    // Determine response format based on headers
    const prefer = request.headers.get('Prefer') || ''
    const returnRepresentation = prefer.includes('return=representation')
    const returnMinimal = prefer.includes('return=minimal')
    const countHeader = prefer.includes('count=exact') || prefer.includes('count=planned') || prefer.includes('count=estimated')

    // Build response headers
    const responseHeaders: Record<string, string> = {}

    if (countHeader) {
      responseHeaders['Content-Range'] = `0-${result.rows.length - 1}/${result.rows.length}`
    }

    // Handle different operations
    if (method === 'GET') {
      return jsonResponse(result.rows, 200, responseHeaders)
    }

    if (method === 'POST') {
      if (returnMinimal) {
        return new Response(null, { status: 201, headers: responseHeaders })
      }
      return jsonResponse(result.rows, 201, responseHeaders)
    }

    if (method === 'PATCH' || method === 'PUT') {
      if (returnMinimal) {
        return new Response(null, { status: 204, headers: responseHeaders })
      }
      if (returnRepresentation) {
        return jsonResponse(result.rows, 200, responseHeaders)
      }
      return new Response(null, { status: 204, headers: responseHeaders })
    }

    if (method === 'DELETE') {
      if (returnRepresentation) {
        return jsonResponse(result.rows, 200, responseHeaders)
      }
      return new Response(null, { status: 204, headers: responseHeaders })
    }

    return jsonResponse(result.rows, 200, responseHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database error'
    const code = 'PGRST000'

    // Try to extract PostgreSQL error details
    let details: string | undefined
    let hint: string | undefined

    if (err instanceof Error) {
      // Check for PostgreSQL-style errors
      const pgError = err as Error & { detail?: string; hint?: string; code?: string }
      details = pgError.detail
      hint = pgError.hint
    }

    return jsonResponse(
      {
        message,
        code,
        details,
        hint,
      },
      400
    )
  }
}
