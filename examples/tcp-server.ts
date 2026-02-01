/**
 * TCP Server Example using PGlite Socket
 * Demonstrates PostgreSQL wire protocol support via @pglite/socket
 *
 * This allows connecting with psql, pgAdmin, or any PostgreSQL client!
 */

import { PGlite } from '@electric-sql/pglite'

async function main() {
  console.log('=== PGlite PostgreSQL Wire Protocol Server ===\n')

  // Create PGlite database
  const db = new PGlite()
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

  // Import and start PGlite socket server
  // Note: @pglite/socket must be installed separately
  console.log('[Server] Starting PostgreSQL wire protocol server...')
  console.log('[Server] Install @pglite/socket to run this example:')
  console.log('  pnpm add @pglite/socket\n')

  try {
    const { createServer } = await import('@pglite/socket')

    const server = await createServer(db, {
      host: '127.0.0.1',
      port: 5433,
    })

    console.log('\n📡 PostgreSQL server ready!')
    console.log('\nConnect with psql:')
    console.log('  psql "host=127.0.0.1 port=5433 user=postgres dbname=template1 sslmode=disable"\n')
    console.log('Connect with any PostgreSQL client:')
    console.log('  Host: 127.0.0.1')
    console.log('  Port: 5433')
    console.log('  Database: template1')
    console.log('  User: postgres')
    console.log('  Password: (none)\n')
    console.log('Try these queries:')
    console.log('  SELECT * FROM users;')
    console.log("  INSERT INTO users (name, email) VALUES ('Dave', 'dave@example.com');")
    console.log('  SELECT COUNT(*) FROM users;\n')
    console.log('Press Ctrl+C to stop\n')

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n[Shutdown] Stopping server...')
      await server.close()
      await db.close()
      console.log('[Shutdown] Goodbye!')
      process.exit(0)
    })
  } catch {
    console.error('\n❌ Error: @pglite/socket not installed')
    console.error('\nInstall it with:')
    console.error('  pnpm add @pglite/socket\n')
    console.error('See: https://pglite.dev/docs/pglite-socket\n')
    process.exit(1)
  }
}

main().catch(console.error)
