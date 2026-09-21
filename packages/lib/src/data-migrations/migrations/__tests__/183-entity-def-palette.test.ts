// packages/lib/src/data-migrations/migrations/__tests__/183-entity-def-palette.test.ts
//
// A restamp, so what can go wrong is small and specific:
//
//  - a def at a stale pair must reach the SYSTEM_ENTITIES values;
//  - a re-run must write nothing, because the runner retries a failed fleet from the top;
//  - an org short of a def is a SKIP, never a throw — seeding is the seeder's job;
//  - the `resources` cache must drop, or the sidebar shows the old palette for a day.
//
// It also carries task 79 §4.1's backfill: the guest customer for every org that
// already provisioned a chart, and `order_contact` on every order that names
// neither a contact nor a company.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(),
  bySystemAttributes: vi.fn(),
  ensureGuestContact: vi.fn(),
  updateRecord: vi.fn(),
}))

vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedEntityDefId: h.getCachedEntityDefId,
  getOrgCache: () => ({
    invalidateAndRecompute,
    from: () => ({ bySystemAttributes: h.bySystemAttributes }),
  }),
}))
vi.mock('../../../accounting/parties', () => ({ ensureGuestContact: h.ensureGuestContact }))
vi.mock('../../../resources/crud', () => ({
  seedSession: (reason: string) => ({ origin: 'seed', reason }),
  UnifiedCrudHandler: class {
    update = h.updateRecord
  },
}))
vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'system-user' },
}))

// The restamp suites below want the backfill to skip: no `gl_account` def, no chart.
beforeEach(() => {
  h.getCachedEntityDefId.mockReset().mockResolvedValue(null)
  h.bySystemAttributes
    .mockReset()
    .mockResolvedValue({ order_contact: { id: 'f-contact' }, order_company: { id: 'f-company' } })
  h.ensureGuestContact
    .mockReset()
    .mockResolvedValue({ contactInstanceId: 'contact-guest', created: 1, requeued: 3 })
  h.updateRecord.mockReset().mockResolvedValue(undefined)
})

const { migration183EntityDefPalette } = await import('../183-entity-def-palette')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { SYSTEM_ENTITIES } = await import('../../../seed/entity-seeder/constants')

const MIGRATION_ID = '183-entity-def-palette'
const ORG = 'org_1'

interface Row {
  id: string
  entityType: string | null
  icon: string
  color: string
}

/** Records every `.set()` the migration issues, keyed by the def id it targeted. */
function fakeDb(rows: Row[]) {
  const writes: { icon: string; color: string }[] = []
  let pending: { icon: string; color: string } | null = null

  const db = {
    select: () => ({ from: () => ({ where: async () => rows }) }),
    update: () => ({
      set: (values: { icon: string; color: string; updatedAt: Date }) => {
        pending = { icon: values.icon, color: values.color }
        return {
          where: async () => {
            writes.push(pending as { icon: string; color: string })
            pending = null
          },
        }
      },
    }),
  } as unknown as Database

  return { db, writes }
}

/** A row already carrying what the registry says, for every entity but the named ones. */
function rowsAllCorrectExcept(stale: Record<string, { icon: string; color: string }>): Row[] {
  return SYSTEM_ENTITIES.map((e) => ({
    id: `def_${e.entityType}`,
    entityType: e.entityType,
    icon: stale[e.entityType]?.icon ?? e.icon,
    color: stale[e.entityType]?.color ?? e.color,
  }))
}

describe('migration 183 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration183EntityDefPalette.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 183', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '183')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('sorts after 182 in the shared registry', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf('182-vendor-bill-amount-discounted')
    )
  })
})

describe('the restamp', () => {
  it('rewrites a def sitting on the old palette', async () => {
    invalidateAndRecompute.mockClear()
    const { db, writes } = fakeDb(
      rowsAllCorrectExcept({ vendor_credit: { icon: 'receipt-text', color: 'orange' } })
    )

    const result = await migration183EntityDefPalette.up(db, ORG)

    const vendorCredit = SYSTEM_ENTITIES.find((e) => e.entityType === 'vendor_credit')
    expect(writes).toEqual([{ icon: vendorCredit?.icon, color: vendorCredit?.color }])
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['resources'])
  })

  it('writes nothing on a second run, so a fleet retry is free', async () => {
    invalidateAndRecompute.mockClear()
    const { db, writes } = fakeDb(rowsAllCorrectExcept({}))

    const result = await migration183EntityDefPalette.up(db, ORG)

    expect(writes).toEqual([])
    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('skips an org missing a def instead of throwing', async () => {
    const rows = rowsAllCorrectExcept({}).filter((r) => r.entityType !== 'vendor_credit')
    const { db, writes } = fakeDb(rows)

    const result = await migration183EntityDefPalette.up(db, ORG)

    expect(writes).toEqual([])
    expect(result.alreadyUpToDate).toBe(true)
  })

  it('ignores user-authored defs, which carry no entityType', async () => {
    const rows: Row[] = [
      ...rowsAllCorrectExcept({}),
      { id: 'def_custom', entityType: null, icon: 'box', color: 'orange' },
    ]
    const { db, writes } = fakeDb(rows)

    await migration183EntityDefPalette.up(db, ORG)

    expect(writes).toEqual([])
  })

  it('restamps every stale row it finds, not just the first', async () => {
    const { db, writes } = fakeDb(
      rowsAllCorrectExcept({
        part: { icon: 'package', color: 'orange' },
        build: { icon: 'hammer', color: 'orange' },
        quote: { icon: 'file-text', color: 'violet' },
      })
    )

    const result = await migration183EntityDefPalette.up(db, ORG)

    expect(writes).toHaveLength(3)
    expect(writes.every((w) => w.color === 'teal' || w.color === 'green')).toBe(true)
    expect(result.alreadyUpToDate).toBe(false)
  })
})

/** A query result that answers `await …` and `await ….limit(n)` alike. */
function result<T>(rows: T[]) {
  return {
    limit: async () => rows,
    then: (onOk: (value: T[]) => unknown, onErr?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(onOk, onErr),
  }
}

/**
 * The backfill's reads, routed by table: definitions, then the chart probe and
 * the order list (both `EntityInstance`), then the `FieldValue` party scan.
 */
function backfillDb(input: {
  chart: boolean
  orders: string[]
  withParty: string[]
  defRows?: Row[]
}) {
  let instanceCall = 0
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.EntityDefinition) {
          return { where: () => result(input.defRows ?? rowsAllCorrectExcept({})) }
        }
        const call = instanceCall++
        return {
          where: () =>
            call === 0
              ? result(input.chart ? [{ id: 'gl-1' }] : [])
              : result(input.orders.map((id) => ({ id }))),
        }
      },
    }),
    selectDistinct: () => ({
      from: () => ({ where: () => result(input.withParty.map((id) => ({ entityId: id }))) }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  }
  return db as unknown as Database
}

describe('the guest backfill (task 79 §4.1)', () => {
  it('skips an org with no chart entirely', async () => {
    h.getCachedEntityDefId.mockResolvedValue('def_gl_account')
    const db = backfillDb({ chart: false, orders: ['o1'], withParty: [] })

    const result = await migration183EntityDefPalette.up(db, ORG)

    expect(h.ensureGuestContact).not.toHaveBeenCalled()
    expect(result.alreadyUpToDate).toBe(true)
  })

  it('mints the guest and backfills only the orders with neither party', async () => {
    h.getCachedEntityDefId.mockResolvedValue('def_order')
    const db = backfillDb({
      chart: true,
      orders: ['o1', 'o2', 'o3'],
      withParty: ['o2'],
    })

    const result = await migration183EntityDefPalette.up(db, ORG)

    expect(h.ensureGuestContact).toHaveBeenCalledTimes(1)
    expect(h.updateRecord.mock.calls.map((c) => c[0])).toEqual(['def_order:o1', 'def_order:o3'])
    expect(h.updateRecord.mock.calls[0]?.[1]).toEqual({ order_contact: 'contact:contact-guest' })
    expect(result.alreadyUpToDate).toBe(false)
  })

  it('writes nothing on a second pass, so the fleet retry is free', async () => {
    h.getCachedEntityDefId.mockResolvedValue('def_order')
    h.ensureGuestContact.mockResolvedValue({
      contactInstanceId: 'contact-guest',
      created: 0,
      requeued: 0,
    })
    const db = backfillDb({ chart: true, orders: ['o1', 'o2'], withParty: ['o1', 'o2'] })

    const result = await migration183EntityDefPalette.up(db, ORG)

    expect(h.updateRecord).not.toHaveBeenCalled()
    expect(result.alreadyUpToDate).toBe(true)
  })
})
