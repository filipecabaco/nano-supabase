/**
 * Crypto utilities for auth tokens
 * Uses pgcrypto database functions for all cryptographic operations
 */

import type { PGlite } from '@electric-sql/pglite'
import type { User, TokenPair } from './types.ts'

// Default token expiry: 1 hour (in seconds)
const DEFAULT_ACCESS_TOKEN_EXPIRY = 3600

/**
 * Token verification result from database
 */
interface TokenVerificationRow {
  valid: boolean
  user_id: string | null
  session_id: string | null
  email: string | null
  role: string | null
  exp: number | null
  user_metadata: Record<string, unknown> | null
  app_metadata: Record<string, unknown> | null
  error: string | null
}

/**
 * Create an access token using database function
 */
export async function createAccessToken(
  db: PGlite,
  user: User,
  sessionId: string,
  expiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRY
): Promise<string> {
  const result = await db.query<{ create_access_token: string }>(
    `SELECT auth.create_access_token($1, $2, $3, $4, $5, $6, $7) as create_access_token`,
    [
      user.id,
      sessionId,
      user.email || '',
      user.role,
      JSON.stringify(user.user_metadata),
      JSON.stringify(user.app_metadata),
      expiresIn,
    ]
  )

  const row = result.rows[0]
  if (!row) {
    throw new Error('Failed to create access token')
  }

  return row.create_access_token
}

/**
 * Verify and decode an access token using database function
 */
export async function verifyAccessToken(
  db: PGlite,
  token: string
): Promise<{
  valid: boolean
  payload?: {
    sub: string
    aud: string
    role: string
    email?: string
    session_id: string
    iat: number
    exp: number
    user_metadata: Record<string, unknown>
    app_metadata: Record<string, unknown>
  }
  error?: string
}> {
  try {
    const result = await db.query<TokenVerificationRow>(
      `SELECT * FROM auth.verify_access_token($1)`,
      [token]
    )

    const row = result.rows[0]
    if (!row) {
      return { valid: false, error: 'Verification failed' }
    }

    if (!row.valid) {
      return { valid: false, error: row.error || 'Invalid token' }
    }

    return {
      valid: true,
      payload: {
        sub: row.user_id!,
        aud: 'authenticated',
        role: row.role || 'authenticated',
        email: row.email || undefined,
        session_id: row.session_id!,
        iat: Math.floor(Date.now() / 1000), // Approximation since we don't store iat separately
        exp: Number(row.exp),
        user_metadata: row.user_metadata || {},
        app_metadata: row.app_metadata || {},
      },
    }
  } catch {
    return { valid: false, error: 'Token verification failed' }
  }
}

/**
 * Generate a token pair (access + refresh) for a user session
 */
export async function generateTokenPair(
  db: PGlite,
  user: User,
  sessionId: string,
  refreshToken: string,
  expiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRY
): Promise<TokenPair> {
  const accessToken = await createAccessToken(db, user, sessionId, expiresIn)
  const now = Math.floor(Date.now() / 1000)

  return {
    accessToken,
    refreshToken,
    expiresIn,
    expiresAt: now + expiresIn,
  }
}

/**
 * Extract user ID from access token without full verification
 * (useful for quick checks, but should verify for security-sensitive operations)
 * This uses simple base64 decoding without cryptographic verification
 */
export function extractUserIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const payloadB64 = parts[1]
    if (!payloadB64) {
      return null
    }

    const payload = JSON.parse(base64UrlDecode(payloadB64))
    return payload.sub || null
  } catch {
    return null
  }
}

/**
 * Extract session ID from access token without full verification
 */
export function extractSessionIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const payloadB64 = parts[1]
    if (!payloadB64) {
      return null
    }

    const payload = JSON.parse(base64UrlDecode(payloadB64))
    return payload.session_id || null
  } catch {
    return null
  }
}

/**
 * Base64URL decode helper (for extracting token payload without verification)
 */
function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return atob(padded)
}
