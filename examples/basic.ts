import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler } from '../src/pooler.js'

async function main() {
  console.log('=== PGlite Pooler Basic Test ===\n')

  const db = new PGlite()
  await db.exec('CREATE TABLE test (id SERIAL PRIMARY KEY, name TEXT, priority TEXT)')

  const pooler = new PGlitePooler(db)
  await pooler.start()

  console.log('--- Test 1: Priority Ordering ---')
  console.log('Submitting 3 queries with different priorities...')

  // Submit queries concurrently with different priorities
  const queries = []

  // Query 3: Low priority (should execute last)
  queries.push(
    pooler.query(
      "INSERT INTO test (name, priority) VALUES ('Query 3', 'LOW')",
      [],
      3 // LOW
    ).then(() => console.log('  ✓ Low priority query completed'))
  )

  // Query 1: High priority (should execute first)
  queries.push(
    pooler.query(
      "INSERT INTO test (name, priority) VALUES ('Query 1', 'HIGH')",
      [],
      1 // HIGH
    ).then(() => console.log('  ✓ High priority query completed'))
  )

  // Query 2: Medium priority (should execute second)
  queries.push(
    pooler.query(
      "INSERT INTO test (name, priority) VALUES ('Query 2', 'MEDIUM')",
      [],
      2 // MEDIUM
    ).then(() => console.log('  ✓ Medium priority query completed'))
  )

  await Promise.all(queries)

  // Check insertion order
  const result = await pooler.query('SELECT * FROM test ORDER BY id')
  console.log('\nExecution order (by ID):')
  for (const row of result.rows) {
    console.log(`  ${row['name']}: ${row['priority']}`)
  }

  if (
    result.rows[0]?.['priority'] === 'HIGH' &&
    result.rows[1]?.['priority'] === 'MEDIUM' &&
    result.rows[2]?.['priority'] === 'LOW'
  ) {
    console.log('\n✓ Priority ordering works correctly!\n')
  } else {
    console.log('\n✗ Priority ordering did not work as expected\n')
  }

  // ============================================================================
  console.log('--- Test 2: Concurrent Query Execution ---')
  console.log('Submitting 10 concurrent queries...')

  const concurrentQueries = []
  for (let i = 0; i < 10; i++) {
    concurrentQueries.push(
      pooler.query(
        `INSERT INTO test (name, priority) VALUES ('Concurrent ${i}', 'MEDIUM')`,
        [],
        2 // MEDIUM
      )
    )
  }

  const start = Date.now()
  await Promise.all(concurrentQueries)
  const elapsed = Date.now() - start

  console.log(`✓ 10 queries completed in ${elapsed}ms`)

  // ============================================================================
  console.log('\n--- Test 3: Query with Parameters ---')

  await pooler.query(
    'INSERT INTO test (name, priority) VALUES ($1, $2)',
    ['Parameterized Query', 'HIGH']
  )

  const paramResult = await pooler.query(
    "SELECT * FROM test WHERE name = $1",
    ['Parameterized Query']
  )

  if (paramResult.rows.length === 1) {
    console.log('✓ Parameterized queries work correctly')
  } else {
    console.log('✗ Parameterized query failed')
  }

  // ============================================================================
  console.log('\n--- Test 4: Error Handling ---')

  try {
    await pooler.query('SELECT * FROM nonexistent_table')
    console.log('✗ Should have thrown an error')
  } catch (error) {
    if (error instanceof Error) {
      console.log(`✓ Error caught: ${error.message}`)
    }
  }

  // ============================================================================
  console.log('\n--- Final Stats ---')
  const finalCount = await pooler.query('SELECT COUNT(*) as count FROM test')
  console.log(`Total queries executed: ${finalCount.rows[0]?.['count']}`)

  await pooler.stop()
  await db.close()
  console.log('\n✓ Pooler stopped cleanly')
}

main().catch(console.error)
