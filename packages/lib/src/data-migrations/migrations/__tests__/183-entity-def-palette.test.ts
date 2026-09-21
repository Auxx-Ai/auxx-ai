// packages/lib/src/data-migrations/migrations/__tests__/183-entity-def-palette.test.ts
//
// A restamp, so what can go wrong is small and specific:
//
//  - a def at a stale pair must reach the SYSTEM_ENTITIES values;
//  - a re-run must write nothing, because the runner retries a failed fleet from the top;
//  - an org short of a def is a SKIP, never a throw — seeding is the seeder's job;
//  - the `resources` cache must drop, or the sidebar shows the old palette for a day.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

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
