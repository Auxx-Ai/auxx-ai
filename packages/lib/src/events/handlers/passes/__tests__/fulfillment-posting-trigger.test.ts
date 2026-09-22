// packages/lib/src/events/handlers/passes/__tests__/fulfillment-posting-trigger.test.ts

/**
 * The automatic posting run's trigger, and the one way it fails silently.
 *
 * `plans/money/tasks/55-shipment-lines.md` section 6.
 *
 * Pass 6 used to DERIVE the shipment log and return the orders it changed;
 * pass 7 read the size of that set to decide whether to enqueue. The connector
 * now writes `fulfillment` records directly, so the derivation is gone and the
 * only question left is "did a fulfillment arrive in this sync".
 *
 * 🛑 What these tests pin is that the answer is read from BOTH manifest tiers.
 * `sync-manifest-types.ts` documents `createdRecordIds` as "UNCONDITIONAL
 * membership: every created record", while `runIntegrityPasses`'s own comment
 * hedges on the other one - a create "NORMALLY also lands in `touched`". A
 * connector-written fulfillment is a create, so the unconditional array is the
 * tier that must not be skipped. Getting this wrong enqueues nothing, raises
 * nothing, and shows nothing on any screen.
 */

import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  parents: new Map<string, string[]>(),
  byOrder: new Map<string, unknown[]>(),
  posted: [] as string[],
  relieve: vi.fn(async () => ({
    isErr: () => false,
    value: { movementIds: [], skippedNoPart: 0, skippedZeroDelta: 0, skippedNoCost: 0 },
  })),
}))
vi.mock('../../../../reconcilers/parent-reconciler', () => ({
  resolveParentsByRelation: async (_org: string, relation: string, ids: string[]) =>
    ids.flatMap((id) => h.parents.get(`${relation}:${id}`) ?? []),
}))
vi.mock('../../../../accounting/sales/fulfillments', () => ({
  readFulfillmentsForOrders: async () => h.byOrder,
  isLiveFulfillment: (row: { status: string }) => row.status !== 'cancelled',
  postFulfillmentAccounting: async (_db: unknown, input: { fulfillmentId: string }) => {
    h.posted.push(input.fulfillmentId)
    return { status: 'accepted' as const, glPostingId: 'glp_1' }
  },
}))
vi.mock('../../../../inventory/relief', () => ({ relieveFulfillmentLines: h.relieve }))
vi.mock('../../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'user_system' }) }))

import type { SyncChangeManifest } from '../../../../record-rules/sync-manifest-types'
import { fulfillmentPostingTriggerPass, fulfillmentsArrivedThisSync } from '../fulfillment-log-pass'

const FULFILLMENT_DEF = 'def_fulfillment'
const ORDER_DEF = 'def_order'

/**
 * `RecordId` is branded, so a bare template literal does not satisfy
 * `Record<RecordId, ...>`. Build the ids once, typed, and use them as computed
 * keys rather than casting at every call site.
 */
const FULFILLMENT_RID = `${FULFILLMENT_DEF}:f1` as RecordId
const ORDER_RID_1 = `${ORDER_DEF}:o1` as RecordId
const ORDER_RID_2 = `${ORDER_DEF}:o2` as RecordId
const ORDER_RID_3 = `${ORDER_DEF}:o3` as RecordId

const resolveDef = async (rawDefId: string) =>
  rawDefId === FULFILLMENT_DEF ? { entityType: 'fulfillment' } : { entityType: 'order' }

function manifest(partial: Partial<SyncChangeManifest>): SyncChangeManifest {
  return {
    touched: {},
    deltas: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...partial,
  } as SyncChangeManifest
}

describe('fulfillmentsArrivedThisSync', () => {
  it('fires on a fulfillment in createdRecordIds even when touched is EMPTY', async () => {
    // The regression this file exists for. A writer that reports only the
    // lifecycle array leaves `touched` empty, and reading `touched` alone
    // would return false: no posting run, no error, nothing to notice.
    const m = manifest({ createdRecordIds: [FULFILLMENT_RID] })
    expect(await fulfillmentsArrivedThisSync(m, resolveDef)).toBe(true)
  })

  it('fires on a fulfillment in touched even when createdRecordIds is empty', async () => {
    // An UPDATE to an existing fulfillment - a tracking number landing after
    // the fact - is a touch and not a create.
    const m = manifest({ touched: { [FULFILLMENT_RID]: ['fulfillment_tracking_number'] } })
    expect(await fulfillmentsArrivedThisSync(m, resolveDef)).toBe(true)
  })

  it('fires on an ids-only degraded touch entry', async () => {
    // `touched[rid] === 1` means the keys were shed under the byte budget.
    // Membership is the whole question here, so degradation changes nothing.
    const m = manifest({ touched: { [FULFILLMENT_RID]: 1 } })
    expect(await fulfillmentsArrivedThisSync(m, resolveDef)).toBe(true)
  })

  it('does NOT fire on a sync that touched only other defs', async () => {
    // The gate that keeps an idle re-sync from enqueuing a posting run.
    const m = manifest({
      touched: { [ORDER_RID_1]: ['order_total'] },
      createdRecordIds: [ORDER_RID_2],
    })
    expect(await fulfillmentsArrivedThisSync(m, resolveDef)).toBe(false)
  })

  it('does NOT fire on an empty manifest', async () => {
    expect(await fulfillmentsArrivedThisSync(manifest({}), resolveDef)).toBe(false)
  })

  it('tolerates a manifest with createdRecordIds absent', async () => {
    // The field is optional on older in-flight run rows.
    const m = { touched: {}, deltas: {} } as unknown as SyncChangeManifest
    expect(await fulfillmentsArrivedThisSync(m, resolveDef)).toBe(false)
  })

  it('resolves each def at most once', async () => {
    let calls = 0
    const counting = async (rawDefId: string) => {
      calls++
      return rawDefId === FULFILLMENT_DEF ? { entityType: 'fulfillment' } : { entityType: 'order' }
    }
    const m = manifest({
      touched: {
        [ORDER_RID_1]: ['order_total'],
        [ORDER_RID_2]: ['order_total'],
        [ORDER_RID_3]: ['order_total'],
      },
    })
    expect(await fulfillmentsArrivedThisSync(m, counting)).toBe(false)
    expect(calls).toBe(1)
  })
})

describe('fulfillmentPostingTriggerPass', () => {
  it("posts the manifest's fulfillments after relief, oldest shipment first", async () => {
    h.parents = new Map([
      ['fulfillment_order:f1', ['o1']],
      ['fulfillment_line_fulfillment:', []],
    ])
    h.byOrder = new Map([
      [
        'o1',
        [
          {
            id: 'f2',
            status: 'success',
            shippedAt: '2026-09-05T00:00:00Z',
            sequence: 2,
            lines: [],
          },
          {
            id: 'f1',
            status: 'success',
            shippedAt: '2026-09-02T00:00:00Z',
            sequence: 1,
            lines: [{ id: 'fl1', lineItemId: 'li1', quantity: 1, quantityRelieved: null }],
          },
          {
            id: 'f3',
            status: 'cancelled',
            shippedAt: '2026-09-01T00:00:00Z',
            sequence: 3,
            lines: [],
          },
        ],
      ],
    ])
    h.posted = []
    const m = manifest({ createdRecordIds: [FULFILLMENT_RID] })
    await fulfillmentPostingTriggerPass({} as never, 'org_1', m, resolveDef)
    expect(h.relieve).toHaveBeenCalled()
    // A cancelled shipment is not posted, and the live pair goes in ship order.
    expect(h.posted).toEqual(['f1', 'f2'])
  })
})
