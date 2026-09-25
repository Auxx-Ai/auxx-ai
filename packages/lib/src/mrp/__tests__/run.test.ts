// packages/lib/src/mrp/__tests__/run.test.ts

import type { Database } from '@auxx/database'
import { addDaysToDayKey } from '@auxx/utils/calendar-day'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunInputs } from '../run/load-inputs'
import type { DailySeriesPoint, PartInput, PlanItem } from '../types'

vi.mock('../run/load-inputs', () => ({ loadRunInputs: vi.fn() }))
vi.mock('../run/write-run', () => ({
  startRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}))
vi.mock('../../accounting/ledger/setup/book-time-zone', () => ({
  todayInBookTimeZone: vi.fn(async () => '2026-09-24'),
  readBookTimeZoneOrUtc: vi.fn(async () => 'UTC'),
}))
vi.mock('../../settings/read', () => ({
  readOrganizationSettings: vi.fn(async () => ({
    'mrp.aduWindowDays': 90,
    'mrp.defaultLeadTimeFactor': null,
    'mrp.defaultVariabilityFactor': null,
  })),
}))

const { loadRunInputs } = await import('../run/load-inputs')
const { completeRun, failRun, startRun } = await import('../run/write-run')
const { runMrpPlan } = await import('../run/run')

const db = {} as Database
const TODAY = '2026-09-24'
const WINDOW = { from: addDaysToDayKey(TODAY, -90), to: addDaysToDayKey(TODAY, -1) }

function part(id: string, partial: Partial<PartInput> = {}): PartInput {
  return {
    id,
    kind: 'component',
    costSource: 'vendor',
    quantityOnHand: 0,
    bufferMode: null,
    buildLeadTimeDays: null,
    buildCycleDays: null,
    leadTimeFactorOverride: null,
    variabilityFactorOverride: null,
    hasVendorPart: true,
    hasBomChildren: false,
    ...partial,
  }
}

/** 90 days of steady use, never out of stock. */
function steady(partId: string, perDay: number): DailySeriesPoint[] {
  return Array.from({ length: 90 }, (_, i) => ({
    partId,
    day: addDaysToDayKey(WINDOW.from, i),
    consumed: perDay,
    scrapped: 0,
    net: -perDay,
    onHandEod: 1000,
  }))
}

/**
 * 04 §1's night over the running examples: the local motor (02 §4.1, when-needed, net flow 100),
 * the Acme motor (02 §6.4, scheduled every 180 days), a lift with no build lead time, and a part
 * that is neither bought nor made.
 */
function night(): RunInputs {
  return {
    asOf: TODAY,
    zone: 'UTC',
    window: WINDOW,
    parts: [
      part('motor-local', {
        quantityOnHand: 100,
        leadTimeFactorOverride: 0.25,
        variabilityFactorOverride: 0.5,
      }),
      // 199, not the doc's 200: the cushion then lands exactly on Dec 10 and 360 falls out (scheduled.test.ts).
      part('motor-acme', {
        quantityOnHand: 199,
        leadTimeFactorOverride: 0.25,
        variabilityFactorOverride: 0.5,
      }),
      part('bolt-acme', { quantityOnHand: 100_000 }),
      part('lift', {
        kind: 'finished_good',
        costSource: 'bom',
        hasVendorPart: false,
        hasBomChildren: true,
      }),
      part('widget', { costSource: null, hasVendorPart: false }),
    ],
    vendorParts: [
      {
        id: 'vp-local',
        partId: 'motor-local',
        supplierId: 'localco',
        leadTimeDays: 40,
        minOrderQty: 50,
        purchaseRatio: null,
        isPreferred: true,
      },
      {
        id: 'vp-acme',
        partId: 'motor-acme',
        supplierId: 'acme',
        leadTimeDays: 60,
        minOrderQty: null,
        purchaseRatio: null,
        isPreferred: true,
      },
      {
        id: 'vp-bolt',
        partId: 'bolt-acme',
        supplierId: 'acme',
        leadTimeDays: 60,
        minOrderQty: null,
        purchaseRatio: null,
        isPreferred: false,
      },
    ],
    suppliers: [
      {
        id: 'localco',
        orderMode: null,
        orderCycleDays: null,
        nextOrderDate: null,
        lastIssuedOrderedAt: null,
      },
      {
        id: 'acme',
        orderMode: 'scheduled',
        orderCycleDays: 180,
        nextOrderDate: null,
        lastIssuedOrderedAt: '2026-04-20',
      },
    ],
    poLines: [
      {
        id: 'draft-line',
        purchaseOrderId: 'draft-po',
        partId: 'motor-local',
        vendorPartId: 'vp-local',
        supplierId: 'localco',
        status: 'draft',
        quantityOpen: 60,
        orderedAt: null,
        expectedAt: null,
      },
    ],
    builds: [],
    openDemand: new Map(),
    edges: [{ parentPartId: 'lift', childPartId: 'motor-local', quantity: 1 }],
    series: [...steady('motor-local', 2), ...steady('motor-acme', 2), ...steady('bolt-acme', 2)],
    activity: [],
    monthly: [],
    whereUsed: [],
    receipts: [],
    driftedPartIds: new Set(['widget']),
  }
}

function writtenItems(): Map<string, PlanItem> {
  const call = vi.mocked(completeRun).mock.calls[0]
  const items = (call?.[2] ?? []) as PlanItem[]
  return new Map(items.map((item) => [item.partId, item]))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(startRun).mockResolvedValue(ok('run-1'))
  vi.mocked(completeRun).mockImplementation(async (_db, _id, items) =>
    ok({ itemCount: items.length })
  )
  vi.mocked(failRun).mockResolvedValue(ok(undefined))
})

describe('runMrpPlan: a normal night (04 §1)', () => {
  it('writes one item per part, as of the book-zone today', async () => {
    vi.mocked(loadRunInputs).mockResolvedValue(ok(night()))
    const result = await runMrpPlan(db, 'org-1', { trigger: 'nightly' })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ runId: 'run-1', itemCount: 5 })
    expect(vi.mocked(startRun).mock.calls[0]?.[2]).toMatchObject({
      asOf: TODAY,
      trigger: 'nightly',
    })
    expect([...writtenItems().keys()]).toEqual([
      'motor-local',
      'motor-acme',
      'bolt-acme',
      'lift',
      'widget',
    ])
    expect(failRun).not.toHaveBeenCalled()
  })

  it('when-needed motor (02 §4.1): zones 30 / 110 / 160, net flow 100 → order 60, draft shown not counted', async () => {
    vi.mocked(loadRunInputs).mockResolvedValue(ok(night()))
    await runMrpPlan(db, 'org-1', { trigger: 'nightly' })
    const motor = writtenItems().get('motor-local')

    expect(motor).toMatchObject({
      supplyType: 'bought',
      buffered: true,
      orderMode: 'when_needed',
      adu: 2,
      leadTimeDays: 40,
      leadTimeSource: 'vendor',
      decoupledLeadTimeDays: 40,
      leadTimeFactorSource: 'override',
      onHand: 100,
      onOrder: 0,
      netFlow: 100,
      suggestionKind: 'purchase',
      suggestedQty: 60,
      suggestedVendorPartId: 'vp-local',
      suggestedSupplierId: 'localco',
      priority: 100 / 160,
    })
    expect(motor?.topOfRed).toBeCloseTo(30)
    expect(motor?.topOfYellow).toBeCloseTo(110)
    expect(motor?.topOfGreen).toBeCloseTo(160)
    expect(motor?.flags).toEqual(['draft_po_pending'])
  })

  it('scheduled Acme motor (02 §6.4): order pulled to Oct 11, 360 on it', async () => {
    vi.mocked(loadRunInputs).mockResolvedValue(ok(night()))
    await runMrpPlan(db, 'org-1', { trigger: 'nightly' })
    const motor = writtenItems().get('motor-acme')

    expect(motor).toMatchObject({
      orderMode: 'scheduled',
      orderCycleDays: 180,
      nextOrderDate: '2026-10-11',
      nextArrivalDate: '2026-12-10',
      followingArrivalDate: '2027-06-08',
      pullsOrderForward: true,
      suggestionKind: 'purchase',
      suggestedQty: 360,
      suggestedVendorPartId: 'vp-acme',
      suggestedSupplierId: 'acme',
      orderByDate: '2026-10-11',
      isOverdue: false,
      flags: [],
    })
    expect(motor?.topOfRed).toBeCloseTo(45)
  })

  it('a scheduled part with nothing to order still names its supplier, for the supplier card', async () => {
    vi.mocked(loadRunInputs).mockResolvedValue(ok(night()))
    await runMrpPlan(db, 'org-1', { trigger: 'nightly' })
    expect(writtenItems().get('bolt-acme')).toMatchObject({
      orderMode: 'scheduled',
      nextOrderDate: '2026-10-11',
      pullsOrderForward: false,
      suggestionKind: null,
      suggestedQty: null,
      suggestedVendorPartId: 'vp-bolt',
      suggestedSupplierId: 'acme',
    })
  })

  it('bad data surfaces as flags (04 §6) and mirror drift comes from the drift check', async () => {
    vi.mocked(loadRunInputs).mockResolvedValue(ok(night()))
    await runMrpPlan(db, 'org-1', { trigger: 'nightly' })
    const items = writtenItems()

    expect(items.get('lift')).toMatchObject({
      supplyType: 'made',
      leadTimeSource: 'none',
      buffered: false,
      suggestionKind: null,
      flags: ['no_lead_time'],
    })
    expect(items.get('widget')?.flags).toEqual(['no_lead_time', 'mirror_drift', 'unclassified'])
  })
})

describe('runMrpPlan: failures', () => {
  it('a failing load marks the run failed and returns the error', async () => {
    const boom = new Error('mirror unavailable')
    vi.mocked(loadRunInputs).mockResolvedValue(err(boom))
    const result = await runMrpPlan(db, 'org-1', { trigger: 'manual' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe(boom)
    expect(failRun).toHaveBeenCalledWith(db, 'run-1', boom)
    expect(completeRun).not.toHaveBeenCalled()
  })

  it('a failing write marks the run failed', async () => {
    vi.mocked(loadRunInputs).mockResolvedValue(ok(night()))
    vi.mocked(completeRun).mockResolvedValue(err(new Error('insert failed')))
    const result = await runMrpPlan(db, 'org-1', { trigger: 'nightly' })

    expect(result.isErr()).toBe(true)
    expect(failRun).toHaveBeenCalledOnce()
  })

  it('no run row, nothing to fail', async () => {
    vi.mocked(startRun).mockResolvedValue(err(new Error('db down')))
    const result = await runMrpPlan(db, 'org-1', { trigger: 'nightly' })

    expect(result.isErr()).toBe(true)
    expect(loadRunInputs).not.toHaveBeenCalled()
    expect(failRun).not.toHaveBeenCalled()
  })
})
