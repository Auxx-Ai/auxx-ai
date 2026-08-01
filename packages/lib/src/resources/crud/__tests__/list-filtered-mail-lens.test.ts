// packages/lib/src/resources/crud/__tests__/list-filtered-mail-lens.test.ts
//
// Step 0.1 on the generic system-resource LIST path — the last entry point that
// still served mail content without a lens.
//
// `record.listFiltered` (`UnifiedCrudHandler.listFiltered`) branches on
// `isSystemResource` into `querySystemResourceIdsPaged`, which scoped on
// `Thread.organizationId` and nothing else: no `buildMailVisibilityPredicate`,
// no `mergedIntoThreadId IS NULL`. `recordScope` answers `{ arm: 'all' }` for
// every system table, so the branch was reached with no per-row predicate at
// all. A dashboard `recordList` widget takes
// `source: { kind: 'system', tableId: 'thread' }` and calls exactly this — so
// every thread id in the organization, and a `total` counting the organization's
// whole mailbox, were returned to anyone who could open the dashboard.
//
// The fix REFUSES rather than filtering, matching the picker's guards and the AI
// tools' `blocked` resolution. Filtering would not have been enough: the row
// predicate admits `metadata`-tier rows, and the widget renders a thread's
// SUBJECT (`RESOURCE_DISPLAY_CONFIG.thread.primaryDisplayFieldId`) through
// `FieldValueService`, which applies no lens — so a `metadata`-only member would
// still have read subject lines off rows the predicate legitimately admitted.
//
// Three properties:
//
//   1. a restricted viewer gets NO thread ids and NO total — the refusal is
//      raised before any SQL, so there is nothing to leak;
//   2. `message` is refused identically — the sibling table, same reason;
//   3. every OTHER system table is untouched, or the fix is an outage.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEF_ID = vi.hoisted(() => 'edf000000000000000000001')

// A FULL factory, not `importOriginal` + spread. `importOriginal` loads the real
// `cache` barrel, whose transitive graph re-enters `unified-handler-queries`
// *while the factory is still running* — so the module under test binds the REAL
// helper and the override never takes effect. That was latent until the system
// path started reading `getCachedResourceFields`; the sibling files in this
// directory all use the full-factory shape for the same reason.
vi.mock('../../../cache', () => ({
  findCachedResource: vi.fn(async () => ({ id: DEF_ID, entityDefinitionId: DEF_ID })),
  // The system path resolves the org's merged fields to canonicalize filter field
  // refs. Empty is the honest stub here: this file is about the mail-lens
  // refusal, and the real helper would reach the DB.
  getCachedResourceFields: vi.fn(async () => []),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

vi.mock('../../query-builder/system-condition-builder', () => ({
  systemConditionBuilder: {
    buildGroupedQueryWithDiagnostics: vi.fn(() => ({
      sql: undefined,
      requestedConditions: 0,
      droppedConditions: [],
      allConditionsDropped: false,
    })),
    buildOrderBySql: vi.fn(() => [{ USER_SORT: true }]),
  },
}))

import { ForbiddenError } from '../../../errors'
import { UnifiedCrudHandler } from '../unified-handler'
import { countSystemResource, querySystemResourceIdsPaged } from '../unified-handler-queries'

/** Thread ids belonging to a mailbox the restricted viewer holds no lens on. */
const OTHER_MEMBERS_THREAD_IDS = ['thr_alice_0001', 'thr_alice_0002', 'thr_alice_0003']

/**
 * A db whose every SELECT would hand back another member's threads. Reaching it
 * at all is the failure — `select` must never be called for a mail-lens table.
 */
function leakyDb() {
  const select = vi.fn(() => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.orderBy = () => c
    c.limit = () => c
    c.offset = () => c
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable; faking it needs `then`
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(OTHER_MEMBERS_THREAD_IDS.map((id) => ({ id, count: 3 }))).then(res, rej)
    return c
  })
  return { db: { select } as never, select }
}

/**
 * A member with an ordinary records capability view — `canViewEntity` passes for
 * mail-infra defs unconditionally (`NON_RECORD_DEF_SLUGS`), which is precisely
 * why the def gate never stopped this read.
 */
const restrictedViewer = () => ({
  canViewEntity: vi.fn(() => true),
  hasRecordGrantsOn: vi.fn(() => false),
})

const handler = (db: never, capabilities?: unknown) =>
  new UnifiedCrudHandler('org_1', 'user_restricted', db, undefined, {
    capabilities: capabilities as never,
  })

const base = { organizationId: 'org_1', filters: [], sorting: [], limit: 10, offset: 0 }

describe('record.listFiltered — a restricted viewer cannot list threads', () => {
  let leaky: ReturnType<typeof leakyDb>

  beforeEach(() => {
    leaky = leakyDb()
  })

  it('refuses `thread` and returns none of another member’s thread ids', async () => {
    const result = handler(leaky.db, restrictedViewer()).listFiltered({
      entityDefinitionId: 'thread',
      limit: 50,
    })

    await expect(result).rejects.toBeInstanceOf(ForbiddenError)
    // The refusal precedes the query, so `total` cannot report the org's mailbox
    // either — there is no count to be honest or dishonest about.
    expect(leaky.select).not.toHaveBeenCalled()
  })

  it('refuses `message` on the same path', async () => {
    await expect(
      handler(leaky.db, restrictedViewer()).listFiltered({ entityDefinitionId: 'message' })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(leaky.select).not.toHaveBeenCalled()
  })

  it('refuses an INTERNAL caller too (`capabilities: undefined` is not a mail lens)', async () => {
    // Absent capabilities means "worker / seeder / record-rule", which this path
    // treats as unrestricted. That is the right answer for records and the wrong
    // one for mail: a lens-less caller wanting threads belongs in `mail-query/`,
    // which takes an explicit `MailViewer` (SYSTEM included).
    await expect(
      handler(leaky.db).listFiltered({ entityDefinitionId: 'thread' })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(leaky.select).not.toHaveBeenCalled()
  })

  it('points the caller at the mail search tools', async () => {
    await expect(
      handler(leaky.db, restrictedViewer()).listFiltered({ entityDefinitionId: 'thread' })
    ).rejects.toThrow(/find_threads/)
  })
})

describe('the query helpers refuse mail tables at the choke point', () => {
  it.each([
    'thread',
    'message',
  ] as const)('querySystemResourceIdsPaged refuses %s without querying', async (tableId) => {
    const { db, select } = leakyDb()
    await expect(querySystemResourceIdsPaged({ ...base, db, tableId })).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(select).not.toHaveBeenCalled()
  })

  it.each([
    'thread',
    'message',
  ] as const)('countSystemResource refuses %s — a bare count is a disclosure too', async (tableId) => {
    const { db, select } = leakyDb()
    await expect(
      countSystemResource({ db, tableId, organizationId: 'org_1', filters: [] })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(select).not.toHaveBeenCalled()
  })
})

describe('every other system table is unaffected', () => {
  // `inbox` is absent on purpose — its Drizzle table resolves to `undefined`
  // under this package's Vitest setup, so `getTableSchema` throws before any of
  // this file's logic runs. That is the environment, not the guard.
  it.each([
    'user',
    'article',
    'dataset',
    'participant',
  ] as const)('still lists %s', async (tableId) => {
    const { db, select } = leakyDb()
    const r = await querySystemResourceIdsPaged({ ...base, db, tableId })
    expect(select).toHaveBeenCalled()
    expect(r.ids).toEqual(OTHER_MEMBERS_THREAD_IDS)
  })

  it('still counts a non-mail system table', async () => {
    const { db, select } = leakyDb()
    await expect(
      countSystemResource({ db, tableId: 'article', organizationId: 'org_1', filters: [] })
    ).resolves.toBe(3)
    expect(select).toHaveBeenCalled()
  })
})
