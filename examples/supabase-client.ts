import { PGlite } from '@electric-sql/pglite'
import { createSupabaseClient } from '../src/supabase-client.ts'

async function main() {
  console.log('=== Supabase-Compatible Client Demo ===\n')

  const db = new PGlite()

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
  console.log('Schema created\n')

  console.log('Initializing Supabase client with schema introspection...')
  const supabase = await createSupabaseClient(db)
  console.log('Client initialized\n')

  console.log('--- 1: INSERT ---')
  const { data: newUser } = await supabase
    .from('users')
    .insert({ name: 'Alice', email: 'alice@example.com', age: 25 })
  console.log('  Insert result:', newUser)
  console.log()

  console.log('--- 2: SELECT all ---')
  const { data: allUsers } = await supabase.from('users').select('*')
  console.log('  All users:', allUsers)
  console.log()

  await supabase.from('users').insert({ name: 'Bob', email: 'bob@example.com', age: 30 })
  await supabase.from('users').insert({ name: 'Charlie', email: 'charlie@example.com', age: 35 })
  await supabase.from('users').insert({ name: 'Diana', email: 'diana@example.com', age: 28 })

  console.log('--- 3: SELECT with eq filter ---')
  const { data: alice } = await supabase.from('users').select('*').eq('name', 'Alice')
  console.log('  User named Alice:', alice)
  console.log()

  console.log('--- 4: SELECT with age range ---')
  const { data: ageRange } = await supabase
    .from('users')
    .select('name,age')
    .gte('age', 25)
    .lte('age', 30)
  console.log('  Users aged 25-30:', ageRange)
  console.log()

  console.log('--- 5: SELECT with ORDER and LIMIT ---')
  const { data: ordered } = await supabase
    .from('users')
    .select('name,age')
    .order('age', { ascending: false })
    .limit(2)
  console.log('  Top 2 oldest users:', ordered)
  console.log()

  console.log('--- 6: UPDATE ---')
  const { data: updated } = await supabase
    .from('users')
    .update({ age: 26 })
    .eq('name', 'Alice')
  console.log('  Update result:', updated)
  console.log()

  console.log('--- 7: SELECT single row ---')
  const { data: single } = await supabase
    .from('users')
    .select('*')
    .eq('name', 'Alice')
    .single()
  console.log('  Single user:', single)
  console.log()

  console.log('--- 8: INSERT with foreign key ---')
  await supabase.from('posts').insert({
    user_id: 1,
    title: 'My First Post',
    content: 'Hello, world!',
    published: true,
  })
  await supabase.from('posts').insert({
    user_id: 1,
    title: 'Draft Post',
    content: 'Work in progress...',
    published: false,
  })
  const { data: posts } = await supabase.from('posts').select('*')
  console.log('  All posts:', posts)
  console.log()

  console.log('--- 9: SELECT published posts ---')
  const { data: published } = await supabase
    .from('posts')
    .select('title,published')
    .eq('published', true)
  console.log('  Published posts:', published)
  console.log()

  console.log('--- 10: DELETE ---')
  const { data: deleted } = await supabase.from('users').delete().eq('name', 'Diana')
  console.log('  Delete result:', deleted)
  const { data: remainingUsers } = await supabase.from('users').select('name')
  console.log('  Remaining users:', remainingUsers)
  console.log()

  console.log('--- 11: SELECT with IN filter ---')
  const { data: inFilter } = await supabase
    .from('users')
    .select('name,age')
    .in('name', ['Alice', 'Bob'])
  console.log('  Users named Alice or Bob:', inFilter)
  console.log()

  console.log('All examples completed successfully!')

  await db.close()
}

main().catch(console.error)
