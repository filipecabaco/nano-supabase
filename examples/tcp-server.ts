/**
 * TCP Server Example
 * Demonstrates the PGlite TCP server with socket pooling
 */

import { PGlite } from '@electric-sql/pglite'

import { PGlitePooler } from '../src/pooler.js'
import { PGliteServer } from '../src/server.js'

async function main() {
  console.log('=== PGlite TCP Server Example ===\n')

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

  // Create pooler
  const pooler = new PGlitePooler(db, {
    maxQueueSize: 1000,
    defaultTimeout: 30000,
  })

  // Create server
  const server = new PGliteServer({
    hostname: '127.0.0.1',
    port: 5433,
    pooler,
  })

  await server.start()

  console.log('\n📡 Server ready!')
  console.log('\nTry these commands:')
  console.log('  nc 127.0.0.1 5433')
  console.log('  SELECT * FROM users')
  console.log("  INSERT INTO users (name, email) VALUES ('Dave', 'dave@example.com')")
  console.log('  SELECT COUNT(*) FROM users')
  console.log('\nPress Ctrl+C to stop\n')

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n[Shutdown] Stopping server...')
    await server.stop()
    await db.close()
    console.log('[Shutdown] Goodbye!')
    process.exit(0)
  })
}

main().catch(console.error)
