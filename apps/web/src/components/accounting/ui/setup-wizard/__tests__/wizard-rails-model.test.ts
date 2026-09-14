// apps/web/src/components/accounting/ui/setup-wizard/__tests__/wizard-rails-model.test.ts
//
// The pure functions behind the wizard's payment-rails page (brief 26 §8, §9,
// §13 decision 1): the rail grouping and its merge offer, §5's asymmetric
// fee-account default, the stale-rail test, the shared-account detector, and
// the fee-fallback warning. No query, no component - the same shape
// `pack-picker.test.ts` takes for the chart-pack cascade.

import type { GatewayHandleCensusRow, PaymentGatewayRow } from '@auxx/lib/payment-gateways/client'
import { describe, expect, it } from 'vitest'
import {
  buildRailGroups,
  defaultMintFeeAccount,
  isStaleRail,
  sharedClearingAccounts,
  warnsAboutFeeFallback,
} from '../wizard-rails-model'

function census(
  handle: string,
  overrides: Partial<GatewayHandleCensusRow> = {}
): GatewayHandleCensusRow {
  return { handle, claimedBy: null, orderCount: 1, lastSeenAt: null, ...overrides }
}

function gateway(overrides: Partial<PaymentGatewayRow> = {}): PaymentGatewayRow {
  return {
    id: 'pg_1',
    recordId: 'payment_gateway:pg_1',
    name: 'Gateway',
    handles: [],
    clearingGlAccountId: 'gl_1200',
    feeGlAccountId: null,
    settlementSource: 'manual',
    feeTreatment: 'netted',
    status: 'active',
    lastSettlementAt: null,
    lastFeeBookedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('buildRailGroups', () => {
  it('groups two spellings of one rail into a single row, summing the counts', () => {
    const groups = buildRailGroups([
      census('authorize_net', { orderCount: 5308, lastSeenAt: '2026-03-11' }),
      census('authorize.net', { orderCount: 64, lastSeenAt: '2026-02-28' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toBe('Authorize.Net')
    expect(groups[0]?.orderCount).toBe(5372)
    expect(groups[0]?.lastSeenAt).toBe('2026-03-11')
    expect(groups[0]?.handles.map((row) => row.handle)).toEqual(['authorize_net', 'authorize.net'])
  })

  it('folds every Shopify handle onto one rail, because they arrive in one deposit', () => {
    const groups = buildRailGroups([
      census('shopify_payments', { orderCount: 979 }),
      census('shop_cash', { orderCount: 1 }),
      census('shop_pay_installments', { orderCount: 12 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toBe('Shopify Payments')
    expect(groups[0]?.orderCount).toBe(992)
  })

  it('leaves an unknown handle as its own rail rather than folding it into somebody else', () => {
    const groups = buildRailGroups([census('acme_pay_v2'), census('stripe')])
    expect(groups.map((group) => group.name).sort()).toEqual(['Acme Pay V2', 'Stripe'])
    expect(groups.find((group) => group.name === 'Acme Pay V2')?.suggestion.known).toBe(false)
  })

  it('is unrouted when nothing claims any spelling', () => {
    const groups = buildRailGroups([census('affirm')])
    expect(groups[0]?.state).toBe('unrouted')
    expect(groups[0]?.mergeInto).toBeNull()
  })

  it('is routed when every spelling is claimed', () => {
    const groups = buildRailGroups([
      census('authorize_net', { claimedBy: 'pg_1' }),
      census('authorize.net', { claimedBy: 'pg_1' }),
    ])
    expect(groups[0]?.state).toBe('routed')
    expect(groups[0]?.mergeInto).toBeNull()
  })

  it('offers the merge when one gateway claims part of a rail', () => {
    // 🔑 The whole point of §8 item 2: the loose spelling is silently falling
    // back to the shared card-clearing account today.
    const groups = buildRailGroups([
      census('authorize_net', { claimedBy: 'pg_1', orderCount: 5308 }),
      census('authorize.net', { orderCount: 64 }),
    ])

    expect(groups[0]?.state).toBe('split')
    expect(groups[0]?.mergeInto).toBe('pg_1')
    expect(groups[0]?.mergeHandles).toEqual(['authorize.net'])
  })

  it('refuses to guess when two gateways split one rail', () => {
    const groups = buildRailGroups([
      census('authorize_net', { claimedBy: 'pg_1', orderCount: 10 }),
      census('authorize.net', { claimedBy: 'pg_2', orderCount: 5 }),
      census('authorizenet', { orderCount: 1 }),
    ])

    expect(groups[0]?.state).toBe('split')
    expect(groups[0]?.claimedBy).toEqual(['pg_1', 'pg_2'])
    expect(groups[0]?.mergeInto).toBeNull()
    expect(groups[0]?.mergeHandles).toEqual([])
  })

  it('sorts busiest rail first', () => {
    const groups = buildRailGroups([
      census('affirm', { orderCount: 141 }),
      census('authorize_net', { orderCount: 5308 }),
    ])
    expect(groups.map((group) => group.name)).toEqual(['Authorize.Net', 'Affirm'])
  })

  it('is empty over an empty census', () => {
    expect(buildRailGroups([])).toEqual([])
  })
})

describe('defaultMintFeeAccount', () => {
  it('is OFF for a netted rail - the fee is booked automatically into the shared account', () => {
    expect(defaultMintFeeAccount('netted')).toBe(false)
  })

  it('is ON for a billed rail - otherwise "has it billed us" is unanswerable', () => {
    expect(defaultMintFeeAccount('billed')).toBe(true)
  })
})

describe('isStaleRail', () => {
  const today = new Date('2026-09-14T00:00:00.000Z')

  it('is false for a rail that traded last week', () => {
    expect(isStaleRail('2026-09-09', today)).toBe(false)
  })

  it('is true for a rail whose last order is six months back', () => {
    expect(isStaleRail('2026-01-11', today)).toBe(true)
  })

  it('is false when there is no date at all - unknown is not old', () => {
    expect(isStaleRail(null, today)).toBe(false)
  })

  it('is false for an unparseable date rather than pre-ticking closed', () => {
    expect(isStaleRail('not-a-date', today)).toBe(false)
  })
})

describe('sharedClearingAccounts', () => {
  it('is empty when every gateway has its own account', () => {
    expect(
      sharedClearingAccounts([
        gateway({ id: 'pg_1', clearingGlAccountId: 'gl_1200' }),
        gateway({ id: 'pg_2', clearingGlAccountId: 'gl_1210' }),
      ]).size
    ).toBe(0)
  })

  it('reports only the accounts held by more than one gateway', () => {
    const shared = sharedClearingAccounts([
      gateway({ id: 'pg_1', clearingGlAccountId: 'gl_1200' }),
      gateway({ id: 'pg_2', clearingGlAccountId: 'gl_1200' }),
      gateway({ id: 'pg_3', clearingGlAccountId: 'gl_1210' }),
    ])

    expect([...shared.keys()]).toEqual(['gl_1200'])
    expect(shared.get('gl_1200')?.map((row) => row.id)).toEqual(['pg_1', 'pg_2'])
  })

  it('ignores a gateway with no clearing account at all', () => {
    expect(
      sharedClearingAccounts([
        gateway({ id: 'pg_1', clearingGlAccountId: '' }),
        gateway({ id: 'pg_2', clearingGlAccountId: '' }),
      ]).size
    ).toBe(0)
  })
})

describe('warnsAboutFeeFallback', () => {
  const nettedGroups = buildRailGroups([census('affirm')])

  it('does not warn when an account holds the role', () => {
    expect(
      warnsAboutFeeFallback({ fallbackMapped: true, gateways: [], groups: nettedGroups })
    ).toBe(false)
  })

  it('warns for a rail this page is about to create that would rely on the fallback', () => {
    // §12 test 7: it warns, and nothing about it blocks Continue - this
    // function answers a render question and no navigation consults it.
    expect(
      warnsAboutFeeFallback({ fallbackMapped: false, gateways: [], groups: nettedGroups })
    ).toBe(true)
  })

  it('warns for an existing netted gateway with no fee account of its own', () => {
    expect(
      warnsAboutFeeFallback({
        fallbackMapped: false,
        gateways: [gateway({ feeTreatment: 'netted', feeGlAccountId: null })],
        groups: [],
      })
    ).toBe(true)
  })

  it('does not warn when every netted rail already has its own fee account', () => {
    expect(
      warnsAboutFeeFallback({
        fallbackMapped: false,
        gateways: [gateway({ feeTreatment: 'netted', feeGlAccountId: 'gl_6110' })],
        groups: buildRailGroups([census('affirm', { claimedBy: 'pg_1' })]),
      })
    ).toBe(false)
  })

  it('does not warn for a billed rail, whose fees never touch the fallback by default', () => {
    expect(
      warnsAboutFeeFallback({
        fallbackMapped: false,
        gateways: [gateway({ feeTreatment: 'billed', feeGlAccountId: 'gl_6110' })],
        groups: buildRailGroups([census('authorize_net')]),
      })
    ).toBe(false)
  })
})
