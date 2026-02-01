/**
 * Auth routes handler - processes /auth/v1/* requests
 */

import type { AuthHandler } from '../auth/handler.ts'

/**
 * Create a JSON response
 */
function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
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
async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text()
    if (!text) return {}
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Handle auth routes
 */
export async function handleAuthRoute(
  request: Request,
  pathname: string,
  authHandler: AuthHandler
): Promise<Response> {
  const method = request.method.toUpperCase()
  const url = new URL(request.url)
  const searchParams = url.searchParams

  // POST /auth/v1/signup
  if (method === 'POST' && pathname === '/auth/v1/signup') {
    const body = await parseBody(request)
    const email = body.email as string
    const password = body.password as string
    const options = body.options as { data?: Record<string, unknown> } | undefined

    if (!email || !password) {
      return jsonResponse(
        { error: 'email and password are required', error_description: 'Missing credentials' },
        400
      )
    }

    const result = await authHandler.signUp(email, password, options)

    if (result.error) {
      return jsonResponse(
        { error: result.error.code, error_description: result.error.message },
        result.error.status
      )
    }

    return jsonResponse(result.data)
  }

  // POST /auth/v1/token?grant_type=password (sign in)
  if (method === 'POST' && pathname === '/auth/v1/token') {
    const grantType = searchParams.get('grant_type')

    if (grantType === 'password') {
      const body = await parseBody(request)
      const email = body.email as string
      const password = body.password as string

      if (!email || !password) {
        return jsonResponse(
          { error: 'invalid_grant', error_description: 'Missing credentials' },
          400
        )
      }

      const result = await authHandler.signInWithPassword(email, password)

      if (result.error) {
        return jsonResponse(
          { error: 'invalid_grant', error_description: result.error.message },
          result.error.status
        )
      }

      // Return token response format
      return jsonResponse({
        access_token: result.data.session?.access_token,
        token_type: 'bearer',
        expires_in: result.data.session?.expires_in,
        expires_at: result.data.session?.expires_at,
        refresh_token: result.data.session?.refresh_token,
        user: result.data.user,
      })
    }

    if (grantType === 'refresh_token') {
      const body = await parseBody(request)
      const refreshToken = body.refresh_token as string

      if (!refreshToken) {
        return jsonResponse(
          { error: 'invalid_grant', error_description: 'Missing refresh token' },
          400
        )
      }

      const result = await authHandler.refreshSession(refreshToken)

      if (result.error) {
        return jsonResponse(
          { error: 'invalid_grant', error_description: result.error.message },
          result.error.status
        )
      }

      return jsonResponse({
        access_token: result.data.session?.access_token,
        token_type: 'bearer',
        expires_in: result.data.session?.expires_in,
        expires_at: result.data.session?.expires_at,
        refresh_token: result.data.session?.refresh_token,
        user: result.data.user,
      })
    }

    return jsonResponse(
      { error: 'unsupported_grant_type', error_description: 'Grant type not supported' },
      400
    )
  }

  // POST /auth/v1/logout
  if (method === 'POST' && pathname === '/auth/v1/logout') {
    const token = extractBearerToken(request.headers)
    const result = await authHandler.signOut(token || undefined)

    if (result.error) {
      return jsonResponse(
        { error: result.error.code, error_description: result.error.message },
        result.error.status
      )
    }

    return jsonResponse({})
  }

  // GET /auth/v1/user
  if (method === 'GET' && pathname === '/auth/v1/user') {
    const token = extractBearerToken(request.headers)

    if (!token) {
      return jsonResponse(
        { error: 'unauthorized', error_description: 'Missing authorization header' },
        401
      )
    }

    const result = await authHandler.getUser(token)

    if (result.error) {
      return jsonResponse(
        { error: result.error.code, error_description: result.error.message },
        result.error.status
      )
    }

    return jsonResponse(result.data.user)
  }

  // PUT /auth/v1/user
  if (method === 'PUT' && pathname === '/auth/v1/user') {
    const token = extractBearerToken(request.headers)

    if (!token) {
      return jsonResponse(
        { error: 'unauthorized', error_description: 'Missing authorization header' },
        401
      )
    }

    const body = await parseBody(request)
    const result = await authHandler.updateUser(token, {
      email: body.email as string | undefined,
      password: body.password as string | undefined,
      data: body.data as Record<string, unknown> | undefined,
    })

    if (result.error) {
      return jsonResponse(
        { error: result.error.code, error_description: result.error.message },
        result.error.status
      )
    }

    return jsonResponse(result.data.user)
  }

  // GET /auth/v1/session (get current session)
  if (method === 'GET' && pathname === '/auth/v1/session') {
    const token = extractBearerToken(request.headers)

    if (!token) {
      return jsonResponse({ session: null })
    }

    const userResult = await authHandler.getUser(token)
    if (userResult.error) {
      return jsonResponse({ session: null })
    }

    const session = authHandler.getSession()
    return jsonResponse({ session })
  }

  // Not found
  return jsonResponse(
    { error: 'not_found', error_description: 'Auth endpoint not found' },
    404
  )
}
