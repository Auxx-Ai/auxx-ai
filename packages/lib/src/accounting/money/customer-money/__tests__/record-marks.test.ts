// packages/lib/src/accounting/money/customer-money/__tests__/record-marks.test.ts
//
// plans/accounting/tasks/110-money-marks-not-rules.md §3 M1: each financial def marks its
// reconciler from a field change, and archived records are marked by hand.

import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldChangeRef } from '../../../../field-hooks/types'

const h = vi.hoisted(() => ({
  markOrderEvidence: vi.fn(async () => {}),
  markPayoutForAssessment: vi.fn(async () => {}),
}))

vi.mock('../order-evidence-reconciler', () => ({ markOrderEvidence: h.markOrderEvidence }))
vi.mock('../../payouts/payout-reconciler', () => ({
  markPayoutForAssessment: h.markPayoutForAssessment,
}))

import { BRIDGE_ATTRIBUTES } from '../bridge'
import {
  assessOnPayoutChange,
  assessOnProcessorBalanceEntryChange,
  markArchivedFinancialRecords,
  markEvidenceOnCustomerTransactionChange,
  markEvidenceOnLineItemChange,
  markEvidenceOnOrderChange,
} from '../record-marks'

const ORG = 'org_1'
const USER = 'usr_1'

function change(
  recordId: string,
  systemAttribute: string,
  extra: Partial<FieldChangeRef> = {}
): FieldChangeRef {
  return {
    recordId: recordId as RecordId,
    entityDefinitionId: recordId.split(':')[0]!,
    entityType: null,
    entitySlug: 'x',
    field: { id: `fld_${systemAttribute}`, systemAttribute } as FieldChangeRef['field'],
    organizationId: ORG,
    userId: USER,
    ...extra,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('field-change marks', () => {
  it('a customer transaction marks its order evidence on a bridged attribute only', async () => {
    expect(BRIDGE_ATTRIBUTES.customer_transaction.has('customer_transaction_order')).toBe(true)
    await markEvidenceOnCustomerTransactionChange(
      change('def_ct:ct1', 'customer_transaction_order')
    )
    await markEvidenceOnCustomerTransactionChange(change('def_ct:ct1', 'not_a_bridged_attr'))

    expect(h.markOrderEvidence).toHaveBeenCalledTimes(1)
    expect(h.markOrderEvidence).toHaveBeenCalledWith(ORG, USER, 'customer_transaction', 'ct1')
  })

  it('a line marks on line_item_order and nothing else', async () => {
    await markEvidenceOnLineItemChange(change('def_li:li1', 'line_item_order'))
    await markEvidenceOnLineItemChange(change('def_li:li1', 'line_item_quantity'))

    expect(h.markOrderEvidence).toHaveBeenCalledTimes(1)
    expect(h.markOrderEvidence).toHaveBeenCalledWith(ORG, USER, 'line_item', 'li1')
  })

  it('a re-parented line marks the line and the vacated order, whichever shape oldValue has', async () => {
    await markEvidenceOnLineItemChange(
      change('def_li:li1', 'line_item_order', {
        oldValue: { type: 'relationship', recordId: 'def_order:old1' },
      })
    )
    await markEvidenceOnLineItemChange(
      change('def_li:li2', 'line_item_order', { oldValue: 'def_order:old2' })
    )

    expect(h.markOrderEvidence.mock.calls).toEqual([
      [ORG, USER, 'line_item', 'li1'],
      [ORG, USER, 'order', 'old1'],
      [ORG, USER, 'line_item', 'li2'],
      [ORG, USER, 'order', 'old2'],
    ])
  })

  it('an order marks on its four inputs, not on line items or other payment-source fields', async () => {
    for (const attr of [
      'order_payment_source_complete',
      'order_total',
      'order_contact',
      'order_currency',
    ])
      await markEvidenceOnOrderChange(change('def_order:o1', attr))
    await markEvidenceOnOrderChange(change('def_order:o1', 'order_line_items'))
    await markEvidenceOnOrderChange(change('def_order:o1', 'order_payment_source_updated_at'))

    expect(h.markOrderEvidence).toHaveBeenCalledTimes(4)
    expect(h.markOrderEvidence).toHaveBeenCalledWith(ORG, USER, 'order', 'o1')
  })

  it('a payout marks the payout reconciler on a bridged attribute only', async () => {
    await assessOnPayoutChange(change('def_payout:p1', 'payout_source_membership'))
    await assessOnPayoutChange(change('def_payout:p1', 'not_a_bridged_attr'))

    expect(h.markPayoutForAssessment).toHaveBeenCalledTimes(1)
    expect(h.markPayoutForAssessment).toHaveBeenCalledWith(ORG, USER, 'p1')
  })

  it('a processor balance entry marks the payout reconciler on a bridged attribute only', async () => {
    await assessOnProcessorBalanceEntryChange(
      change('def_pbe:e1', 'processor_balance_acquisition_id')
    )
    await assessOnProcessorBalanceEntryChange(change('def_pbe:e1', 'not_a_bridged_attr'))

    expect(h.markPayoutForAssessment).toHaveBeenCalledTimes(1)
    expect(h.markPayoutForAssessment).toHaveBeenCalledWith(ORG, USER, 'e1')
  })

  it('a create marks like any other write', async () => {
    await markEvidenceOnCustomerTransactionChange(
      change('def_ct:ct9', 'customer_transaction_order', { isCreate: true })
    )
    await assessOnPayoutChange(
      change('def_payout:p9', 'payout_source_membership', { isCreate: true })
    )

    expect(h.markOrderEvidence).toHaveBeenCalledWith(ORG, USER, 'customer_transaction', 'ct9')
    expect(h.markPayoutForAssessment).toHaveBeenCalledWith(ORG, USER, 'p9')
  })
})

describe('markArchivedFinancialRecords', () => {
  const TYPES: Record<string, string> = {
    def_order: 'order',
    def_li: 'line_item',
    def_ct: 'customer_transaction',
    def_payout: 'payout',
    def_pbe: 'processor_balance_entry',
    def_contact: 'contact',
  }
  const resolveDef = async (id: string) => (TYPES[id] ? { entityType: TYPES[id]! } : null)

  it('marks each of the five kinds on its lane and ignores other defs', async () => {
    await markArchivedFinancialRecords(
      ORG,
      [
        'def_order:o1',
        'def_li:li1',
        'def_ct:ct1',
        'def_payout:p1',
        'def_pbe:e1',
        'def_contact:c1',
        'unknown:u1',
      ] as RecordId[],
      resolveDef
    )

    expect(h.markOrderEvidence.mock.calls).toEqual([
      [ORG, 'system', 'order', 'o1'],
      [ORG, 'system', 'line_item', 'li1'],
      [ORG, 'system', 'customer_transaction', 'ct1'],
    ])
    expect(h.markPayoutForAssessment.mock.calls).toEqual([
      [ORG, 'system', 'p1'],
      [ORG, 'system', 'e1'],
    ])
  })
})
