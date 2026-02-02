/**
 * Crypto utilities for auth tokens
 * Uses Web Crypto API for JWT operations (browser/edge runtime compatible)
 */

import type { PGlite } from '@electric-sql/pglite'
import type { User, TokenPair } from './types.ts'
import { signJWT, verifyJWT, decodeJWT, type JWTPayload } from './jwt.ts'

// Default token expiry: 1 hour (in seconds)
const DEFAULT_ACCESS_TOKEN_EXPIRY = 3600

// JWT secret key (in production, this should come from environment)
// For now, we'll store it in the database and retrieve it
let cachedSecret: string | null = null

/**
 * Get or create JWT secret from database
 */
async function getJWTSecret(db: PGlite): Promise<string> {
  if (cachedSecret) return cachedSecret

  // Get or create secret from database
  const result = await db.query<{ value: string }>(
    `SELECT value FROM auth.config WHERE key = 'jwt_secret'`
  )

  if (result.rows.length > 0 && result.rows[0]) {
    cachedSecret = result.rows[0].value
    return cachedSecret
  }

  // Generate new secret (256-bit random hex string)
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const secret = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

  await db.exec(`
    INSERT INTO auth.config (key, value)
    VALUES ('jwt_secret', '${secret}')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `)

  cachedSecret = secret
  return secret
}

/**
 * Create an access token using Web Crypto API
 */
export async function createAccessToken(
  db: PGlite,
  user: User,
  sessionId: string,
  expiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRY
): Promise<string> {
  const secret = await getJWTSecret(db)
  const now = Math.floor(Date.now() / 1000)

  const payload: JWTPayload = {
    sub: user.id,
    aud: 'authenticated',
    role: user.role,
    email: user.email || undefined,
    session_id: sessionId,
    iat: now,
    exp: now + expiresIn,
    user_metadata: user.user_metadata || {},
    app_metadata: user.app_metadata || {},
  }

  return signJWT(payload, secret)
}

/**
 * Verify and decode an access token using Web Crypto API
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
  const secret = await getJWTSecret(db)
  return verifyJWT(token, secret)
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
 */
export function extractUserIdFromToken(token: string): string | null {
  const payload = decodeJWT(token)
  return payload?.sub || null
}

/**
 * Extract session ID from access token without full verification
 */
export function extractSessionIdFromToken(token: string): string | null {
  const payload = decodeJWT(token)
  return payload?.session_id || null
}
