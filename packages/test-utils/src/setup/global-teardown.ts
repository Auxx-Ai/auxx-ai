// packages/test-utils/src/setup/global-teardown.ts
// Runs once after all tests: closes the database connection pool

export default async function globalTeardown() {
  // @ts-expect-error -- global set by global-setup.ts
  const pool = globalThis.__TEST_POOL__
  if (!pool) return

  try {
    console.log('Closing test database connections...')
    await pool.end()
    console.log('Test database closed')
  } catch (error) {
    console.error('Error closing test database:', error)
  }
}
