/**
 * Auth Tests for Deno
 * Tests the auth handler and auth routes
 */

import { PGlite } from '@electric-sql/pglite'
import { AuthHandler } from '../src/auth/handler.ts'
import { createAccessToken, verifyAccessToken } from '../src/auth/crypto.ts'
import { assertEquals, assertExists, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('Auth - Initialize auth schema', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)

  await authHandler.initialize()

  // Verify tables exist
  const result = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'auth'
    ORDER BY table_name
  `)

  const tables = result.rows.map((r: { table_name: string }) => r.table_name)
  assertEquals(tables.includes('users'), true, 'auth.users should exist')
  assertEquals(tables.includes('sessions'), true, 'auth.sessions should exist')
  assertEquals(tables.includes('refresh_tokens'), true, 'auth.refresh_tokens should exist')

  await db.close()
})

Deno.test('Auth - Sign up new user', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test@example.com', 'password123')

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertExists(result.data.session)
  assertEquals(result.data.user?.email, 'test@example.com')
  assertEquals(result.data.user?.role, 'authenticated')
  assertExists(result.data.session?.access_token)
  assertExists(result.data.session?.refresh_token)

  await db.close()
})

Deno.test('Auth - Sign up with user metadata', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test@example.com', 'password123', {
    data: { display_name: 'Test User', avatar_url: 'https://example.com/avatar.png' },
  })

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.user_metadata.display_name, 'Test User')
  assertEquals(result.data.user?.user_metadata.avatar_url, 'https://example.com/avatar.png')

  await db.close()
})

Deno.test('Auth - Reject duplicate signup', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // First signup
  await authHandler.signUp('test@example.com', 'password123')

  // Duplicate signup
  const result = await authHandler.signUp('test@example.com', 'different_password')

  assertExists(result.error)
  assertEquals(result.error?.code, 'user_already_exists')
  assertEquals(result.data.user, null)

  await db.close()
})

Deno.test('Auth - Sign in with correct credentials', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Create user first
  await authHandler.signUp('test@example.com', 'password123')

  // Sign in
  const result = await authHandler.signInWithPassword('test@example.com', 'password123')

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertExists(result.data.session)
  assertEquals(result.data.user?.email, 'test@example.com')

  await db.close()
})

Deno.test('Auth - Reject sign in with wrong password', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Create user first
  await authHandler.signUp('test@example.com', 'password123')

  // Sign in with wrong password
  const result = await authHandler.signInWithPassword('test@example.com', 'wrongpassword')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_credentials')

  await db.close()
})

Deno.test('Auth - Reject sign in for non-existent user', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signInWithPassword('nonexistent@example.com', 'password')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_credentials')

  await db.close()
})

Deno.test('Auth - Refresh session', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Create user and get session
  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const refreshToken = signUpResult.data.session?.refresh_token

  assertExists(refreshToken)

  // Refresh session
  const result = await authHandler.refreshSession(refreshToken!)

  assertEquals(result.error, null)
  assertExists(result.data.session)
  assertExists(result.data.session?.access_token)
  // New refresh token should be different
  assertNotEquals(result.data.session?.refresh_token, refreshToken)

  await db.close()
})

Deno.test('Auth - Reject invalid refresh token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.refreshSession('invalid-token')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_refresh_token')

  await db.close()
})

Deno.test('Auth - Get user from access token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Create user and get session
  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  assertExists(accessToken)

  // Get user
  const result = await authHandler.getUser(accessToken!)

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.email, 'test@example.com')

  await db.close()
})

Deno.test('Auth - Update user email', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Create user and get session
  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  assertExists(accessToken)

  // Update email
  const result = await authHandler.updateUser(accessToken!, {
    email: 'newemail@example.com',
  })

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.email, 'newemail@example.com')

  await db.close()
})

Deno.test('Auth - Update user metadata', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Create user and get session
  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  assertExists(accessToken)

  // Update metadata
  const result = await authHandler.updateUser(accessToken!, {
    data: { favorite_color: 'blue' },
  })

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.user_metadata.favorite_color, 'blue')

  await db.close()
})

Deno.test('Auth - Sign out', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Create user and get session
  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  assertExists(accessToken)

  // Sign out
  const result = await authHandler.signOut(accessToken)

  assertEquals(result.error, null)

  // Session should be null after sign out
  assertEquals(authHandler.getSession(), null)

  await db.close()
})

Deno.test('Auth - onAuthStateChange subscription', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const events: string[] = []

  // Subscribe to auth changes
  const subscription = authHandler.onAuthStateChange((event) => {
    events.push(event)
  })

  // Wait for initial event
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Sign up should trigger SIGNED_IN
  await authHandler.signUp('test@example.com', 'password123')

  // Wait for event
  await new Promise((resolve) => setTimeout(resolve, 10))

  assertEquals(events.includes('INITIAL_SESSION'), true)
  assertEquals(events.includes('SIGNED_IN'), true)

  // Cleanup
  subscription.unsubscribe()
  await db.close()
})

Deno.test('Crypto - Create and verify access token', async () => {
  const user = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const token = await createAccessToken(user, 'session-123', 3600)
  assertExists(token)

  // Token should have 3 parts (header.payload.signature)
  const parts = token.split('.')
  assertEquals(parts.length, 3)

  // Verify token
  const result = await verifyAccessToken(token)
  assertEquals(result.valid, true)
  assertExists(result.payload)
  assertEquals(result.payload?.sub, user.id)
  assertEquals(result.payload?.email, user.email)
  assertEquals(result.payload?.session_id, 'session-123')
})

Deno.test('Crypto - Reject expired token', async () => {
  const user = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Create token that expires immediately
  const token = await createAccessToken(user, 'session-123', -1)

  // Verify token should fail
  const result = await verifyAccessToken(token)
  assertEquals(result.valid, false)
  assertEquals(result.error, 'Token expired')
})

Deno.test('Crypto - Reject invalid token format', async () => {
  const result = await verifyAccessToken('invalid-token')
  assertEquals(result.valid, false)
  assertEquals(result.error, 'Invalid token format')
})
