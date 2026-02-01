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
 * Set auth context for RLS policies
 */
async function setAuthContext(
  db: PGlite,
  token: string | null
): Promise<{ userId?: string; role: string; email?: string }> {
  if (!token) {
    // Anonymous access
    await db.exec(CLEAR_AUTH_CONTEXT_SQL)
    return { role: 'anon' }
  }

  const verified = await verifyAccessToken(token)
  if (!verified.valid || !verified.payload) {
    // Invalid token, treat as anonymous
    await db.exec(CLEAR_AUTH_CONTEXT_SQL)
    return { role: 'anon' }
  }

  // Set authenticated context
  const { sub: userId, role, email } = verified.payload
  await db.exec(getSetAuthContextSQL(userId, role, email || ''))
  return { userId, role, email }
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
  const queryString = url.search.slice(1) // Remove leading '?'

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
    // Set auth context for RLS
    await setAuthContext(db, token)

    let parsed
    let body: Record<string, unknown> | null = null

    // Parse body for POST/PATCH/PUT
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      body = await parseBody(request)
    }

    // Convert HTTP method to PostgREST parser method
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

    // Execute query
    const result = await db.query(parsed.sql, [...parsed.params])

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
