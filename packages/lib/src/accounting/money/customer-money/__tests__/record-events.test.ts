// packages/lib/src/accounting/money/customer-money/__tests__/record-events.test.ts

import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../../../record-rules/sync-manifest-types'

const h = vi.hoisted(() => ({
  markOrder: vi.fn(),
  markPayout: vi.fn(),
  fromSync: vi.fn(),
  assess: vi.fn(),
  bridge: vi.fn(),
  order: [] as string[],
  db: {},
}))

const DEF_IDS: Record<string, string> = {
  payout: 'payout-def',
  processor_balance_entry: 'pbe-def',
  order: 'order-def',
  customer_transaction: 'ct-def',
  line_item: 'line-def',
}

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: async (_org: string, slug: string) => DEF_IDS[slug],
}))
vi.mock('../order-evidence-reconciler', () => ({
  markOrderEvidence: h.markOrder,
  reconcileOrderEvidenceFromSync: h.fromSync,
  registerOrderEvidenceReconciler: vi.fn(),
}))
vi.mock('../../payouts/payout-reconciler', () => ({
  markPayoutForAssessment: h.markPayout,
  registerPayoutReconciler: vi.fn(),
}))
vi.mock('../../payouts/assess-payouts', () => ({ assessPayouts: h.assess }))
vi.mock('../bridge', () => ({ bridgeFinancialRecords: h.bridge }))

import { getNativeRuleHandler } from '../../../../record-rules/actions'
import { getSystemRuleDeclarations } from '../../../../record-rules/system-rules'
import { reconcileFinancialRecordsAfterBulk, registerFinancialRecordRules } from '../record-events'

describe('financial record event adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.markOrder.mockResolvedValue(undefined)
    h.markPayout.mockResolvedValue(undefined)
    h.fromSync.mockResolvedValue(undefined)
    h.assess.mockResolvedValue(0)
    h.order = []
    h.bridge.mockImplementation(async () => {
      h.order.push('bridge')
    })
    h.assess.mockImplementation(async () => {
      h.order.push('assess')
      return 0
    })
    h.fromSync.mockImplementation(async () => {
      h.order.push('order-evidence')
    })
    registerFinancialRecordRules()
  })

  it('bridges the payout records before it assesses them', async () => {
    const manifest = {
      createdRecordIds: [toRecordId('payout-def', 'p1'), toRecordId('pbe-def', 'e1')],
      touched: {},
      archivedRecordIds: [],
    } as unknown as SyncChangeManifest
    await reconcileFinancialRecordsAfterBulk(h.db as never, 'org', manifest)
    expect(h.order).toEqual(['bridge', 'assess'])
    expect(h.bridge).toHaveBeenCalledWith(h.db, {
      organizationId: 'org',
      actorUserId: '',
      records: [
        { id: 'p1', kind: 'payout' },
        { id: 'e1', kind: 'processor_balance_entry' },
      ],
    })
  })

  it('defers bulk replay until the post-integrity pass', async () => {
    const handler = getNativeRuleHandler('money.reconcile-financial-records')!
    await handler({
      organizationId: 'org',
      recordIds: [toRecordId('payout-def', 'p1')],
      source: 'sync',
    })
    expect(h.markPayout).not.toHaveBeenCalled()
    await handler({
      organizationId: 'org',
      recordIds: [toRecordId('payout-def', 'p1'), toRecordId('payout-def', 'p1')],
      source: 'interactive',
      userId: 'usr-1',
    })
    expect(h.markPayout).toHaveBeenCalledOnce()
    expect(h.markPayout).toHaveBeenCalledWith('org', 'usr-1', 'p1')
    expect(h.markOrder).not.toHaveBeenCalled()
  })

  it('marks each kind on its own lane and ignores unrelated defs', async () => {
    const handler = getNativeRuleHandler('money.reconcile-financial-records')!
    await handler({
      organizationId: 'org',
      recordIds: [
        toRecordId('order-def', 'o1'),
        toRecordId('line-def', 'li1'),
        toRecordId('ct-def', 'ct1'),
        toRecordId('pbe-def', 'e1'),
        toRecordId('contact-def', 'c1'),
      ],
      source: 'interactive',
    })
    expect(h.markOrder.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      ['order', 'o1'],
      ['line_item', 'li1'],
      ['customer_transaction', 'ct1'],
    ])
    expect(h.markPayout).toHaveBeenCalledWith('org', '', 'e1')
  })

  it('deduplicates created and changed records and assesses each owner once', async () => {
    const records = Array.from({ length: 100 }, (_, index) => toRecordId('payout-def', `p${index}`))
    const touched = Object.fromEntries(records.map((id) => [id, ['evidence-field']]))
    const manifest = {
      createdRecordIds: [...records, ...records],
      touched,
      archivedRecordIds: [toRecordId('unrelated-def', 'other')],
    } as unknown as SyncChangeManifest
    await reconcileFinancialRecordsAfterBulk(h.db as never, 'org', manifest)
    expect(h.assess).toHaveBeenCalledOnce()
    expect(h.assess).toHaveBeenCalledWith(
      h.db,
      'org',
      records.map((id) => id.split(':')[1])
    )
    expect(h.fromSync).not.toHaveBeenCalled()
  })

  it('includes the previous order when a line moves through interactive or bulk writes', async () => {
    const recordId = toRecordId('line-def', 'line-1')
    const old = toRecordId('order-def', 'old-order')
    const handler = getNativeRuleHandler('money.reconcile-financial-records')!
    await handler({
      organizationId: 'org',
      recordIds: [recordId],
      source: 'interactive',
      previousValuesByRecordId: { [recordId]: { recordId: old } },
    })
    expect(h.markOrder).toHaveBeenLastCalledWith('org', '', 'order', 'old-order')

    await reconcileFinancialRecordsAfterBulk(h.db as never, 'org', {
      version: 2,
      detailTruncated: false,
      membershipTruncated: false,
      createdRecordIds: [],
      archivedRecordIds: [],
      touched: { [recordId]: ['line_item_order'] },
      deltas: {
        [recordId]: { line_item_order: { o: old, n: toRecordId('order-def', 'new-order') } },
      },
    })
    expect(h.fromSync).toHaveBeenCalledWith(h.db, 'org', ['line_item:line-1', 'order:old-order'])
  })

  it('registers financial owners and ordinary source field changes', () => {
    const rules = getSystemRuleDeclarations().filter((rule) => rule.key.startsWith('money-'))
    for (const kind of [
      'payout',
      'processor_balance_entry',
      'customer_transaction',
      'order',
      'line_item',
    ]) {
      expect(rules.some((rule) => rule.defSlug === kind && rule.on === 'created')).toBe(true)
      expect(rules.some((rule) => rule.defSlug === kind && rule.on === 'changed')).toBe(true)
    }
    const changedAttributes = rules.flatMap((rule) =>
      rule.on === 'changed' && rule.fieldRef && 'systemAttribute' in rule.fieldRef
        ? [rule.fieldRef.systemAttribute]
        : []
    )
    expect(changedAttributes).toEqual(
      expect.arrayContaining([
        'payout_source_amount',
        'payout_source_status',
        'processor_balance_gross',
        'processor_balance_fee',
        'processor_balance_net',
        'customer_transaction_order',
        'customer_transaction_amount',
      ])
    )
    expect(rules.every((rule) => !rule.key.includes('shopify'))).toBe(true)
    expect(rules.filter((rule) => rule.on === 'changed').every((rule) => rule.skipOnCreate)).toBe(
      true
    )
    // A def-wide `changed` rule is not expressible: `assertSystemRuleShape` rejects
    // a non-lifecycle declaration without a fieldRef.
    expect(rules.every((rule) => rule.on !== 'changed' || Boolean(rule.fieldRef))).toBe(true)
  })

  it('does no financial work for unrelated bulk changes', async () => {
    const manifest = {
      createdRecordIds: [toRecordId('contact-def', 'c1')],
      touched: {},
    } as SyncChangeManifest
    await reconcileFinancialRecordsAfterBulk(h.db as never, 'org', manifest)
    expect(h.assess).not.toHaveBeenCalled()
    expect(h.fromSync).not.toHaveBeenCalled()
  })
})
