// apps/web/src/test/database-mock.ts

/**
 * The one way `apps/web` tests should mock `@auxx/database`.
 *
 * ## Why this exists
 *
 * A hand-written `vi.mock('@auxx/database', …)` factory REPLACES the module.
 * Every export the author did not think to list is gone, and the failure lands
 * nowhere near the author's intent:
 *
 *  - a missing `database` key fails Vitest's named-binding link check the moment
 *    any module in the import graph does `import { database } from '@auxx/database'`
 *    (`No "database" export is defined on the "@auxx/database" mock`);
 *  - a `schema: {}` stub makes every table `undefined`, and the modules that read
 *    a table at MODULE SCOPE (`getTableColumns(schema.MediaAsset)`,
 *    `schema.Dataset.name`, module-level `.prepare(…)`) die inside Drizzle with
 *    `Cannot read properties of undefined`.
 *
 * Both kill the file at COLLECTION, so Vitest reports a suite with **0 tests**
 * rather than N failures — which reads as an empty file, not a regression. That
 * is how #1670 took `search-participant-gate.test.ts` from 17 tests to 0 and
 * survived review, CI and two subsequent merges.
 *
 * The trigger is an import-graph edge, not anything the test is about: most
 * router tests reach `@auxx/lib/cache`, whose providers reach a large slice of
 * `packages/lib`. Making every one of those modules lazy is unbounded; supplying
 * a complete mock is bounded. So the rule is **never hand-write the factory**.
 *
 * ## Using it
 *
 * ```ts
 * vi.mock('@auxx/database', async () =>
 *   (await import('~/test/database-mock')).mockAuxxDatabase()
 * )
 * ```
 *
 * Pin the tables a test actually asserts on; everything else auto-vivifies:
 *
 * ```ts
 * vi.mock('@auxx/database', async () =>
 *   (await import('~/test/database-mock')).mockAuxxDatabase({
 *     schema: { Integration: { id: 'Integration.id' } },
 *   })
 * )
 * ```
 *
 * Any other key is passed straight through, and overrides the default — use that
 * to pin `database` when a test needs a real spy on it:
 *
 * ```ts
 * vi.mock('@auxx/database', async () =>
 *   (await import('~/test/database-mock')).mockAuxxDatabase({
 *     database: { query: { WorkflowApp: { findFirst } } },
 *   })
 * )
 * ```
 *
 * ⚠ Import it with `await import(…)` INSIDE the factory, never as a top-level
 * binding referenced from one: `vi.mock` calls are hoisted above the file's
 * imports, so a static binding can be in its temporal dead zone when the factory
 * runs.
 *
 * ⚠ This cannot live in `setup.ts`. A per-file `vi.mock` overrides a setup-level
 * one wholesale, so a blanket mock would be silently bypassed by exactly the
 * files that need it — the same trap one level up. The helper has to be what the
 * per-file mock CALLS.
 *
 * See `plans/testing/database-mock-collection-hazard.md`.
 */

/** Overrides merged over the complete default mock. `schema` is merged per table. */
export type AuxxDatabaseMockOverrides = Record<string, unknown> & {
  schema?: Record<string, unknown>
}

/**
 * A complete stand-in for `@auxx/database`, with per-test overrides on top.
 *
 * Delegates to `packages/lib/src/test/database-mock.ts` — the same helper the
 * `lib` suite has used for this since its own 25 import-time failures — so the
 * two suites cannot drift on what "complete" means.
 *
 * @param overrides Extra or replacement exports. `schema` pins individual tables
 *   (the rest still auto-vivify); every other key replaces the default outright.
 */
export async function mockAuxxDatabase(
  overrides: AuxxDatabaseMockOverrides = {}
): Promise<Record<string, unknown>> {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '@auxx/lib/test/database-mock'
  )
  const { schema, ...rest } = overrides
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock(schema ?? {}),
    ...rest,
  }
}
