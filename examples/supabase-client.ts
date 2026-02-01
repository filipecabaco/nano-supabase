/**
 * Supabase-Compatible Client Example
 * Demonstrates using the Supabase-like API with PGlite
 */

import { PGlite } from '@electric-sql/pglite'
import { createSupabaseClient } from '../src/supabase-client.ts'

async function main() {
  console.log('=== Supabase-Compatible Client Example ===\n')

  // Create PGlite database
  const db = new PGlite()

  // Create tables
  console.log('Creating database schema...')
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      title TEXT NOT NULL,
      content TEXT,
      published BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)
  console.log('✓ Schema created\n')

  // Create Supabase-compatible client (with automatic schema introspection)
  console.log('Initializing Supabase client with schema introspection...')
  const supabase = await createSupabaseClient(db)
  console.log('✓ Client initialized\n')

  // Example 1: Insert data
  console.log('--- Example 1: INSERT ---')
  const { data: newUser, error: insertError } = await supabase
    .from('users')
    .insert({ name: 'Alice', email: 'alice@example.com', age: 25 })

  console.log('Insert result:', { data: newUser, error: insertError })
  console.log()

  // Example 2: Select all users
  console.log('--- Example 2: SELECT all ---')
  const { data: allUsers, error: selectError } = await supabase
    .from('users')
    .select('*')

  console.log('All users:', allUsers)
  console.log()

  // Example 3: Insert more users for filtering examples
  await supabase.from('users').insert({ name: 'Bob', email: 'bob@example.com', age: 30 })
  await supabase.from('users').insert({ name: 'Charlie', email: 'charlie@example.com', age: 35 })
  await supabase
    .from('users')
    .insert({ name: 'Diana', email: 'diana@example.com', age: 28 })

  // Example 4: Filter with eq
  console.log('--- Example 3: SELECT with eq filter ---')
  const { data: alice } = await supabase.from('users').select('*').eq('name', 'Alice')

  console.log('User named Alice:', alice)
  console.log()

  // Example 5: Filter with range
  console.log('--- Example 4: SELECT with age range ---')
  const { data: ageRange } = await supabase
    .from('users')
    .select('name,age')
    .gte('age', 25)
    .lte('age', 30)

  console.log('Users aged 25-30:', ageRange)
  console.log()

  // Example 6: Order and limit
  console.log('--- Example 5: SELECT with ORDER and LIMIT ---')
  const { data: ordered } = await supabase
    .from('users')
    .select('name,age')
    .order('age', { ascending: false })
    .limit(2)

  console.log('Top 2 oldest users:', ordered)
  console.log()

  // Example 7: Update
  console.log('--- Example 6: UPDATE ---')
  const { data: updated } = await supabase
    .from('users')
    .update({ age: 26 })
    .eq('name', 'Alice')

  console.log('Update result:', updated)
  console.log()

  // Example 8: Select single row
  console.log('--- Example 7: SELECT single row ---')
  const { data: single, error: singleError } = await supabase
    .from('users')
    .select('*')
    .eq('name', 'Alice')
    .single()

  console.log('Single user:', single)
  console.log()

  // Example 9: Insert posts with foreign key
  console.log('--- Example 8: INSERT with foreign key ---')
  await supabase.from('posts').insert({
    user_id: 1,
    title: 'My First Post',
    content: 'Hello, world!',
    published: true
  })

  await supabase.from('posts').insert({
    user_id: 1,
    title: 'Draft Post',
    content: 'Work in progress...',
    published: false
  })

  const { data: posts } = await supabase.from('posts').select('*')
  console.log('All posts:', posts)
  console.log()

  // Example 10: Filter posts by published status
  console.log('--- Example 9: SELECT published posts ---')
  const { data: published } = await supabase
    .from('posts')
    .select('title,published')
    .eq('published', true)

  console.log('Published posts:', published)
  console.log()

  // Example 11: Delete
  console.log('--- Example 10: DELETE ---')
  const { data: deleted } = await supabase.from('users').delete().eq('name', 'Diana')

  console.log('Delete result:', deleted)

  // Verify deletion
  const { data: remainingUsers } = await supabase.from('users').select('name')
  console.log('Remaining users:', remainingUsers)
  console.log()

  // Example 12: IN filter
  console.log('--- Example 11: SELECT with IN filter ---')
  const { data: inFilter } = await supabase
    .from('users')
    .select('name,age')
    .in('name', ['Alice', 'Bob'])

  console.log('Users named Alice or Bob:', inFilter)
  console.log()

  console.log('✓ All examples completed successfully!')

  await db.close()
}

main().catch(console.error)
