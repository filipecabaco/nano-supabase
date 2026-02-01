/**
 * Fetch Adapter Tests for Deno
 * Tests the scoped fetch adapter with auth and data routes
 */

import { PGlite } from '@electric-sql/pglite'
import { createFetchAdapter } from '../src/client.ts'
import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const SUPABASE_URL = 'http://localhost:54321'

Deno.test('Fetch Adapter - Intercept auth signup', async () => {
  const db = new PGlite()
  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  const response = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@example.com',
      password: 'password123',
    }),
  })

  assertEquals(response.status, 200)

  const data = await response.json()
  assertExists(data.user)
  assertExists(data.session)
  assertEquals(data.user.email, 'test@example.com')

  await db.close()
})

Deno.test('Fetch Adapter - Intercept auth token (sign in)', async () => {
  const db = new PGlite()
  const { localFetch, authHandler } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  // First sign up
  await authHandler.signUp('test@example.com', 'password123')

  // Then sign in via fetch
  const response = await localFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@example.com',
      password: 'password123',
    }),
  })

  assertEquals(response.status, 200)

  const data = await response.json()
  assertExists(data.access_token)
  assertExists(data.refresh_token)
  assertExists(data.user)

  await db.close()
})

Deno.test('Fetch Adapter - Intercept auth user (get user)', async () => {
  const db = new PGlite()
  const { localFetch, authHandler } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  // Sign up and get token
  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token

  // Get user via fetch
  const response = await localFetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  assertEquals(response.status, 200)

  const data = await response.json()
  assertEquals(data.email, 'test@example.com')

  await db.close()
})

Deno.test('Fetch Adapter - Intercept data routes (SELECT)', async () => {
  const db = new PGlite()

  // Create test table
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob', 'bob@example.com')
  `)

  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  const response = await localFetch(`${SUPABASE_URL}/rest/v1/users?select=*`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  assertEquals(response.status, 200)

  const data = await response.json()
  assertEquals(data.length, 2)
  assertEquals(data[0].name, 'Alice')

  await db.close()
})

Deno.test('Fetch Adapter - Intercept data routes (INSERT)', async () => {
  const db = new PGlite()

  // Create test table
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `)

  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  const response = await localFetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com' }),
  })

  assertEquals(response.status, 201)

  // Verify insert
  const result = await db.query('SELECT * FROM users')
  assertEquals(result.rows.length, 1)

  await db.close()
})

Deno.test('Fetch Adapter - Intercept data routes (UPDATE)', async () => {
  const db = new PGlite()

  // Create test table
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
  `)

  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  const response = await localFetch(`${SUPABASE_URL}/rest/v1/users?name=eq.Alice`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newalice@example.com' }),
  })

  assertEquals(response.status, 204)

  // Verify update
  const result = await db.query<{ email: string }>('SELECT email FROM users WHERE name = $1', ['Alice'])
  assertEquals(result.rows[0]?.email, 'newalice@example.com')

  await db.close()
})

Deno.test('Fetch Adapter - Intercept data routes (DELETE)', async () => {
  const db = new PGlite()

  // Create test table
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob', 'bob@example.com')
  `)

  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  const response = await localFetch(`${SUPABASE_URL}/rest/v1/users?name=eq.Alice`, {
    method: 'DELETE',
  })

  assertEquals(response.status, 204)

  // Verify delete
  const result = await db.query('SELECT * FROM users')
  assertEquals(result.rows.length, 1)

  await db.close()
})

Deno.test('Fetch Adapter - Passthrough non-Supabase requests', async () => {
  const db = new PGlite()

  let passthroughCalled = false
  const mockOriginalFetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    passthroughCalled = true
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url)
    return new Response(JSON.stringify({ url }), { status: 200 })
  }

  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
    originalFetch: mockOriginalFetch,
  })

  // Request to a different URL should pass through
  const response = await localFetch('https://api.example.com/data', {
    method: 'GET',
  })

  assertEquals(passthroughCalled, true)
  assertEquals(response.status, 200)

  await db.close()
})

Deno.test('Fetch Adapter - Passthrough storage requests', async () => {
  const db = new PGlite()

  let passthroughCalled = false
  const mockOriginalFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    passthroughCalled = true
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
  }

  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
    originalFetch: mockOriginalFetch,
  })

  // Storage requests should pass through
  const response = await localFetch(`${SUPABASE_URL}/storage/v1/bucket/file.png`, {
    method: 'GET',
  })

  assertEquals(passthroughCalled, true)
  assertEquals(response.status, 200)

  await db.close()
})

Deno.test('Fetch Adapter - RLS context with authenticated user', async () => {
  const db = new PGlite()

  // Create test table with RLS
  await db.exec(`
    CREATE TABLE profiles (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      display_name TEXT NOT NULL
    )
  `)

  const { localFetch, authHandler } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  // Sign up and get token
  const signUpResult = await authHandler.signUp('test@example.com', 'password123')
  const accessToken = signUpResult.data.session?.access_token
  const userId = signUpResult.data.user?.id

  // Insert a profile for this user
  await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)', [userId, 'Test User'])

  // Fetch with auth token - should set RLS context
  const response = await localFetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  assertEquals(response.status, 200)

  const data = await response.json()
  assertEquals(data.length, 1)
  assertEquals(data[0].display_name, 'Test User')

  await db.close()
})
