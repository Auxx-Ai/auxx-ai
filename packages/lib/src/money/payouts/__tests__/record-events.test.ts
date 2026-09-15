// packages/lib/src/money/payouts/__tests__/record-events.test.ts

import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'

const h = vi.hoisted(() => ({ reconcile: vi.fn(), db: {} }))
vi.mock('@auxx/database', () => ({ database: h.db }))
vi.mock('../../../cache', () => ({
  getCachedResources: async () => [{ id: 'line-def', entityType: 'line_item' }],
}))
vi.mock('../../reconciliation/reconcile-records', () => ({
  reconcileFinancialRecords: h.reconcile,
}))

import { getNativeRuleHandler } from '../../../record-rules/actions'
import { getSystemRuleDeclarations } from '../../../record-rules/system-rules'
import {
  reconcileFinancialRecordsAfterBulk,
  registerFinancialRecordRules,
} from '../../reconciliation/record-events'

describe('financial record event adapters', () => {
  beforeEach(() => {
    h.reconcile.mockReset().mockResolvedValue(0)
    registerFinancialRecordRules()
  })

  it('defers bulk replay until the post-integrity pass', async () => {
    const handler = getNativeRuleHandler('money.reconcile-financial-records')!
    await handler({
      organizationId: 'org',
      recordIds: [toRecordId('payout-def', 'p1')],
      source: 'sync',
    })
    expect(h.reconcile).not.toHaveBeenCalled()
    await handler({
      organizationId: 'org',
      recordIds: [toRecordId('payout-def', 'p1')],
      source: 'interactive',
    })
    expect(h.reconcile).toHaveBeenCalledOnce()
    expect(h.reconcile).toHaveBeenCalledWith(h.db, {
      organizationId: 'org',
      recordIds: [toRecordId('payout-def', 'p1')],
      cause: 'record-change',
    })
  })

  it('deduplicates created and changed records and resolves each definition once', async () => {
    const records = Array.from({ length: 100 }, (_, index) => toRecordId('payout-def', `p${index}`))
    const touched = Object.fromEntries(records.map((id) => [id, ['evidence-field']]))
    const manifest = {
      createdRecordIds: [...records, ...records],
      touched,
      archivedRecordIds: [toRecordId('unrelated-def', 'other')],
    } as unknown as SyncChangeManifest
    const resolve = vi.fn(async (id: string) => ({
      entityType: id === 'payout-def' ? 'payout' : 'contact',
    }))
    await reconcileFinancialRecordsAfterBulk(h.db as never, 'org', manifest, resolve)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(h.reconcile).toHaveBeenCalledOnce()
    expect(h.reconcile).toHaveBeenCalledWith(h.db, {
      organizationId: 'org',
      recordIds: records,
      cause: 'bulk-complete',
    })
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
    expect(h.reconcile).toHaveBeenLastCalledWith(
      h.db,
      expect.objectContaining({ previousOrderIds: ['old-order'] })
    )
    await reconcileFinancialRecordsAfterBulk(
      h.db as never,
      'org',
      {
        version: 2,
        detailTruncated: false,
        membershipTruncated: false,
        createdRecordIds: [],
        archivedRecordIds: [],
        touched: { [recordId]: ['line_item_order'] },
        deltas: {
          [recordId]: { line_item_order: { o: old, n: toRecordId('order-def', 'new-order') } },
        },
      },
      async () => ({ entityType: 'line_item' })
    )
    expect(h.reconcile).toHaveBeenLastCalledWith(
      h.db,
      expect.objectContaining({ cause: 'bulk-complete', previousOrderIds: ['old-order'] })
    )
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
  })

  it('does no financial reads for unrelated bulk changes', async () => {
    const manifest = {
      createdRecordIds: [toRecordId('contact-def', 'c1')],
      touched: {},
    } as SyncChangeManifest
    await reconcileFinancialRecordsAfterBulk(h.db as never, 'org', manifest, async () => ({
      entityType: 'contact',
    }))
    expect(h.reconcile).not.toHaveBeenCalled()
  })
})
