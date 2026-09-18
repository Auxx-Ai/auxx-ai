// packages/lib/src/accounting/ledger/chart/__tests__/source-account-label.test.ts

import { describe, expect, it } from 'vitest'
import {
  isManualSource,
  sourceAccountLabel,
  sourceAccountTooltip,
  sourceProviderLabel,
} from '../source-account-label'

/** The real row in the dev database: the merchant's Shopify Payments balance account. */
const SHOPIFY_PAYMENTS_GID = 'gid://shopify/ShopifyPaymentsAccount/999000223183024'

describe('sourceAccountLabel', () => {
  // 🛑 The reason `name` exists on `FinancialSourceAccount` at all: once someone
  // has named an account, that name wins over every derivation below it.
  it('prefers a set name over any derivation', () => {
    expect(
      sourceAccountLabel({
        name: 'Primary payouts',
        providerKey: 'shopify_payments',
        externalAccountId: SHOPIFY_PAYMENTS_GID,
      })
    ).toBe('Primary payouts')

    expect(
      sourceAccountLabel({
        name: 'Main store',
        providerKey: 'shopify',
        externalAccountId: 'acme.myshopify.com',
      })
    ).toBe('Main store')
  })

  it('treats a blank or whitespace-only name as unset', () => {
    expect(
      sourceAccountLabel({ name: '   ', providerKey: 'stripe', externalAccountId: 'acct_1A2B3C' })
    ).toBe('Stripe · acct_1A2B3C')
  })

  // 🛑 The case this helper exists for. The full string is 44 characters and was
  // being printed in a `TreeRow` secondary slot inside a 380px drawer.
  it('with no name, shortens an opaque gid to the provider and the tail', () => {
    const label = sourceAccountLabel({
      providerKey: 'shopify_payments',
      externalAccountId: SHOPIFY_PAYMENTS_GID,
    })

    expect(label).toBe('Shopify Payments ···3024')
    expect(label).not.toContain('gid://')
    expect(label).not.toContain(SHOPIFY_PAYMENTS_GID)
    expect(label.length).toBeLessThan(SHOPIFY_PAYMENTS_GID.length)
  })

  // 🛑 The store is the counterexample: its external id IS its name, which is
  // why `source-scope.ts` falls back to the raw id for every unnamed row and
  // why that is only wrong for the processor account.
  it('with no name, keeps a shopify shop domain verbatim', () => {
    expect(
      sourceAccountLabel({ providerKey: 'shopify', externalAccountId: 'acme.myshopify.com' })
    ).toBe('acme.myshopify.com')
  })

  it('names the manual bucket rather than its sentinel id, even if named', () => {
    expect(sourceAccountLabel({ providerKey: 'auxx', externalAccountId: 'manual' })).toBe('Manual')
    expect(sourceAccountLabel({ providerKey: 'manual', externalAccountId: 'manual' })).toBe(
      'Manual'
    )
    expect(
      sourceAccountLabel({ name: 'Ignored', providerKey: 'auxx', externalAccountId: 'manual' })
    ).toBe('Manual')
  })

  it('with no name, qualifies a short, readable id with the provider', () => {
    expect(sourceAccountLabel({ providerKey: 'stripe', externalAccountId: 'acct_1A2B3C' })).toBe(
      'Stripe · acct_1A2B3C'
    )
  })

  it('with no name, titles an unknown provider key instead of printing it raw', () => {
    expect(sourceAccountLabel({ providerKey: 'some_new_rail', externalAccountId: 'acct_9' })).toBe(
      'Some New Rail · acct_9'
    )
  })

  it('falls back to the provider when there is no external id and no name', () => {
    expect(sourceAccountLabel({ providerKey: 'stripe', externalAccountId: '' })).toBe('Stripe')
  })
})

describe('sourceProviderLabel', () => {
  it('names the keys in the source namespace', () => {
    expect(sourceProviderLabel('shopify')).toBe('Shopify')
    expect(sourceProviderLabel('shopify_payments')).toBe('Shopify Payments')
    expect(sourceProviderLabel('stripe')).toBe('Stripe')
    expect(sourceProviderLabel('auxx')).toBe('Manual')
  })

  it('titles an unknown key', () => {
    expect(sourceProviderLabel('braintree')).toBe('Braintree')
    expect(sourceProviderLabel('some_new_rail')).toBe('Some New Rail')
  })
})

describe('isManualSource', () => {
  it('matches the sentinel bucket and nothing else', () => {
    expect(isManualSource({ providerKey: 'auxx', externalAccountId: 'manual' })).toBe(true)
    expect(isManualSource({ providerKey: 'manual', externalAccountId: 'manual' })).toBe(true)
    expect(isManualSource({ providerKey: 'stripe', externalAccountId: 'acct_1' })).toBe(false)
    expect(
      isManualSource({ providerKey: 'shopify_payments', externalAccountId: SHOPIFY_PAYMENTS_GID })
    ).toBe(false)
  })
})

describe('sourceAccountTooltip', () => {
  // The whole reason the badge carries a tooltip: the discarded id is something
  // somebody may have to paste into a provider dashboard. Ignores `name` on
  // purpose - the tooltip's job is to expose what the label hid.
  it('always carries the full external id for a connected account', () => {
    expect(
      sourceAccountTooltip({
        name: 'Primary payouts',
        providerKey: 'shopify_payments',
        externalAccountId: SHOPIFY_PAYMENTS_GID,
        environment: 'live',
      })
    ).toBe(`shopify_payments · ${SHOPIFY_PAYMENTS_GID} · live`)

    expect(
      sourceAccountTooltip({ providerKey: 'shopify', externalAccountId: 'acme.myshopify.com' })
    ).toContain('acme.myshopify.com')

    expect(
      sourceAccountTooltip({ providerKey: 'stripe', externalAccountId: 'acct_1A2B3C' })
    ).toContain('acct_1A2B3C')
  })

  it('omits the environment when the caller does not have it', () => {
    expect(
      sourceAccountTooltip({
        providerKey: 'shopify_payments',
        externalAccountId: SHOPIFY_PAYMENTS_GID,
        environment: null,
      })
    ).toBe(`shopify_payments · ${SHOPIFY_PAYMENTS_GID}`)
  })

  it('says what the manual bucket is rather than printing a fake identity', () => {
    const tooltip = sourceAccountTooltip({ providerKey: 'auxx', externalAccountId: 'manual' })
    expect(tooltip).toContain('Manual')
    expect(tooltip).toContain('not a connected account')
  })
})
