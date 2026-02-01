/**
 * Supabase Client Tests for Deno
 * Tests the Supabase-compatible client with PGlite
 */

import { PGlite } from '@electric-sql/pglite'
import { createSupabaseClient } from '../src/supabase-client.ts'
import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('Supabase Client - Setup database', async () => {
  const db = new PGlite()

  // Create test table
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  console.log('✓ Test database created')
  await db.close()
})

Deno.test('Supabase Client - INSERT', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .insert({ name: 'Alice', email: 'alice@example.com', age: 25 })

  assertEquals(error, null)
  assertExists(data)

  await db.close()
})

Deno.test('Supabase Client - SELECT all', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25),
      ('Bob', 'bob@example.com', 30),
      ('Charlie', 'charlie@example.com', 35)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client.from('users').select('*')

  assertEquals(error, null)
  assertExists(data)
  assertEquals((data as unknown[]).length, 3)

  await db.close()
})

Deno.test('Supabase Client - SELECT with columns', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client.from('users').select('name,email')

  assertEquals(error, null)
  assertExists(data)

  const rows = data as Array<{ name: string; email: string }>
  assertEquals(rows[0]?.name, 'Alice')
  assertEquals(rows[0]?.email, 'alice@example.com')

  await db.close()
})

Deno.test('Supabase Client - SELECT with eq filter', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25),
      ('Bob', 'bob@example.com', 30)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .select('*')
    .eq('name', 'Alice')

  assertEquals(error, null)
  assertExists(data)
  assertEquals((data as unknown[]).length, 1)

  await db.close()
})

Deno.test('Supabase Client - SELECT with multiple filters', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25),
      ('Bob', 'bob@example.com', 30),
      ('Charlie', 'charlie@example.com', 20)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .select('*')
    .gte('age', 25)
    .lte('age', 30)

  assertEquals(error, null)
  assertExists(data)
  assertEquals((data as unknown[]).length, 2)

  await db.close()
})

Deno.test('Supabase Client - UPDATE', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .update({ age: 26 })
    .eq('name', 'Alice')

  assertEquals(error, null)

  // Verify update
  const result = await db.query<{ age: number }>('SELECT age FROM users WHERE name = $1', ['Alice'])
  assertEquals(result.rows[0]?.age, 26)

  await db.close()
})

Deno.test('Supabase Client - DELETE', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25),
      ('Bob', 'bob@example.com', 30)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .delete()
    .eq('name', 'Alice')

  assertEquals(error, null)

  // Verify deletion
  const result = await db.query<{ count: number }>('SELECT COUNT(*) as count FROM users')
  assertEquals(result.rows[0]?.count, 1)

  await db.close()
})

Deno.test('Supabase Client - ORDER BY', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 30),
      ('Bob', 'bob@example.com', 25),
      ('Charlie', 'charlie@example.com', 35)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .select('name,age')
    .order('age', { ascending: true })

  assertEquals(error, null)
  assertExists(data)

  const rows = data as Array<{ name: string; age: number }>
  assertEquals(rows[0]?.name, 'Bob')
  assertEquals(rows[2]?.name, 'Charlie')

  await db.close()
})

Deno.test('Supabase Client - LIMIT', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25),
      ('Bob', 'bob@example.com', 30),
      ('Charlie', 'charlie@example.com', 35)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .select('*')
    .limit(2)

  assertEquals(error, null)
  assertExists(data)
  assertEquals((data as unknown[]).length, 2)

  await db.close()
})

Deno.test('Supabase Client - single()', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `)

  await db.exec(`
    INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25)
  `)

  const client = await createSupabaseClient(db)

  const { data, error } = await client
    .from('users')
    .select('*')
    .eq('name', 'Alice')
    .single()

  assertEquals(error, null)
  assertExists(data)
  assertEquals((data as { name: string }).name, 'Alice')

  await db.close()
})
