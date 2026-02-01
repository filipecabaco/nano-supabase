/**
 * Crypto utilities for auth tokens
 * Uses Web Crypto API for access token generation/verification
 * Password hashing is done database-side with pgcrypto
 */

import type { User, TokenPair } from './types.ts'

// Default token expiry: 1 hour (in seconds)
const DEFAULT_ACCESS_TOKEN_EXPIRY = 3600

// Secret key for signing tokens (generated once per instance)
let signingKey: CryptoKey | null = null

/**
 * Initialize or get the signing key
 */
async function getSigningKey(): Promise<CryptoKey> {
  if (signingKey) {
    return signingKey
  }

  // Generate a new signing key for this instance
  signingKey = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )

  return signingKey
}

/**
 * Base64URL encode (for JWT-like tokens)
 */
function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/**
 * Create an access token (JWT-like structure)
 */
export async function createAccessToken(
  user: User,
  sessionId: string,
  expiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRY
): Promise<string> {
  const key = await getSigningKey()

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + expiresIn

  // Create JWT-like payload
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }

  const payload = {
    sub: user.id,
    aud: user.aud,
    role: user.role,
    email: user.email,
    session_id: sessionId,
    iat: now,
    exp: expiresAt,
    user_metadata: user.user_metadata,
    app_metadata: user.app_metadata,
  }

  const encoder = new TextEncoder()
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)))

  const signatureInput = `${headerB64}.${payloadB64}`
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signatureInput)
  )

  const signatureB64 = base64UrlEncode(new Uint8Array(signature))

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Verify and decode an access token
 */
export async function verifyAccessToken(token: string): Promise<{
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
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' }
    }

    const headerB64 = parts[0]
    const payloadB64 = parts[1]
    const signatureB64 = parts[2]

    if (!headerB64 || !payloadB64 || !signatureB64) {
      return { valid: false, error: 'Invalid token format' }
    }

    const key = await getSigningKey()
    const encoder = new TextEncoder()
    const signatureInput = `${headerB64}.${payloadB64}`

    const signature = base64UrlDecode(signatureB64)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature.buffer as ArrayBuffer,
      encoder.encode(signatureInput)
    )

    if (!valid) {
      return { valid: false, error: 'Invalid signature' }
    }

    const decoder = new TextDecoder()
    const payload = JSON.parse(decoder.decode(base64UrlDecode(payloadB64)))

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token expired' }
    }

    return { valid: true, payload }
  } catch {
    return { valid: false, error: 'Token verification failed' }
  }
}

/**
 * Generate a token pair (access + refresh) for a user session
 */
export async function generateTokenPair(
  user: User,
  sessionId: string,
  refreshToken: string,
  expiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRY
): Promise<TokenPair> {
  const accessToken = await createAccessToken(user, sessionId, expiresIn)
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
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const payloadB64 = parts[1]
    if (!payloadB64) {
      return null
    }

    const decoder = new TextDecoder()
    const payload = JSON.parse(decoder.decode(base64UrlDecode(payloadB64)))
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

    const decoder = new TextDecoder()
    const payload = JSON.parse(decoder.decode(base64UrlDecode(payloadB64)))
    return payload.session_id || null
  } catch {
    return null
  }
}
