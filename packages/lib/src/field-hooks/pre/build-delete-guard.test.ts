// packages/lib/src/field-hooks/pre/build-delete-guard.test.ts
// The guard that stops a build being hard-deleted out of a settled period, and
// stops a reversal being deleted out from under the build it negates.
//
// plans/money/tasks/21-money-parent-delete-safety.md §3. Dev ground truth the
// cases are modelled on: DemoOrg1 is locked through `2026-07` and every one of
// its 31 movements sits in `2026-08`, a month whose revision 1 stands POSTED at
// $1,320,563.80 while a later revision 2 sits `failed`, so the close strip
// correctly reports that month as **`open`**. That is why the posted-entry check
// reads `GlPosting` directly and why it is tested against an `open` strip.
//
// "This build HAS BEEN reversed" and the movement cascade are no longer here:
// they are `onDelete: 'restrict'` on `build_reversed_by` and `onDelete:
// 'cascade'` on `build_movements`, run by the delete engine.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(),
  bySystemAttributes: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
  movementRows: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

vi.mock('../../postings/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))

vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const movementChain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', '$dynamic']) {
    movementChain[method] = () => movementChain
  }
  movementChain.where = async () => h.movementRows()

  const postedChain: Record<string, unknown> = {}
  postedChain.from = () => postedChain
  postedChain.where = async () => h.postedPeriodRows()

  return {
    ...actual,
    database: { select: () => movementChain, selectDistinct: () => postedChain },
  }
})

import { capturedRelation } from '../__tests__/support/captured'
import { guardBuildDelete } from './build-delete-guard'

const BUILD_DEF = 'b5hzr4xbn1fhznih3u74gtza'
const BUILD_ID = 'bu1ld0000000000000000001'
const BUILD_RECORD_ID = `${BUILD_DEF}:${BUILD_ID}`
const ORG = 'abgwpa1l81reht2zmwrcihfu'

function event(values: Record<string, unknown> = {}): EntityPreDeleteEvent {
  return {
    recordId: BUILD_RECORD_ID as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: BUILD_DEF,
    entityType: 'build',
    entitySlug: 'builds',
    values,
    organizationId: ORG,
    userId: 'usr_1',
    bypass: new Set(),
  }
}

function movement(id: string, occurredAt: string | null, createdAt = new Date('2026-08-15')) {
  return { id, occurredAt, createdAt }
}

function settings(values: Record<string, string | null>): void {
  h.getOrganizationSetting.mockImplementation(
    async ({ key }: { key: string }) => values[key] ?? null
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedEntityDefId.mockResolvedValue('movement-def')
  h.bySystemAttributes.mockResolvedValue({
    stock_movement_build: { id: 'f-build' },
    stock_movement_occurred_at: { id: 'f-occurred' },
  })
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postedPeriodRows.mockResolvedValue([])
  h.movementRows.mockResolvedValue([])
  settings({})
})

describe('guardBuildDelete: settled period', () => {
  it('refuses when a movement sits in a locked month', async () => {
    h.movementRows.mockResolvedValue([movement('m1', '2026-07-10')])
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardBuildDelete(event())).rejects.toThrow(/2026-07/)
  })

  it('refuses when a movement sits in a month holding a standing posted entry', async () => {
    // The DemoOrg1 case: the close strip reports `2026-08` as OPEN because the
    // effective revision is a failed one, but revision 1 still stands posted.
    h.movementRows.mockResolvedValue([movement('m1', '2026-08-15')])
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(guardBuildDelete(event())).rejects.toThrow(/2026-08/)
  })

  it('refuses when a movement sits at or before the cutoff', async () => {
    h.movementRows.mockResolvedValue([movement('m1', '2026-05-02')])
    settings({ 'accounting.cutoffPeriod': '2026-05' })

    await expect(guardBuildDelete(event())).rejects.toThrow(/2026-05/)
  })

  it('points at reversing the build, not at archiving it', async () => {
    h.movementRows.mockResolvedValue([movement('m1', '2026-08-15')])
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(guardBuildDelete(event())).rejects.toThrow(/reverse the build/i)
  })

  it('falls back to createdAt when a movement has no occurredAt', async () => {
    h.movementRows.mockResolvedValue([movement('m1', null, new Date('2026-07-20'))])
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardBuildDelete(event())).rejects.toThrow(/2026-07/)
  })
})

describe('guardBuildDelete: reversal', () => {
  // Through `capturedRelation`, NOT a bare string. This case shipped green in
  // #1995 against `build_reversal_of: 'def:other'` while the guard was inert in
  // production, because the capture chain sends `['def:other']` and the guard
  // tested `typeof === 'string'`. Deleting build B-0007 in dev on 2026-08-31
  // succeeded and cascaded its 9 movements. Keep the array.
  it('refuses when this build IS a reversal', async () => {
    await expect(
      guardBuildDelete(event({ build_reversal_of: capturedRelation(`${BUILD_DEF}:other`) }))
    ).rejects.toThrow(/reverses another build/i)
  })

  it('refuses on a bare-string relation too: the create chain shape still counts', async () => {
    await expect(
      guardBuildDelete(event({ build_reversal_of: `${BUILD_DEF}:other` }))
    ).rejects.toThrow(/reverses another build/i)
  })

  it('does not refuse when the relation is absent or empty', async () => {
    await expect(guardBuildDelete(event({ build_reversal_of: [] }))).resolves.toBeUndefined()
    await expect(guardBuildDelete(event({ build_reversal_of: null }))).resolves.toBeUndefined()
  })

  it('refuses a reversal before reading its movements at all', async () => {
    h.movementRows.mockResolvedValue([movement('m1', '2026-09-01')])

    await expect(
      guardBuildDelete(event({ build_reversal_of: capturedRelation(`${BUILD_DEF}:other`) }))
    ).rejects.toThrow(/reverses another build/i)
    expect(h.movementRows).not.toHaveBeenCalled()
  })
})

describe('guardBuildDelete: open books', () => {
  it('passes when every movement is in an open period', async () => {
    h.movementRows.mockResolvedValue([
      movement('consume-1', '2026-09-01'),
      movement('consume-2', '2026-09-01'),
      movement('produce-1', '2026-09-01'),
    ])

    await expect(guardBuildDelete(event())).resolves.toBeUndefined()
  })

  it('skips the settled-period read when the build has no movements', async () => {
    await expect(guardBuildDelete(event())).resolves.toBeUndefined()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
  })

  it('settles nothing for an org with no accounting setup', async () => {
    // No cutoff, no lock, no postings: the org is not keeping books, so the
    // guard must stay out of the way entirely.
    h.movementRows.mockResolvedValue([movement('m1', '2020-01-01')])

    await expect(guardBuildDelete(event())).resolves.toBeUndefined()
  })
})
