// packages/lib/src/cache/providers/mail-grant-index-query.test.ts

import { describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §3 / 40a §4 — the grant QUERY half of the `personal_inbox` lockstep.
 *
 * `composeMailGrantIndex`'s bucket router (covered in
 * `mail-grant-index-provider.test.ts`) can only route rows the provider actually
 * fetched. Data migration 060 re-keys a personal mailbox's grants to
 * `'personal_inbox'`, so if this `inArray` filter keeps listing only
 * `thread`/`contact`/`inbox`, those rows are never selected at all and the
 * bucket fix has nothing to route — the owner's audience silently empties.
 *
 * The provider is exercised for real (with `db` and drizzle's predicate builders
 * faked) rather than asserted against source text, so the test tracks the query
 * and not its spelling. Returning zero rows short-circuits `compute` before the
 * org-cache reads, which is why no cache mocks are needed.
 */

const captured = vi.hoisted(() => ({ inArray: [] as unknown[][] }))

vi.mock('@auxx/database', () => ({
  // Drizzle columns are undefined under vitest (project memory); a Proxy yields
  // stable, printable column tokens instead.
  schema: new Proxy(
    {},
    {
      get: (_t, table) => new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }),
    }
  ),
  database: {},
}))

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  and: (...conds: unknown[]) => ({ and: conds }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  inArray: (col: unknown, values: unknown) => {
    captured.inArray.push([col, values])
    return { inArray: [col, values] }
  },
}))

import { mailGrantIndexProvider } from './mail-grant-index-provider'

/** Minimal `select().from().where()` chain resolving to zero rows. */
const fakeDb = () =>
  ({
    select: () => ({ from: () => ({ where: async () => [] }) }),
  }) as any

describe('mailGrantIndexProvider grant query', () => {
  it('fetches BOTH inbox keyspaces alongside thread and contact', async () => {
    captured.inArray = []
    await mailGrantIndexProvider.compute('org_1', fakeDb())

    const defs = captured.inArray.find(
      ([col]) => col === 'ResourceAccess.entityDefinitionId'
    )?.[1] as string[]
    expect(defs).toBeDefined()
    expect([...defs].sort()).toEqual(['contact', 'inbox', 'personal_inbox', 'thread'])
  })

  it('returns an empty index when the org holds no mail grants', async () => {
    captured.inArray = []
    await expect(mailGrantIndexProvider.compute('org_1', fakeDb())).resolves.toEqual({
      threads: {},
      contacts: {},
      inboxes: {},
    })
  })
})
