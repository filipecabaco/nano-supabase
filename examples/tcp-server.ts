import { nanoSupabase } from '../src/index.ts'

async function main() {
  console.log('=== PGlite PostgreSQL Wire Protocol Server ===\n')

  await using nano = await nanoSupabase({ tcp: { port: 5433 } })
  const db = nano.db

  console.log('[Setup] Creating sample table...')
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.exec(`
    INSERT INTO users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob', 'bob@example.com'),
      ('Charlie', 'charlie@example.com')
  `)
  console.log('[Setup] Sample data loaded\n')

  console.log('[Server] PostgreSQL wire protocol server ready!')
  console.log(`\nConnection string: ${nano.connectionString}`)
  console.log('\nConnect with psql:')
  console.log('  psql "host=127.0.0.1 port=5433 user=postgres dbname=postgres sslmode=disable"\n')
  console.log('Try these queries:')
  console.log('  SELECT * FROM users;')
  console.log("  INSERT INTO users (name, email) VALUES ('Dave', 'dave@example.com');")
  console.log('  SELECT COUNT(*) FROM users;\n')
  console.log('Press Ctrl+C to stop\n')

  await new Promise(() => {})
}

main().catch(console.error)
