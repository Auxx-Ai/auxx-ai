// packages/lib/src/test/database-mock.ts

/**
 * Auto-vivifying stand-in for `@auxx/database`'s `schema` export.
 *
 * Modules all over `packages/lib` build table maps at IMPORT time
 * (`resource-access-service.ts`'s `INSTANCE_SHARE_NOTIFICATION_CONFIG` reads
 * `schema.Dataset.name`, and so on). A test that declares its own
 * `vi.mock('@auxx/database', …)` REPLACES the proxy `src/test/setup.ts`
 * installs, so any table the test did not think to list becomes `undefined` —
 * and the whole file dies at collection with
 * `Cannot read properties of undefined`, before a single test runs. That is
 * one import-graph edge away at all times and has no relationship to what the
 * test is actually about.
 *
 * This keeps the auto-vivification while letting a test pin the handful of
 * tables it asserts on by reference or by column value.
 *
 * Keys are memoized, so `schema.Foo === schema.Foo` and `.from(table)` stays
 * comparable by reference — see the note in `src/test/setup.ts`.
 *
 * @example
 * vi.mock('@auxx/database', async () => ({
 *   database: createChainableDatabaseMock(),
 *   schema: (await import('../../test/database-mock')).createSchemaMock({
 *     Integration: { id: 'Integration.id' },
 *   }),
 * }))
 */
export function createSchemaMock(
  overrides: Record<string, unknown> = {}
): Record<string, Record<string, unknown>> {
  const tables: Record<string, unknown> = { ...overrides }
  return new Proxy(tables, {
    get: (target, key: string) => {
      if (!(key in target)) target[key] = {}
      return target[key]
    },
  }) as Record<string, Record<string, unknown>>
}

/**
 * Recursive chainable stand-in for `@auxx/database`'s `database` export.
 *
 * Several modules build PREPARED STATEMENTS at import time —
 * `users/system-user-service.ts` does `db.select().from(…).where(…).prepare(…)`
 * at module scope — so a `database: {}` stub in a `vi.mock` factory throws
 * `database.select is not a function` during collection, again with no
 * relationship to what the test is about.
 *
 * Every property access and every call returns a fresh chain, so any builder
 * shape works. `then` is deliberately `undefined` so the chain is not
 * mistaken for a thenable and awaited into an infinite regress.
 */
export function createChainableDatabaseMock(): any {
  const fn = (..._args: unknown[]) => createChainableDatabaseMock()
  return new Proxy(fn, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined
      return createChainableDatabaseMock()
    },
  })
}
