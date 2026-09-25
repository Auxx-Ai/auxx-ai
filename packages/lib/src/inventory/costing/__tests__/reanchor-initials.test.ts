// packages/lib/src/inventory/costing/__tests__/reanchor-initials.test.ts
//
// The count anchor (111 Q26): the one movement allowed to move. `planReanchor` is pure; the
// lane around it is exercised with the reads, the handler and the mirror seam stubbed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PartInitial } from '../../movements/initial-queries'

const h = vi.hoisted(() => ({
  updateSpy: vi.fn(async (_recordId: string, _values: Record<string, unknown>) => ({})),
  constructions: [] as (Record<string, unknown> | undefined)[],
  initials: new Map<string, PartInitial>(),
  earliest: new Map<string, Date | null>(),
  /** `partId -> net through that part's count day`. */
  nets: new Map<string, number>(),
  seam: vi.fn(async () => {}),
}))

vi.mock('@auxx/database', () => ({
  database: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true }) },
}))
vi.mock('../../../cache', () => ({
  requireCachedEntityDefId: async () => 'def_mv',
  getOrgCache: () => ({ get: async () => 'user_system' }),
}))
vi.mock('../../../accounting/ledger/setup/book-time-zone', () => ({
  readBookTimeZoneOrUtc: async () => 'UTC',
}))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    constructor(
      _org: string,
      _user: string,
      _db: unknown,
      _socket: unknown,
      options?: Record<string, unknown>
    ) {
      h.constructions.push(options)
    }
    update = h.updateSpy
  },
}))
vi.mock('../../movements/initial-queries', () => ({
  readPartInitials: async (_db: unknown, _org: string, ids: string[]) =>
    new Map(ids.flatMap((id) => (h.initials.has(id) ? [[id, h.initials.get(id)!]] : []))),
}))
vi.mock('../../movements/fact/writes', () => ({
  updateMovementFactAnchor: vi.fn(async () => {}),
}))
vi.mock('../dated-reads', () => ({
  readEarliestMovementAt: async (_org: string, ids: string[]) =>
    new Map(ids.map((id) => [id, h.earliest.get(id) ?? null])),
  readPartNetThrough: async (_org: string, ids: string[]) =>
    new Map(ids.map((id) => [id, h.nets.get(id) ?? 0])),
}))

import {
  anchorSeam,
  planReanchor,
  REANCHOR_INITIAL_REASON,
  reanchorInitials,
} from '../reanchor-initials'

const ORG = 'org_1'

/** A part counted at 42 on March 10, anchored on Jan 14 at 872 (the replay read −830 by then). */
function anchored(over: Partial<PartInitial> = {}): PartInitial {
  return {
    movementId: 'mv_initial',
    partInstanceId: 'part_1',
    quantity: 872,
    occurredAt: new Date('2026-01-14T00:00:00.000Z'),
    countQuantity: 42,
    countDate: '2026-03-10',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.constructions = []
  h.initials = new Map()
  h.earliest = new Map()
  h.nets = new Map()
})

describe('planReanchor', () => {
  it('finds nothing to do when the anchor precedes every movement and the replay reads N on D', () => {
    // net(D) = 872 + (−830) = 42.
    expect(
      planReanchor(anchored(), {
        earliest: new Date('2026-01-15T10:00:00Z'),
        netThroughCountDate: 42,
        zone: 'UTC',
      })
    ).toBeNull()
  })

  it('moves the anchor to the day before an older movement and re-quantifies so the replay reads N on D', () => {
    // A sale of 3 dated Dec 20 arrived: net(D) is now 39, and the earliest movement precedes the anchor.
    expect(
      planReanchor(anchored(), {
        earliest: new Date('2025-12-20T09:00:00Z'),
        netThroughCountDate: 39,
        zone: 'UTC',
      })
    ).toEqual({ occurredAt: new Date('2025-12-19T00:00:00.000Z'), quantity: 875 })
  })

  it('re-quantifies alone when the older row is a backdated receipt after the anchor day', () => {
    // +10 received Feb 1 (after the anchor, before D): net(D) = 52; the date stands.
    expect(
      planReanchor(anchored(), {
        earliest: new Date('2026-01-15T10:00:00Z'),
        netThroughCountDate: 52,
        zone: 'UTC',
      })
    ).toEqual({ occurredAt: new Date('2026-01-14T00:00:00.000Z'), quantity: 862 })
  })

  it('moves an anchor dated the same day as the earliest other movement to the day before', () => {
    const initial = anchored({ occurredAt: new Date('2026-01-15T00:00:00.000Z') })
    expect(
      planReanchor(initial, {
        earliest: new Date('2026-01-15T10:00:00Z'),
        netThroughCountDate: 42,
        zone: 'UTC',
      })
    ).toEqual({ occurredAt: new Date('2026-01-14T00:00:00.000Z'), quantity: 872 })
  })

  it('leaves a row with no count fact alone: there is nothing to derive it from', () => {
    expect(
      planReanchor(anchored({ countQuantity: null, countDate: null }), {
        earliest: new Date('2025-12-20T09:00:00Z'),
        netThroughCountDate: 39,
        zone: 'UTC',
      })
    ).toBeNull()
  })
})

describe('reanchorInitials', () => {
  it('rewrites the initial on the quiet lane, calls the mirror seam, and reports the move', async () => {
    h.initials.set('part_1', anchored())
    h.earliest.set('part_1', new Date('2025-12-20T09:00:00Z'))
    h.nets.set('part_1', 39)
    const seam = vi.spyOn(anchorSeam, 'onInitialReanchored')

    const moved = await reanchorInitials(ORG, ['part_1'])

    expect(moved).toEqual([
      {
        movementId: 'mv_initial',
        partInstanceId: 'part_1',
        occurredAt: new Date('2025-12-19T00:00:00.000Z'),
        quantity: 875,
      },
    ])
    expect(h.updateSpy).toHaveBeenCalledWith('def_mv:mv_initial', {
      stock_movement_occurred_at: '2025-12-19T00:00:00.000Z',
      stock_movement_quantity: 875,
    })
    expect(h.constructions[0]).toMatchObject({
      session: { mode: { kind: 'quiet', reason: REANCHOR_INITIAL_REASON } },
    })
    expect(seam).toHaveBeenCalledWith({ tx: true }, 'mv_initial', {
      occurredAt: new Date('2025-12-19T00:00:00.000Z'),
      quantity: 875,
    })
  })

  it('is idempotent: once moved, the same reads find nothing to do', async () => {
    h.initials.set(
      'part_1',
      anchored({ occurredAt: new Date('2025-12-19T00:00:00.000Z'), quantity: 875 })
    )
    h.earliest.set('part_1', new Date('2025-12-20T09:00:00Z'))
    // The moved anchor itself is now inside net(D): 875 − 830 − 3 = 42.
    h.nets.set('part_1', 42)

    expect(await reanchorInitials(ORG, ['part_1'])).toEqual([])
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('skips parts with no initial or no count fact without a write', async () => {
    h.initials.set(
      'part_2',
      anchored({ partInstanceId: 'part_2', countQuantity: null, countDate: null })
    )
    expect(await reanchorInitials(ORG, ['part_1', 'part_2'])).toEqual([])
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('never throws: a failed read leaves the SUM to run on what is stored', async () => {
    h.initials.set('part_1', anchored())
    h.earliest.set('part_1', new Date('2025-12-20T09:00:00Z'))
    h.nets.set('part_1', 39)
    h.updateSpy.mockRejectedValueOnce(new Error('boom'))
    expect(await reanchorInitials(ORG, ['part_1'])).toEqual([])
  })
})
