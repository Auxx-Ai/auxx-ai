// packages/lib/src/accounting/ledger/builders/__tests__/source-facts-memo.test.ts

import { describe, expect, it } from 'vitest'
import { LINE_MEMO_MAX_LENGTH, sourceFactsMemo } from '../source-facts-memo'

describe('sourceFactsMemo', () => {
  it('renders every fact in order, then the leg label', () => {
    expect(
      sourceFactsMemo(
        {
          order: '#14271',
          transactionId: '9599427084464',
          gateway: 'shopify_payments',
          channel: 'web',
          store: 'Auxx-Lift Store',
        },
        'deposited'
      )
    ).toBe(
      'Order #14271 · txn 9599427084464 · shopify_payments · web · Auxx-Lift Store · deposited'
    )
  })

  it('omits absent and blank facts without leaving a separator behind', () => {
    expect(
      sourceFactsMemo({ order: 'ORD-0012', transactionId: '  ', gateway: null, channel: 'web' })
    ).toBe('Order ORD-0012 · web')
  })

  it('is the leg label alone when there are no facts, and empty with neither', () => {
    expect(sourceFactsMemo({}, 'shipment 1')).toBe('shipment 1')
    expect(sourceFactsMemo({})).toBe('')
  })

  it('cuts an over-long memo at the line cap', () => {
    const memo = sourceFactsMemo({ store: 'x'.repeat(LINE_MEMO_MAX_LENGTH) }, 'a leg label')
    expect(memo).toHaveLength(LINE_MEMO_MAX_LENGTH)
    expect(memo.startsWith('xxxxx')).toBe(true)
  })
})
