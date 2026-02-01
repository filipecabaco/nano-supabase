/**
 * PostgREST Parser Example
 * Demonstrates parsing PostgREST queries to SQL
 */

import { PostgrestParser } from '../src/postgrest-parser.js'

async function main() {
  console.log('=== PostgREST Parser Test ===\n')

  // Initialize WASM module (required before first use)
  await PostgrestParser.init()

  const parser = new PostgrestParser()

  // Test 1: Simple SELECT
  console.log('--- Test 1: Simple SELECT ---')
  const select1 = parser.parseSelect('users', 'select=id,name,email')
  console.log('Query:', select1.sql)
  console.log('Params:', select1.params)
  console.log('Tables:', select1.tables)
  console.log()

  // Test 2: SELECT with filters
  console.log('--- Test 2: SELECT with filters ---')
  const select2 = parser.parseSelect('users', 'id=eq.1&select=id,name')
  console.log('Query:', select2.sql)
  console.log('Params:', select2.params)
  console.log()

  // Test 3: SELECT with multiple filters
  console.log('--- Test 3: SELECT with multiple filters ---')
  const select3 = parser.parseSelect('users', 'age=gte.18&status=eq.active&select=id,name')
  console.log('Query:', select3.sql)
  console.log('Params:', select3.params)
  console.log()

  // Test 4: SELECT with ordering
  console.log('--- Test 4: SELECT with ordering ---')
  const select4 = parser.parseSelect('users', 'select=*&order=created_at.desc')
  console.log('Query:', select4.sql)
  console.log('Params:', select4.params)
  console.log()

  // Test 5: SELECT with limit
  console.log('--- Test 5: SELECT with limit ---')
  const select5 = parser.parseSelect('users', 'select=*&limit=10')
  console.log('Query:', select5.sql)
  console.log('Params:', select5.params)
  console.log()

  // Test 6: INSERT
  console.log('--- Test 6: INSERT ---')
  const insert = parser.parseInsert('users', {
    name: 'Alice',
    email: 'alice@example.com',
    age: 25
  })
  console.log('Query:', insert.sql)
  console.log('Params:', insert.params)
  console.log()

  // Test 7: UPDATE
  console.log('--- Test 7: UPDATE ---')
  const update = parser.parseUpdate(
    'users',
    { name: 'Alice Smith', age: 26 },
    'id=eq.1'
  )
  console.log('Query:', update.sql)
  console.log('Params:', update.params)
  console.log()

  // Test 8: DELETE
  console.log('--- Test 8: DELETE ---')
  const deleteQuery = parser.parseDelete('users', 'id=eq.1')
  console.log('Query:', deleteQuery.sql)
  console.log('Params:', deleteQuery.params)
  console.log()

  // Test 9: RPC function call
  console.log('--- Test 9: RPC function call ---')
  const rpc = parser.parseRpc('calculate_total', { order_id: 123 })
  console.log('Query:', rpc.sql)
  console.log('Params:', rpc.params)
  console.log()

  // Test 10: Generic HTTP request parsing
  console.log('--- Test 10: Generic HTTP request (GET) ---')
  const request = parser.parseRequest('GET', 'users', 'age=gte.18&select=id,name')
  console.log('Query:', request.sql)
  console.log('Params:', request.params)
  console.log()

  console.log('✓ All parser tests completed successfully!')
}

main().catch(console.error)
