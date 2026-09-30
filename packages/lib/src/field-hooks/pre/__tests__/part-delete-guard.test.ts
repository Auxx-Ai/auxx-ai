// packages/lib/src/field-hooks/pre/__tests__/part-delete-guard.test.ts
// The guard that stops a part being hard-deleted out of a settled period.
//
// plans/money/tasks/20-part-delete-safety.md §4. Dev ground truth the cases are
// modelled on: DemoOrg1 is locked through `2026-07` and holds 31 movements, every
// one of them in `2026-08`, a month whose revision 1 stands POSTED at
// $1,320,563.80 while a later revision 2 sits `failed`, so the close strip
// correctly reports that month as **`open`**. That is why the posted-entry check
// reads `GlPosting` directly and why it is tested against an `open` strip.
//
// Nothing here deletes anything: open-period movements go with the part in
// `deleteEntityInstances` (plans/mrp/20 S9).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../../types'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(),
  bySystemAttributes: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
  movementRows: vi.fn(),
  buildCount: vi.fn(),
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

vi.mock('../../../accounting/ledger/periods/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))

// Three drizzle chains, stubbed separately so the tests cannot confuse them: `select()` from
// `Build` is the build count, from anything else the movement read; `selectDistinct()` is the
// posted-period read.
// Each is a builder whose methods return itself and whose TERMINAL `.where()`
// resolves. Keeping `where` as the resolution point (rather than making the
// chain thenable) also pins the shape of the real queries: if either read stops
// ending in `.where()`, these tests fail loudly instead of quietly awaiting a
// builder.
vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const { Build } = actual.schema as { Build: unknown }
  const buildChain: Record<string, unknown> = {}
  buildChain.where = async () => [{ n: h.buildCount() }]
  const movementChain: Record<string, unknown> = {}
  for (const method of ['innerJoin', 'leftJoin', '$dynamic']) {
    movementChain[method] = () => movementChain
  }
  movementChain.where = async () => h.movementRows()
  const selectChain = { from: (table: unknown) => (table === Build ? buildChain : movementChain) }

  const postedChain: Record<string, unknown> = {}
  postedChain.from = () => postedChain
  postedChain.where = async () => h.postedPeriodRows()

  return {
    ...actual,
    database: { select: () => selectChain, selectDistinct: () => postedChain },
  }
})

import { guardPartDelete } from '../part-delete-guard'

const PART_DEF = 'x5hzr4xbn1fhznih3u74gtza'
const PART_ID = 'p4rt00000000000000000001'
const PART_RECORD_ID = `${PART_DEF}:${PART_ID}`
const ORG = 'abgwpa1l81reht2zmwrcihfu'

function event(): EntityPreDeleteEvent {
  return {
    recordId: PART_RECORD_ID as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: PART_DEF,
    entityType: 'part',
    entitySlug: 'parts',
    values: {},
    organizationId: ORG,
    userId: 'usr_1',
    bypass: new Set(),
  }
}

/** A movement row as the guard's select shapes it; `accountingDate` is `effectiveAt`. */
function movement(id: string, occurredAt: string) {
  return { id, accountingDate: new Date(occurredAt) }
}

/** Settings, keyed the way `settledMovementPeriods` reads them. */
function settings(values: Record<string, string | null>): void {
  h.getOrganizationSetting.mockImplementation(
    async ({ key }: { key: string }) => values[key] ?? null
  )
}

/** Months with an entry currently standing in the books. */
function posted(...periodKeys: string[]) {
  return periodKeys.map((periodKey) => ({ periodKey }))
}

const BOOKS_OPEN = {
  'accounting.cutoffPeriod': '2025-12',
  'accounting.bookTimeZone': 'America/Los_Angeles',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.movementRows.mockReturnValue([])
  h.buildCount.mockReturnValue(0)
  h.postedPeriodRows.mockReturnValue([])
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  settings(BOOKS_OPEN)
})

describe('guardPartDelete: refusal', () => {
  it('refuses a part whose movement sits in a month with a POSTED entry', async () => {
    h.movementRows.mockReturnValue([movement('mv1', '2026-08-15T00:00:00Z')])
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardPartDelete(event())).rejects.toThrow(/2026-08/)
  })

  it('refuses a part whose movement sits in a LOCKED period with no posting at all', async () => {
    // The case a posted-entry-only check would miss. DemoOrg1 is locked through
    // 2026-07 with nothing posted in most of those months.
    h.movementRows.mockReturnValue([movement('mv1', '2026-06-15T00:00:00Z')])
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardPartDelete(event())).rejects.toThrow(/closed or posted/)
  })

  it('refuses a movement AT OR BEFORE the cutoff, which never appears in the strip', async () => {
    // `close-periods.ts`: months at or before the cutoff "are covered by the
    // frozen opening baseline and can never be closed here".
    h.movementRows.mockReturnValue([movement('mv1', '2025-11-04T00:00:00Z')])

    await expect(guardPartDelete(event())).rejects.toThrow(/2025-11/)
  })

  it('names every settled month and the total, not just the first', async () => {
    h.movementRows.mockReturnValue([
      movement('mv1', '2026-07-02T00:00:00Z'),
      movement('mv2', '2026-08-15T00:00:00Z'),
      movement('mv3', '2026-08-16T00:00:00Z'),
    ])
    h.postedPeriodRows.mockReturnValue(posted('2026-07', '2026-08'))

    await expect(guardPartDelete(event())).rejects.toThrow(/3 stock movements in 2026-07, 2026-08/)
  })

  it('derives the period in the BOOK timezone, not UTC', async () => {
    // 2026-09-01T04:00Z is still 2026-08-31 in Los Angeles. Judged in UTC this
    // part would delete out of a posted August.
    h.movementRows.mockReturnValue([movement('mv1', '2026-09-01T04:00:00Z')])
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardPartDelete(event())).rejects.toThrow(/2026-08/)
  })

  it('points at archiving the part', async () => {
    h.movementRows.mockReturnValue([movement('mv1', '2026-08-15T00:00:00Z')])
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardPartDelete(event())).rejects.toThrow(/archive the part/i)
  })
})

describe('guardPartDelete: open books', () => {
  it('passes when every movement is in an OPEN period', async () => {
    h.movementRows.mockReturnValue([
      movement('mv1', '2026-08-15T00:00:00Z'),
      movement('mv2', '2026-08-16T00:00:00Z'),
    ])

    await expect(guardPartDelete(event())).resolves.toBeUndefined()
  })

  it('settles nothing for an org that has not finished accounting setup', async () => {
    settings({ 'accounting.bookTimeZone': 'UTC' }) // no cutoff
    h.movementRows.mockReturnValue([movement('mv1', '2026-08-15T00:00:00Z')])

    await expect(guardPartDelete(event())).resolves.toBeUndefined()
  })
})

describe('guardPartDelete: no movements', () => {
  it('skips the settled-period read entirely for a part with no movements', async () => {
    h.movementRows.mockReturnValue([])

    await guardPartDelete(event())

    expect(h.getOrganizationSetting).not.toHaveBeenCalled()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
  })
})

describe('guardPartDelete: builds', () => {
  it('refuses a part a build names, before reading its movements', async () => {
    h.buildCount.mockReturnValue(2)

    await expect(guardPartDelete(event())).rejects.toThrow(/2 builds.*archive the part/i)
    expect(h.movementRows).not.toHaveBeenCalled()
  })
})
