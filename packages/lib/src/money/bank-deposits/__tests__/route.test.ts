// packages/lib/src/money/bank-deposits/__tests__/route.test.ts
//
// The route table is the piece of this slot that is wrong SILENTLY. Post a
// cheque straight to cash and the account is right in total and wrong line by
// line; route a card through undeposited funds and a deposit asserts a gross
// amount the bank never credited. Both still balance, so nothing downstream
// detects either. Hence: every rail is pinned, and the two copies of the
// defaults (this module's, and the settings catalog's) are asserted equal.

import { describe, expect, it } from 'vitest'
import { SETTINGS_CATALOG } from '../../../settings/catalog'
import { groupByDay, isBankDepositFrozen, resolveBankDepositStatus } from '../client'
import {
  DEFAULT_PAYMENT_ROUTES,
  methodsRoutedToUndepositedFunds,
  PAYMENT_ROUTE_SETTING_KEYS,
  type PaymentRouteMethod,
  resolvePaymentRoute,
} from '../route'

const METHODS: PaymentRouteMethod[] = ['cash', 'check', 'card', 'bank', 'other']

describe('the shipped route table', () => {
  it('banks cash and cheques, sends ACH to cash and cards to clearing', () => {
    expect(DEFAULT_PAYMENT_ROUTES).toEqual({
      cash: 'undeposited_funds',
      check: 'undeposited_funds',
      card: 'clearing',
      bank: 'cash',
      other: 'undeposited_funds',
    })
  })

  it('never routes a card through undeposited funds', () => {
    // A card settles as a NET payout days later. Grouping one into a deposit
    // would assert the gross at the bank, and the payout entry would then have
    // nothing to drain.
    expect(resolvePaymentRoute('card', {})).not.toBe('undeposited_funds')
  })

  it('agrees with the settings catalog, key for key', () => {
    // Two copies exist on purpose: the catalog's `defaultValue` is what a form
    // renders, and DEFAULT_PAYMENT_ROUTES is what the builder falls back to on
    // an org that has never opened that form. A divergence would make the
    // screen say one thing and the ledger do another.
    for (const method of METHODS) {
      const key = PAYMENT_ROUTE_SETTING_KEYS[method]
      const entry = SETTINGS_CATALOG[key as keyof typeof SETTINGS_CATALOG]
      expect(entry, `catalog is missing ${key}`).toBeDefined()
      expect(entry.defaultValue).toBe(DEFAULT_PAYMENT_ROUTES[method])
      expect(entry.fieldType).toBe('SINGLE_SELECT')
      expect(entry.scope).toBe('GENERAL')
      expect(entry.access).toBe('org')
    }
  })

  it('offers exactly the three destinations the resolver recognises', () => {
    const entry = SETTINGS_CATALOG['accounting.paymentRoute.cash']
    const options = entry.options as { options: Array<{ value: string }> }
    expect(options.options.map((o) => o.value)).toEqual(['undeposited_funds', 'cash', 'clearing'])
  })
})

describe('resolvePaymentRoute', () => {
  it('reads the org setting when it is set', () => {
    expect(resolvePaymentRoute('check', { 'accounting.paymentRoute.check': 'cash' })).toBe('cash')
  })

  it('falls back to the shipped default rather than throwing', () => {
    // This runs on the posting path for every receipt. An org that has never
    // opened the settings page has no rows at all, and refusing there would
    // stop payments posting for a setting nobody knew existed.
    for (const method of METHODS) {
      expect(resolvePaymentRoute(method, null)).toBe(DEFAULT_PAYMENT_ROUTES[method])
      expect(resolvePaymentRoute(method, {})).toBe(DEFAULT_PAYMENT_ROUTES[method])
    }
  })

  it('ignores a value it does not recognise instead of routing to it', () => {
    expect(resolvePaymentRoute('check', { 'accounting.paymentRoute.check': 'nowhere' })).toBe(
      'undeposited_funds'
    )
  })

  it('treats an unknown or missing method as `other`, the safe unknown', () => {
    expect(resolvePaymentRoute('crypto', {})).toBe('undeposited_funds')
    expect(resolvePaymentRoute(null, {})).toBe('undeposited_funds')
    expect(resolvePaymentRoute(undefined, {})).toBe('undeposited_funds')
  })
})

describe('methodsRoutedToUndepositedFunds', () => {
  it('is the undeposited list filter, and it obeys the org settings', () => {
    expect(methodsRoutedToUndepositedFunds({}).sort()).toEqual(['cash', 'check', 'other'])
    expect(
      methodsRoutedToUndepositedFunds({ 'accounting.paymentRoute.other': 'cash' }).sort()
    ).toEqual(['cash', 'check'])
  })

  it('can be empty, and empty means there is nothing to group', () => {
    const everythingDirect = Object.fromEntries(
      METHODS.map((method) => [PAYMENT_ROUTE_SETTING_KEYS[method], 'cash'])
    )
    expect(methodsRoutedToUndepositedFunds(everythingDirect)).toEqual([])
  })
})

describe('the freeze rule', () => {
  it('freezes a cleared deposit and one matched to a bank line', () => {
    expect(isBankDepositFrozen({ status: 'pending', bankTransactionId: null })).toBe(false)
    expect(isBankDepositFrozen({ status: 'cleared', bankTransactionId: null })).toBe(true)
    expect(isBankDepositFrozen({ status: 'pending', bankTransactionId: 'bt_1' })).toBe(true)
  })

  it('reads an unrecognised status as pending, never as cleared', () => {
    // `cleared` is the value that FREEZES the row. Guessing it would lock a
    // deposit nobody has matched.
    expect(resolveBankDepositStatus(undefined)).toBe('pending')
    expect(resolveBankDepositStatus('nonsense')).toBe('pending')
    expect(resolveBankDepositStatus('cleared')).toBe('cleared')
  })
})

describe('groupByDay', () => {
  it('groups rows by day, newest first, with a day total', () => {
    expect(
      groupByDay([
        { date: '2026-09-01', amountMinor: 1000 },
        { date: '2026-09-03', amountMinor: 2500 },
        { date: '2026-09-01', amountMinor: 500 },
      ])
    ).toEqual([
      { day: '2026-09-03', rows: [{ date: '2026-09-03', amountMinor: 2500 }], totalMinor: 2500 },
      {
        day: '2026-09-01',
        rows: [
          { date: '2026-09-01', amountMinor: 1000 },
          { date: '2026-09-01', amountMinor: 500 },
        ],
        totalMinor: 1500,
      },
    ])
  })

  it('keeps a dateless row rather than dropping it', () => {
    // A payment with no date is still money that was received and not banked.
    // Dropping it here would make the undeposited balance unexplainable.
    expect(groupByDay([{ date: null, amountMinor: 100 }])[0]?.day).toBe('unknown')
  })
})
