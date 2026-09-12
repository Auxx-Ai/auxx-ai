// packages/lib/src/events/handlers/passes/__tests__/fulfillment-relief-trigger.test.ts

/**
 * The relief half of pass 6 (`plans/money/tasks/50-batch-inventory-relief.md`
 * §1.4's sync door). `fulfillment-posting-trigger.test.ts` next door already
 * pins `fulfillmentsArrivedThisSync`'s membership contract; this file is
 * about what `fulfillmentPostingTriggerPass` does with a `fulfillment` OR
 * `fulfillment_line` arrival once relief is wired onto the same signal -
 * every lazily-imported collaborator (`reconcilers/parent-reconciler`,
 * `money/fulfillments`, `relief`, `cache`, and the unrelated posting trigger)
 * is mocked, since each has its own tests.
 */

import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../../../record-rules/sync-manifest-types'

const h = vi.hoisted(() => ({
  autoPostFulfillmentsAfterSync: vi.fn(async () => {}),
  resolveParentsByRelation: vi.fn(async (_orgId: string, attribute: string, childIds: string[]) => {
    const relations: Record<string, Record<string, string>> = {
      fulfillment_line_fulfillment: { line_1: 'ful_1' },
      fulfillment_order: { ful_1: 'ord_1', ful_2: 'ord_1' },
    }
    const byChild = relations[attribute] ?? {}
    return childIds.map((id) => byChild[id]).filter((id): id is string => !!id)
  }),
  fulfillments: new Map<string, unknown[]>(),
  isLiveFulfillment: vi.fn((f: { status: string }) => f.status !== 'cancelled'),
  relieveFulfillmentLines: vi.fn(
    async (_db: unknown, _input: { organizationId: string; userId: string; lines: unknown[] }) => {
      const { ok } = await import('neverthrow')
      return ok({
        movementIds: [],
        affectedPartIds: [],
        skippedNoPart: 0,
        skippedZeroDelta: 0,
        skippedNoCost: 0,
        fallbackStandardCostPartIds: [],
        negativeQoHPartIds: [],
      })
    }
  ),
}))

vi.mock('../../../../money/fulfillment-posting/auto', () => ({
  autoPostFulfillmentsAfterSync: h.autoPostFulfillmentsAfterSync,
}))

vi.mock('../../../../reconcilers/parent-reconciler', () => ({
  resolveParentsByRelation: h.resolveParentsByRelation,
}))

vi.mock('../../../../money/fulfillments', () => ({
  readFulfillmentsForOrders: async (_db: unknown, params: { orderIds: string[] }) => {
    const byOrder = new Map<string, unknown[]>()
    for (const orderId of params.orderIds) {
      const fulfillments = h.fulfillments.get(orderId)
      if (fulfillments) byOrder.set(orderId, fulfillments)
    }
    return byOrder
  },
  isLiveFulfillment: h.isLiveFulfillment,
}))

vi.mock('../../../../relief', () => ({
  relieveFulfillmentLines: h.relieveFulfillmentLines,
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ get: async () => 'system_user_1' }),
}))

import { fulfillmentPostingTriggerPass } from '../fulfillment-log-pass'

const ORG = 'org_1'
const FULFILLMENT_DEF = 'def_fulfillment'
const FULFILLMENT_LINE_DEF = 'def_fulfillment_line'
const ORDER_DEF = 'def_order'

const resolveDef = async (rawDefId: string) => {
  if (rawDefId === FULFILLMENT_DEF) return { entityType: 'fulfillment' }
  if (rawDefId === FULFILLMENT_LINE_DEF) return { entityType: 'fulfillment_line' }
  return { entityType: 'order' }
}

function manifest(partial: Partial<SyncChangeManifest>): SyncChangeManifest {
  return {
    touched: {},
    deltas: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...partial,
  } as SyncChangeManifest
}

function liveFulfillment(
  id: string,
  lines: Array<{
    id: string
    lineItemId: string
    quantity: number
    quantityRelieved: number | null
  }>
) {
  return { id, status: 'success', shippedAt: '2026-09-03T12:00:00.000Z', lines }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fulfillments = new Map()
  h.isLiveFulfillment.mockImplementation((f: { status: string }) => f.status !== 'cancelled')
  h.relieveFulfillmentLines.mockImplementation(async () => {
    const { ok } = await import('neverthrow')
    return ok({
      movementIds: [],
      affectedPartIds: [],
      skippedNoPart: 0,
      skippedZeroDelta: 0,
      skippedNoCost: 0,
      fallbackStandardCostPartIds: [],
      negativeQoHPartIds: [],
    })
  })
})

describe('fulfillmentPostingTriggerPass - inventory relief', () => {
  it('does nothing when neither a fulfillment nor a fulfillment_line arrived', async () => {
    const m = manifest({ createdRecordIds: [`${ORDER_DEF}:ord_1` as RecordId] })
    await fulfillmentPostingTriggerPass({} as never, ORG, m, resolveDef)
    expect(h.relieveFulfillmentLines).not.toHaveBeenCalled()
    expect(h.autoPostFulfillmentsAfterSync).not.toHaveBeenCalled()
  })

  it('relieves every live line of the order when a fulfillment arrives', async () => {
    h.fulfillments.set('ord_1', [
      liveFulfillment('ful_1', [
        { id: 'line_1', lineItemId: 'li_1', quantity: 3, quantityRelieved: null },
      ]),
    ])
    const m = manifest({ createdRecordIds: [`${FULFILLMENT_DEF}:ful_1` as RecordId] })

    await fulfillmentPostingTriggerPass({} as never, ORG, m, resolveDef)

    expect(h.autoPostFulfillmentsAfterSync).toHaveBeenCalledTimes(1)
    expect(h.relieveFulfillmentLines).toHaveBeenCalledTimes(1)
    const [, input] = h.relieveFulfillmentLines.mock.calls[0]!
    expect(input).toEqual({
      organizationId: ORG,
      userId: 'system_user_1',
      lines: [
        {
          fulfillmentLineId: 'line_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: null,
          occurredAt: new Date('2026-09-03T12:00:00.000Z'),
        },
      ],
    })
  })

  it('resolves a fulfillment_line-only touch through fulfillment_line_fulfillment -> fulfillment_order', async () => {
    h.fulfillments.set('ord_1', [
      liveFulfillment('ful_1', [
        { id: 'line_1', lineItemId: 'li_1', quantity: 3, quantityRelieved: null },
      ]),
    ])
    // Only the LINE is in the manifest - the parent fulfillment record was
    // not itself touched this sync.
    const m = manifest({ touched: { [`${FULFILLMENT_LINE_DEF}:line_1` as RecordId]: 1 } })

    await fulfillmentPostingTriggerPass({} as never, ORG, m, resolveDef)

    expect(h.relieveFulfillmentLines).toHaveBeenCalledTimes(1)
    // Not gated on a fulfillment record arriving - only a line did.
    expect(h.autoPostFulfillmentsAfterSync).not.toHaveBeenCalled()
  })

  it('excludes a cancelled fulfillment - never relieves a dispatch that did not ship', async () => {
    h.fulfillments.set('ord_1', [
      {
        id: 'ful_1',
        status: 'cancelled',
        shippedAt: '2026-09-03T12:00:00.000Z',
        lines: [{ id: 'line_1', lineItemId: 'li_1', quantity: 3, quantityRelieved: null }],
      },
    ])
    const m = manifest({ createdRecordIds: [`${FULFILLMENT_DEF}:ful_1` as RecordId] })

    await fulfillmentPostingTriggerPass({} as never, ORG, m, resolveDef)

    expect(h.relieveFulfillmentLines).not.toHaveBeenCalled()
  })

  it('a relief failure does not stop the posting trigger, and vice versa', async () => {
    h.autoPostFulfillmentsAfterSync.mockRejectedValue(new Error('posting boom'))
    h.fulfillments.set('ord_1', [
      liveFulfillment('ful_1', [
        { id: 'line_1', lineItemId: 'li_1', quantity: 3, quantityRelieved: null },
      ]),
    ])
    const m = manifest({ createdRecordIds: [`${FULFILLMENT_DEF}:ful_1` as RecordId] })

    await expect(
      fulfillmentPostingTriggerPass({} as never, ORG, m, resolveDef)
    ).resolves.toBeUndefined()
    expect(h.relieveFulfillmentLines).toHaveBeenCalledTimes(1)
  })
})
