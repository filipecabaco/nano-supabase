import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler } from '../src/pooler.ts'
import { QueryPriority } from '../src/types.ts'

async function main() {
  console.log('=== PGlite Pooler Basic Demo ===\n')

  const db = new PGlite()
  await db.exec('CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT, priority TEXT)')

  await using pooler = await PGlitePooler.create(db)

  console.log('--- Priority ordering ---')
  await Promise.all([
    pooler
      .query("INSERT INTO items (name, priority) VALUES ('low', 'LOW')", [], QueryPriority.LOW)
      .then(() => console.log('  LOW completed')),
    pooler
      .query("INSERT INTO items (name, priority) VALUES ('high', 'HIGH')", [], QueryPriority.HIGH)
      .then(() => console.log('  HIGH completed')),
    pooler
      .query("INSERT INTO items (name, priority) VALUES ('medium', 'MEDIUM')", [], QueryPriority.MEDIUM)
      .then(() => console.log('  MEDIUM completed')),
  ])

  const ordered = await pooler.query('SELECT priority FROM items ORDER BY id')
  const order = ordered.rows.map((r) => r['priority']).join(' -> ')
  console.log(`  Execution order: ${order}\n`)

  console.log('--- Concurrent queries ---')
  const start = Date.now()
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      pooler.query("INSERT INTO items (name, priority) VALUES ($1, 'MEDIUM')", [`item-${i}`]),
    ),
  )
  console.log(`  10 concurrent inserts: ${Date.now() - start}ms\n`)

  console.log('--- Parameterized query ---')
  await pooler.query('INSERT INTO items (name, priority) VALUES ($1, $2)', ['named', 'HIGH'])
  const found = await pooler.query('SELECT name FROM items WHERE name = $1', ['named'])
  console.log(`  Found: ${found.rows[0]?.['name']}\n`)

  console.log('--- Error handling ---')
  try {
    await pooler.query('SELECT * FROM no_such_table')
  } catch (err) {
    console.log(`  Error caught: ${err instanceof Error ? err.message : String(err)}\n`)
  }

  console.log('--- Transaction (rollback on error) ---')
  try {
    await pooler.transaction(async (query) => {
      await query("INSERT INTO items (name, priority) VALUES ('tx', 'HIGH')")
      await query('SELECT * FROM no_such_table')
    })
  } catch {
    console.log('  Transaction rolled back')
  }
  const txCount = await pooler.query("SELECT COUNT(*) AS n FROM items WHERE name = 'tx'")
  console.log(`  Rows with name='tx' after rollback: ${txCount.rows[0]?.['n']}\n`)

  console.log('--- Metrics ---')
  const m = pooler.metrics()
  console.log(`  Enqueued: ${m.totalEnqueued}`)
  console.log(`  Dequeued: ${m.totalDequeued}`)
  console.log(`  Avg wait: ${m.avgWaitTimeMs.toFixed(2)}ms`)
  console.log(`  Errors:   ${m.totalErrors}`)

  console.log('\nDone (pooler stopped automatically via await using)')
}

main().catch(console.error)
