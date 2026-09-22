// apps/web/src/components/accounting/ui/settings/__tests__/posting-auto-post-keys.test.ts
//
// One switch per avenue, and one key per save. `vendor_payment` and
// `vendor_refund` both declare `accounting.autoPost.vendorPayment`, which would
// render the control twice and put the key in the save bar's batch twice.

import { describe, expect, it } from 'vitest'
import {
  autoPostKeyForPolicy,
  EXTERNAL_SETTING_HOMES,
  POSTING_PAGE_INPUT_KEYS,
  POSTING_PAGE_POLICIES,
} from '../posting-page-model'

describe('the posting page auto-post keys', () => {
  it('carries the vendor payment key exactly once', () => {
    const occurrences = POSTING_PAGE_INPUT_KEYS.filter(
      (key) => key === 'accounting.autoPost.vendorPayment'
    )
    expect(occurrences).toHaveLength(1)
  })

  it('lists no key twice at all', () => {
    expect(new Set(POSTING_PAGE_INPUT_KEYS).size).toBe(POSTING_PAGE_INPUT_KEYS.length)
  })

  it('leaves no policy rendering an avenue autoPost key as a generic row', () => {
    for (const policy of POSTING_PAGE_POLICIES) {
      const ownKey = autoPostKeyForPolicy(policy)
      const generic = policy.settings.filter(
        (key) => !(key in EXTERNAL_SETTING_HOMES) && key !== ownKey
      )
      expect(generic.filter((key) => key.startsWith('accounting.autoPost.'))).toEqual([])
    }
  })

  it('gives the vendor refund the vendor payment avenue, so it shares that switch', () => {
    const refund = POSTING_PAGE_POLICIES.find((policy) => policy.type === 'vendor_refund')
    expect(refund && autoPostKeyForPolicy(refund)).toBe('accounting.autoPost.vendorPayment')
  })

  it('gives the vendor credit its own switch', () => {
    const credit = POSTING_PAGE_POLICIES.find((policy) => policy.type === 'vendor_credit')
    expect(credit && autoPostKeyForPolicy(credit)).toBe('accounting.autoPost.vendorCredit')
  })
})
