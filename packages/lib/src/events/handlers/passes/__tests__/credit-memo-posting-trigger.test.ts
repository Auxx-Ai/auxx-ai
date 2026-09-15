// packages/lib/src/events/handlers/passes/__tests__/credit-memo-posting-trigger.test.ts

/**
 * The automatic credit memo posting run's trigger, and the one way it fails
 * silently (accounting brief 28 §3.1; the `fulfillment-posting-trigger.test.ts`
 * shape).
 *
 * What these tests pin is that the answer is read from BOTH manifest tiers.
 * `sync-manifest-types.ts` documents `createdRecordIds` as "UNCONDITIONAL
 * membership: every created record", while `runIntegrityPasses`'s own comment
 * hedges on the other one - a create "NORMALLY also lands in `touched`". A
 * connector-written credit memo is a create, so the unconditional array is the
 * tier that must not be skipped. Getting this wrong enqueues nothing, raises
 * nothing, and shows nothing on any screen.
 */

import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../../../record-rules/sync-manifest-types'

const h = vi.hoisted(() => ({
  autoPostCreditMemosAfterSync: vi.fn(async () => {}),
}))

vi.mock('../../../../money/credit-memo-posting/auto', () => ({
  autoPostCreditMemosAfterSync: h.autoPostCreditMemosAfterSync,
}))

import {
  creditMemoPostingTriggerPass,
  creditMemosArrivedThisSync,
} from '../credit-memo-posting-pass'

const ORG = 'org_1'
const CREDIT_MEMO_DEF = 'def_credit_memo'
const ORDER_DEF = 'def_order'

const CREDIT_MEMO_RID = `${CREDIT_MEMO_DEF}:cm1` as RecordId
const ORDER_RID_1 = `${ORDER_DEF}:o1` as RecordId
const ORDER_RID_2 = `${ORDER_DEF}:o2` as RecordId
const ORDER_RID_3 = `${ORDER_DEF}:o3` as RecordId

const resolveDef = async (rawDefId: string) =>
  rawDefId === CREDIT_MEMO_DEF ? { entityType: 'credit_memo' } : { entityType: 'order' }

function manifest(partial: Partial<SyncChangeManifest>): SyncChangeManifest {
  return {
    touched: {},
    deltas: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...partial,
  } as SyncChangeManifest
}

beforeEach(() => {
  h.autoPostCreditMemosAfterSync.mockReset()
  h.autoPostCreditMemosAfterSync.mockResolvedValue(undefined)
})

describe('creditMemosArrivedThisSync', () => {
  it('fires on a credit memo in createdRecordIds even when touched is EMPTY', async () => {
    const m = manifest({ createdRecordIds: [CREDIT_MEMO_RID] })
    expect(await creditMemosArrivedThisSync(m, resolveDef)).toBe(true)
  })

  it('fires on a credit memo in touched even when createdRecordIds is empty', async () => {
    // A refund amount landing on an existing channel memo is a touch, not a create.
    const m = manifest({ touched: { [CREDIT_MEMO_RID]: ['credit_memo_amount_refunded'] } })
    expect(await creditMemosArrivedThisSync(m, resolveDef)).toBe(true)
  })

  it('fires on an ids-only degraded touch entry', async () => {
    const m = manifest({ touched: { [CREDIT_MEMO_RID]: 1 } })
    expect(await creditMemosArrivedThisSync(m, resolveDef)).toBe(true)
  })

  it('does NOT fire on a sync that touched only other defs', async () => {
    const m = manifest({
      touched: { [ORDER_RID_1]: ['order_total'] },
      createdRecordIds: [ORDER_RID_2],
    })
    expect(await creditMemosArrivedThisSync(m, resolveDef)).toBe(false)
  })

  it('does NOT fire on an empty manifest', async () => {
    expect(await creditMemosArrivedThisSync(manifest({}), resolveDef)).toBe(false)
  })

  it('tolerates a manifest with createdRecordIds absent', async () => {
    const m = { touched: {}, deltas: {} } as unknown as SyncChangeManifest
    expect(await creditMemosArrivedThisSync(m, resolveDef)).toBe(false)
  })

  it('resolves each def at most once', async () => {
    let calls = 0
    const counting = async (rawDefId: string) => {
      calls++
      return rawDefId === CREDIT_MEMO_DEF ? { entityType: 'credit_memo' } : { entityType: 'order' }
    }
    const m = manifest({
      touched: {
        [ORDER_RID_1]: ['order_total'],
        [ORDER_RID_2]: ['order_total'],
        [ORDER_RID_3]: ['order_total'],
      },
    })
    expect(await creditMemosArrivedThisSync(m, counting)).toBe(false)
    expect(calls).toBe(1)
  })
})

describe('creditMemoPostingTriggerPass', () => {
  it('hands off to the auto lane once when a credit memo arrived', async () => {
    const m = manifest({ createdRecordIds: [CREDIT_MEMO_RID] })
    await creditMemoPostingTriggerPass({} as never, ORG, m, resolveDef)
    expect(h.autoPostCreditMemosAfterSync).toHaveBeenCalledTimes(1)
    expect(h.autoPostCreditMemosAfterSync).toHaveBeenCalledWith({}, ORG)
  })

  it('does nothing on an idle re-sync', async () => {
    const m = manifest({ touched: { [ORDER_RID_1]: ['order_total'] } })
    await creditMemoPostingTriggerPass({} as never, ORG, m, resolveDef)
    expect(h.autoPostCreditMemosAfterSync).not.toHaveBeenCalled()
  })

  it('never throws, even when the hand-off does', async () => {
    h.autoPostCreditMemosAfterSync.mockRejectedValue(new Error('boom'))
    const m = manifest({ createdRecordIds: [CREDIT_MEMO_RID] })
    await expect(
      creditMemoPostingTriggerPass({} as never, ORG, m, resolveDef)
    ).resolves.toBeUndefined()
  })
})
