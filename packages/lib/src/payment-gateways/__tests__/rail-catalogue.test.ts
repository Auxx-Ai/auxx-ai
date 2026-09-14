// packages/lib/src/payment-gateways/__tests__/rail-catalogue.test.ts
//
// The naming and defaults catalogue (brief 26 §7.2).
//
// 🛑 The property that matters is that it NEVER REFUSES. A fixed list would
// reject the handles nobody has seen yet, and those are exactly the ones the
// census exists to discover (risk R2). So `suggestRail` is total, and the
// unknown-handle cases below are the point of the file rather than an edge.
//
// Pure: no database, no mocks.

import { describe, expect, it } from 'vitest'
import { suggestRail } from '../rail-catalogue'

describe('suggestRail', () => {
  describe('known rails', () => {
    it('suggests a name, a settlement source and a fee treatment', () => {
      expect(suggestRail('shopify_payments')).toEqual({
        name: 'Shopify Payments',
        settlementSource: 'shopify_payments',
        feeTreatment: 'netted',
        clearingAccountName: 'Shopify Payments Clearing',
        feeAccountName: 'Shopify Payments Fees',
        known: true,
      })
    })

    it('normalises the handle, so spelling and case do not matter', () => {
      for (const handle of ['Affirm', ' affirm ', 'AFFIRM']) {
        expect(suggestRail(handle).name).toBe('Affirm')
      }
    })

    it('reads the Authorize.Net spellings as one rail', () => {
      for (const handle of ['authorize_net', 'authorize.net', 'authorizenet']) {
        const suggestion = suggestRail(handle)
        expect(suggestion.name).toBe('Authorize.Net')
        // A traditional acquirer batches the deposit GROSS and bills for the
        // card fees monthly, so a payout entry with a fee leg would be wrong.
        expect(suggestion.feeTreatment).toBe('billed')
      }
    })

    it('puts the Shopify handles on ONE rail, because they share one deposit', () => {
      // §2: the grain is the settlement stream. Splitting these makes the
      // Shopify deposit unsplittable.
      const names = ['shopify_payments', 'shop_pay_installments', 'shop_cash'].map(
        (handle) => suggestRail(handle).clearingAccountName
      )

      expect(new Set(names).size).toBe(1)
    })

    it('keeps fee treatment independent of settlement source', () => {
      // Affirm settles outside every API AND nets its fee; Authorize.Net
      // settles outside every API and bills for it. Two questions (§4).
      expect(suggestRail('affirm').settlementSource).toBe('manual')
      expect(suggestRail('affirm').feeTreatment).toBe('netted')
      expect(suggestRail('authorize_net').settlementSource).toBe('manual')
      expect(suggestRail('authorize_net').feeTreatment).toBe('billed')
    })

    it('claims `stripe` as the only readable settlement source', () => {
      // `money/payouts/gather.ts` talks to Stripe Connect and nothing else
      // (§1.4), so no other rail may promise a drain nobody wrote.
      expect(suggestRail('stripe').settlementSource).toBe('stripe')
      for (const handle of ['paypal', 'square', 'klarna', 'braintree', 'amazon_pay', 'afterpay']) {
        expect(suggestRail(handle).settlementSource).not.toBe('stripe')
      }
    })
  })

  describe('an unknown handle gets defaults, never a refusal (§7.2)', () => {
    it('titles the handle into a name a person can edit', () => {
      expect(suggestRail('some_new_rail')).toEqual({
        name: 'Some New Rail',
        settlementSource: 'manual',
        feeTreatment: 'netted',
        clearingAccountName: 'Some New Rail Clearing',
        feeAccountName: 'Some New Rail Fees',
        known: false,
      })
    })

    it('splits on the separators handles actually use', () => {
      expect(suggestRail('my-gateway.v2').name).toBe('My Gateway V2')
    })

    it('falls back to a generic name rather than an empty one', () => {
      // `createChartAccount` refuses a blank name, so the one thing this may
      // not hand back is the empty string.
      for (const handle of ['', '   ', '___', '...']) {
        expect(suggestRail(handle).name).toBe('Payment Gateway')
        expect(suggestRail(handle).clearingAccountName).toBe('Payment Gateway Clearing')
      }
    })

    it('defaults to netted, which preserves today behaviour', () => {
      // `buildPayoutEntry` has only ever modelled the netted case (§4).
      expect(suggestRail('whoever').feeTreatment).toBe('netted')
    })
  })
})
