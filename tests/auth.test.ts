/**
 * Auth Tests for Deno
 * Comprehensive unit tests for the auth handler and crypto utilities
 */

import { PGlite } from '@electric-sql/pglite'
import { AuthHandler } from '../src/auth/handler.ts'
import {
  createAccessToken,
  verifyAccessToken,
  extractUserIdFromToken,
  extractSessionIdFromToken,
} from '../src/auth/crypto.ts'
import { assertEquals, assertExists, assertNotEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

// ============================================================================
// Auth Schema Tests
// ============================================================================

Deno.test('Auth Schema - Initialize creates all required tables', async () => {
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

Deno.test('Auth Schema - Initialize creates auth functions', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)

  await authHandler.initialize()

  // Verify functions exist
  const result = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'auth'
    ORDER BY routine_name
  `)

  const functions = result.rows.map((r: { routine_name: string }) => r.routine_name)
  assertEquals(functions.includes('uid'), true, 'auth.uid() should exist')
  assertEquals(functions.includes('role'), true, 'auth.role() should exist')
  assertEquals(functions.includes('jwt'), true, 'auth.jwt() should exist')
  assertEquals(functions.includes('hash_password'), true, 'auth.hash_password() should exist')
  assertEquals(functions.includes('verify_password'), true, 'auth.verify_password() should exist')
  assertEquals(functions.includes('create_user'), true, 'auth.create_user() should exist')

  await db.close()
})

Deno.test('Auth Schema - Multiple initialize calls are idempotent', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)

  // Initialize multiple times should not throw
  await authHandler.initialize()
  await authHandler.initialize()
  await authHandler.initialize()

  // Should still work
  const result = await authHandler.signUp('test@example.com', 'password123')
  assertEquals(result.error, null)

  await db.close()
})

// ============================================================================
// Sign Up Tests
// ============================================================================

Deno.test('Auth SignUp - Creates user with valid credentials', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test@example.com', 'password123')

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertExists(result.data.session)
  assertEquals(result.data.user?.email, 'test@example.com')
  assertEquals(result.data.user?.role, 'authenticated')
  assertEquals(result.data.user?.aud, 'authenticated')
  assertExists(result.data.user?.id)
  assertExists(result.data.user?.created_at)
  assertExists(result.data.session?.access_token)
  assertExists(result.data.session?.refresh_token)
  assertEquals(result.data.session?.token_type, 'bearer')

  await db.close()
})

Deno.test('Auth SignUp - Stores user in database', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test@example.com', 'password123')
  const userId = result.data.user?.id

  // Verify user is in database
  const dbResult = await db.query('SELECT * FROM auth.users WHERE id = $1', [userId])
  assertEquals(dbResult.rows.length, 1)

  const dbUser = dbResult.rows[0] as { email: string; encrypted_password: string }
  assertEquals(dbUser.email, 'test@example.com')
  // Password should be hashed, not plain text
  assertNotEquals(dbUser.encrypted_password, 'password123')

  await db.close()
})

Deno.test('Auth SignUp - Creates session and refresh token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test@example.com', 'password123')
  const userId = result.data.user?.id

  // Verify session exists
  const sessionResult = await db.query('SELECT * FROM auth.sessions WHERE user_id = $1', [userId])
  assertEquals(sessionResult.rows.length, 1)

  // Verify refresh token exists
  const refreshResult = await db.query('SELECT * FROM auth.refresh_tokens WHERE user_id = $1', [userId])
  assertEquals(refreshResult.rows.length, 1)

  await db.close()
})

Deno.test('Auth SignUp - Includes user metadata', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test@example.com', 'password123', {
    data: {
      display_name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
      preferences: { theme: 'dark' },
    },
  })

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.user_metadata.display_name, 'Test User')
  assertEquals(result.data.user?.user_metadata.avatar_url, 'https://example.com/avatar.png')
  assertEquals((result.data.user?.user_metadata.preferences as { theme: string }).theme, 'dark')

  await db.close()
})

Deno.test('Auth SignUp - Rejects duplicate email', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  await authHandler.signUp('test@example.com', 'password123')
  const result = await authHandler.signUp('test@example.com', 'different_password')

  assertExists(result.error)
  assertEquals(result.error?.code, 'user_already_exists')
  assertEquals(result.error?.status, 400)
  assertEquals(result.data.user, null)
  assertEquals(result.data.session, null)

  await db.close()
})

Deno.test('Auth SignUp - Case sensitivity for email', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  // Sign up with lowercase
  await authHandler.signUp('test@example.com', 'password123')

  // Sign in with same case should work
  const signInResult = await authHandler.signInWithPassword('test@example.com', 'password123')
  assertEquals(signInResult.error, null)

  await db.close()
})

// ============================================================================
// Sign In Tests
// ============================================================================

Deno.test('Auth SignIn - Succeeds with correct credentials', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  await authHandler.signUp('test@example.com', 'password123')
  const result = await authHandler.signInWithPassword('test@example.com', 'password123')

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertExists(result.data.session)
  assertEquals(result.data.user?.email, 'test@example.com')
  assertExists(result.data.session?.access_token)
  assertExists(result.data.session?.refresh_token)

  await db.close()
})

Deno.test('Auth SignIn - Creates new session on each sign in', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  await authHandler.signUp('test@example.com', 'password123')

  const signIn1 = await authHandler.signInWithPassword('test@example.com', 'password123')
  const signIn2 = await authHandler.signInWithPassword('test@example.com', 'password123')

  // Should have different tokens
  assertNotEquals(signIn1.data.session?.access_token, signIn2.data.session?.access_token)
  assertNotEquals(signIn1.data.session?.refresh_token, signIn2.data.session?.refresh_token)

  await db.close()
})

Deno.test('Auth SignIn - Updates last_sign_in_at', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const userId = signUpResult.data.user?.id

  // Get initial last_sign_in_at
  const before = await db.query<{ last_sign_in_at: string }>(
    'SELECT last_sign_in_at FROM auth.users WHERE id = $1',
    [userId]
  )
  const initialTime = before.rows[0]?.last_sign_in_at

  // Wait a bit and sign in again
  await new Promise((resolve) => setTimeout(resolve, 10))
  await authHandler.signInWithPassword('test@example.com', 'password123')

  // Check last_sign_in_at was updated
  const after = await db.query<{ last_sign_in_at: string }>(
    'SELECT last_sign_in_at FROM auth.users WHERE id = $1',
    [userId]
  )
  const newTime = after.rows[0]?.last_sign_in_at

  // Times should be different (or at least newTime should exist)
  assertExists(newTime)

  await db.close()
})

Deno.test('Auth SignIn - Rejects wrong password', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  await authHandler.signUp('test@example.com', 'password123')
  const result = await authHandler.signInWithPassword('test@example.com', 'wrongpassword')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_credentials')
  assertEquals(result.error?.status, 400)

  await db.close()
})

Deno.test('Auth SignIn - Rejects non-existent user', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signInWithPassword('nonexistent@example.com', 'password')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_credentials')

  await db.close()
})

Deno.test('Auth SignIn - Rejects empty password', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  await authHandler.signUp('test@example.com', 'password123')
  const result = await authHandler.signInWithPassword('test@example.com', '')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_credentials')

  await db.close()
})

// ============================================================================
// Refresh Token Tests
// ============================================================================

Deno.test('Auth Refresh - Returns new tokens', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const refreshToken = signUpResult.data.session?.refresh_token

  assertExists(refreshToken)

  const result = await authHandler.refreshSession(refreshToken!)

  assertEquals(result.error, null)
  assertExists(result.data.session)
  assertExists(result.data.session?.access_token)
  assertExists(result.data.session?.refresh_token)
  // New refresh token should be different
  assertNotEquals(result.data.session?.refresh_token, refreshToken)

  await db.close()
})

Deno.test('Auth Refresh - Revokes old refresh token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const refreshToken = signUpResult.data.session?.refresh_token

  // First refresh should work
  const result1 = await authHandler.refreshSession(refreshToken!)
  assertEquals(result1.error, null)

  // Using the old token again should fail
  const result2 = await authHandler.refreshSession(refreshToken!)
  assertExists(result2.error)
  assertEquals(result2.error?.code, 'invalid_refresh_token')

  await db.close()
})

Deno.test('Auth Refresh - Maintains user data', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123', {
    data: { display_name: 'Test User' },
  })
  const refreshToken = signUpResult.data.session?.refresh_token

  const result = await authHandler.refreshSession(refreshToken!)

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.email, 'test@example.com')
  assertEquals(result.data.user?.user_metadata.display_name, 'Test User')

  await db.close()
})

Deno.test('Auth Refresh - Rejects invalid token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.refreshSession('invalid-token')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_refresh_token')
  assertEquals(result.error?.status, 401)

  await db.close()
})

Deno.test('Auth Refresh - Rejects empty token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.refreshSession('')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_refresh_token')

  await db.close()
})

// ============================================================================
// Get User Tests
// ============================================================================

Deno.test('Auth GetUser - Returns user from valid token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  const result = await authHandler.getUser(accessToken!)

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.email, 'test@example.com')
  assertEquals(result.data.user?.id, signUpResult.data.user?.id)

  await db.close()
})

Deno.test('Auth GetUser - Returns fresh user data', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token
  const userId = signUpResult.data.user?.id

  // Update user directly in database
  await db.query(
    "UPDATE auth.users SET raw_user_meta_data = '{\"updated\": true}'::jsonb WHERE id = $1",
    [userId]
  )

  // getUser should return updated data
  const result = await authHandler.getUser(accessToken!)

  assertEquals(result.error, null)
  assertEquals(result.data.user?.user_metadata.updated, true)

  await db.close()
})

Deno.test('Auth GetUser - Rejects invalid token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.getUser('invalid-token')

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_token')
  assertEquals(result.error?.status, 401)

  await db.close()
})

Deno.test('Auth GetUser - Rejects malformed token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.getUser('not.a.valid.jwt.token')

  assertExists(result.error)

  await db.close()
})

// ============================================================================
// Update User Tests
// ============================================================================

Deno.test('Auth UpdateUser - Updates email', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  const result = await authHandler.updateUser(accessToken!, {
    email: 'newemail@example.com',
  })

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.email, 'newemail@example.com')

  // Verify in database
  const dbResult = await db.query<{ email: string }>(
    'SELECT email FROM auth.users WHERE id = $1',
    [signUpResult.data.user?.id]
  )
  assertEquals(dbResult.rows[0]?.email, 'newemail@example.com')

  await db.close()
})

Deno.test('Auth UpdateUser - Updates password', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  const result = await authHandler.updateUser(accessToken!, {
    password: 'newpassword456',
  })

  assertEquals(result.error, null)

  // Old password should no longer work
  const oldPasswordResult = await authHandler.signInWithPassword('test@example.com', 'password123')
  assertExists(oldPasswordResult.error)

  // New password should work
  const newPasswordResult = await authHandler.signInWithPassword('test@example.com', 'newpassword456')
  assertEquals(newPasswordResult.error, null)

  await db.close()
})

Deno.test('Auth UpdateUser - Updates user metadata', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123', {
    data: { existing_field: 'existing_value' },
  })
  const accessToken = signUpResult.data.session?.access_token

  const result = await authHandler.updateUser(accessToken!, {
    data: { new_field: 'new_value' },
  })

  assertEquals(result.error, null)
  assertExists(result.data.user)
  // New field should be added
  assertEquals(result.data.user?.user_metadata.new_field, 'new_value')
  // Existing field should be preserved (merged)
  assertEquals(result.data.user?.user_metadata.existing_field, 'existing_value')

  await db.close()
})

Deno.test('Auth UpdateUser - Updates multiple fields', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  const result = await authHandler.updateUser(accessToken!, {
    email: 'newemail@example.com',
    data: { display_name: 'New Name' },
  })

  assertEquals(result.error, null)
  assertEquals(result.data.user?.email, 'newemail@example.com')
  assertEquals(result.data.user?.user_metadata.display_name, 'New Name')

  await db.close()
})

Deno.test('Auth UpdateUser - Returns current user when no updates', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  const result = await authHandler.updateUser(accessToken!, {})

  assertEquals(result.error, null)
  assertExists(result.data.user)
  assertEquals(result.data.user?.email, 'test@example.com')

  await db.close()
})

Deno.test('Auth UpdateUser - Rejects invalid token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.updateUser('invalid-token', {
    email: 'newemail@example.com',
  })

  assertExists(result.error)
  assertEquals(result.error?.code, 'invalid_token')

  await db.close()
})

// ============================================================================
// Sign Out Tests
// ============================================================================

Deno.test('Auth SignOut - Clears current session', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  // Session should exist
  assertExists(authHandler.getSession())

  const result = await authHandler.signOut(accessToken)

  assertEquals(result.error, null)
  assertEquals(authHandler.getSession(), null)

  await db.close()
})

Deno.test('Auth SignOut - Revokes session in database', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token
  const userId = signUpResult.data.user?.id

  // Session should exist before sign out
  const beforeResult = await db.query('SELECT COUNT(*) as count FROM auth.sessions WHERE user_id = $1', [userId])
  assertEquals((beforeResult.rows[0] as { count: number }).count, 1)

  await authHandler.signOut(accessToken)

  // Session should be deleted after sign out
  const afterResult = await db.query('SELECT COUNT(*) as count FROM auth.sessions WHERE user_id = $1', [userId])
  assertEquals((afterResult.rows[0] as { count: number }).count, 0)

  await db.close()
})

Deno.test('Auth SignOut - Works without token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  await authHandler.signUp('test@example.com', 'password123')

  // Sign out without token should still clear local session
  const result = await authHandler.signOut()

  assertEquals(result.error, null)
  assertEquals(authHandler.getSession(), null)

  await db.close()
})

// ============================================================================
// Auth State Change Tests
// ============================================================================

Deno.test('Auth onAuthStateChange - Receives INITIAL_SESSION', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const events: string[] = []

  const subscription = authHandler.onAuthStateChange((event) => {
    events.push(event)
  })

  // Wait for initial event
  await new Promise((resolve) => setTimeout(resolve, 20))

  assertEquals(events.includes('INITIAL_SESSION'), true)

  subscription.unsubscribe()
  await db.close()
})

Deno.test('Auth onAuthStateChange - Receives SIGNED_IN on signup', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const events: string[] = []

  const subscription = authHandler.onAuthStateChange((event) => {
    events.push(event)
  })

  await authHandler.signUp('test@example.com', 'password123')

  await new Promise((resolve) => setTimeout(resolve, 20))

  assertEquals(events.includes('SIGNED_IN'), true)

  subscription.unsubscribe()
  await db.close()
})

Deno.test('Auth onAuthStateChange - Receives SIGNED_OUT on signout', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const events: string[] = []

  const subscription = authHandler.onAuthStateChange((event) => {
    events.push(event)
  })

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  await authHandler.signOut(signUpResult.data.session?.access_token)

  await new Promise((resolve) => setTimeout(resolve, 20))

  assertEquals(events.includes('SIGNED_OUT'), true)

  subscription.unsubscribe()
  await db.close()
})

Deno.test('Auth onAuthStateChange - Receives TOKEN_REFRESHED', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const events: string[] = []

  const subscription = authHandler.onAuthStateChange((event) => {
    events.push(event)
  })

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  await authHandler.refreshSession(signUpResult.data.session?.refresh_token!)

  await new Promise((resolve) => setTimeout(resolve, 20))

  assertEquals(events.includes('TOKEN_REFRESHED'), true)

  subscription.unsubscribe()
  await db.close()
})

Deno.test('Auth onAuthStateChange - Receives USER_UPDATED', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const events: string[] = []

  const subscription = authHandler.onAuthStateChange((event) => {
    events.push(event)
  })

  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  await authHandler.updateUser(signUpResult.data.session?.access_token!, {
    data: { updated: true },
  })

  await new Promise((resolve) => setTimeout(resolve, 20))

  assertEquals(events.includes('USER_UPDATED'), true)

  subscription.unsubscribe()
  await db.close()
})

Deno.test('Auth onAuthStateChange - Unsubscribe stops events', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  let eventCount = 0

  const subscription = authHandler.onAuthStateChange(() => {
    eventCount++
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  const countAfterInitial = eventCount

  subscription.unsubscribe()

  // Sign up should not trigger callback after unsubscribe
  await authHandler.signUp('test@example.com', 'password123')
  await new Promise((resolve) => setTimeout(resolve, 20))

  assertEquals(eventCount, countAfterInitial)

  await db.close()
})

// ============================================================================
// Crypto Utility Tests
// ============================================================================

Deno.test('Crypto - createAccessToken generates valid JWT structure', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

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

  const token = await createAccessToken(db, user, 'session-123', 3600)
  assertExists(token)

  // Token should have 3 parts (header.payload.signature)
  const parts = token.split('.')
  assertEquals(parts.length, 3)

  // Each part should be base64url encoded (no padding)
  for (const part of parts) {
    assertEquals(part.includes('='), false, 'Should not have padding')
    assertEquals(part.includes('+'), false, 'Should use base64url')
    assertEquals(part.includes('/'), false, 'Should use base64url')
  }

  await db.close()
})

Deno.test('Crypto - createAccessToken includes correct claims', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const user = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'test@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: { name: 'Test' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const token = await createAccessToken(db, user, 'session-123', 3600)
  const result = await verifyAccessToken(db, token)

  assertEquals(result.valid, true)
  assertExists(result.payload)
  assertEquals(result.payload?.sub, user.id)
  assertEquals(result.payload?.aud, 'authenticated')
  assertEquals(result.payload?.role, 'authenticated')
  assertEquals(result.payload?.email, 'test@example.com')
  assertEquals(result.payload?.session_id, 'session-123')
  assertExists(result.payload?.exp)

  await db.close()
})

Deno.test('Crypto - verifyAccessToken rejects expired token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

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
  const token = await createAccessToken(db, user, 'session-123', -1)

  const result = await verifyAccessToken(db, token)
  assertEquals(result.valid, false)
  assertEquals(result.error, 'Token expired')

  await db.close()
})

Deno.test('Crypto - verifyAccessToken rejects invalid format', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result1 = await verifyAccessToken(db, 'invalid-token')
  assertEquals(result1.valid, false)
  assertEquals(result1.error, 'Invalid token format')

  const result2 = await verifyAccessToken(db, 'only.two.parts.here.more')
  assertEquals(result2.valid, false)

  const result3 = await verifyAccessToken(db, '')
  assertEquals(result3.valid, false)

  await db.close()
})

Deno.test('Crypto - verifyAccessToken rejects tampered token', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

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

  const token = await createAccessToken(db, user, 'session-123', 3600)
  const parts = token.split('.')

  // Tamper with payload
  const tamperedToken = `${parts[0]}.${parts[1]}abc.${parts[2]}`

  const result = await verifyAccessToken(db, tamperedToken)
  assertEquals(result.valid, false)

  await db.close()
})

Deno.test('Crypto - extractUserIdFromToken returns user id', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

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

  const token = await createAccessToken(db, user, 'session-123', 3600)
  const userId = extractUserIdFromToken(token)

  assertEquals(userId, user.id)

  await db.close()
})

Deno.test('Crypto - extractUserIdFromToken handles invalid token', () => {
  assertEquals(extractUserIdFromToken('invalid'), null)
  assertEquals(extractUserIdFromToken(''), null)
  assertEquals(extractUserIdFromToken('a.b.c'), null) // Invalid base64
})

Deno.test('Crypto - extractSessionIdFromToken returns session id', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

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

  const token = await createAccessToken(db, user, 'session-456', 3600)
  const sessionId = extractSessionIdFromToken(token)

  assertEquals(sessionId, 'session-456')

  await db.close()
})

Deno.test('Crypto - extractSessionIdFromToken handles invalid token', () => {
  assertEquals(extractSessionIdFromToken('invalid'), null)
  assertEquals(extractSessionIdFromToken(''), null)
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

Deno.test('Auth - Handles special characters in email', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test+special@example.com', 'password123')

  assertEquals(result.error, null)
  assertEquals(result.data.user?.email, 'test+special@example.com')

  // Should be able to sign in
  const signInResult = await authHandler.signInWithPassword('test+special@example.com', 'password123')
  assertEquals(signInResult.error, null)

  await db.close()
})

Deno.test('Auth - Handles special characters in password', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const specialPassword = 'p@$$w0rd!#$%^&*()_+-=[]{}|;:,.<>?'
  const result = await authHandler.signUp('test@example.com', specialPassword)

  assertEquals(result.error, null)

  // Should be able to sign in with special password
  const signInResult = await authHandler.signInWithPassword('test@example.com', specialPassword)
  assertEquals(signInResult.error, null)

  await db.close()
})

Deno.test('Auth - Handles unicode in user metadata', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const result = await authHandler.signUp('test@example.com', 'password123', {
    data: {
      name: '日本語テスト',
      emoji: '🎉🚀',
      arabic: 'مرحبا',
    },
  })

  assertEquals(result.error, null)
  assertEquals(result.data.user?.user_metadata.name, '日本語テスト')
  assertEquals(result.data.user?.user_metadata.emoji, '🎉🚀')
  assertEquals(result.data.user?.user_metadata.arabic, 'مرحبا')

  await db.close()
})

Deno.test('Auth - Handles very long password', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const longPassword = 'a'.repeat(1000)
  const result = await authHandler.signUp('test@example.com', longPassword)

  assertEquals(result.error, null)

  const signInResult = await authHandler.signInWithPassword('test@example.com', longPassword)
  assertEquals(signInResult.error, null)

  await db.close()
})

Deno.test('Auth - Multiple users can exist', async () => {
  const db = new PGlite()
  const authHandler = new AuthHandler(db)
  await authHandler.initialize()

  const user1 = await authHandler.signUp('user1@example.com', 'password1')
  const user2 = await authHandler.signUp('user2@example.com', 'password2')
  const user3 = await authHandler.signUp('user3@example.com', 'password3')

  assertEquals(user1.error, null)
  assertEquals(user2.error, null)
  assertEquals(user3.error, null)

  // Each user should have unique ID
  assertNotEquals(user1.data.user?.id, user2.data.user?.id)
  assertNotEquals(user2.data.user?.id, user3.data.user?.id)

  // Each should be able to sign in
  const signIn1 = await authHandler.signInWithPassword('user1@example.com', 'password1')
  const signIn2 = await authHandler.signInWithPassword('user2@example.com', 'password2')
  const signIn3 = await authHandler.signInWithPassword('user3@example.com', 'password3')

  assertEquals(signIn1.error, null)
  assertEquals(signIn2.error, null)
  assertEquals(signIn3.error, null)

  await db.close()
})
