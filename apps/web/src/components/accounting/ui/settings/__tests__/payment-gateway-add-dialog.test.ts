// apps/web/src/components/accounting/ui/settings/__tests__/payment-gateway-add-dialog.test.ts

import type { PaymentGatewayRow, RailFeedStatus } from '@auxx/lib/accounting/rails/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/trpc/react', () => ({ api: {} }))
vi.mock('~/components/data-connectors/hooks/use-can-manage-connectors', () => ({
  useCanManageConnectors: () => true,
}))

import { MINT_ACCOUNT_VALUE } from '../mapping-account-select'
import { addDialogFeed, draftFor, findSiblingGateway } from '../payment-gateway-add-dialog'
import { railReadinessLine } from '../payment-gateway-rail-rows'
import { railFeedCopy } from '../rail-feed-note'

function gateway(overrides: Partial<PaymentGatewayRow>): PaymentGatewayRow {
  return {
    id: 'pg_1',
    name: 'Authorize.Net',
    handles: ['authorize_net'],
    status: 'active',
    ...overrides,
  } as PaymentGatewayRow
}

describe('draftFor', () => {
  it('seeds a Blocked row handle as seen, with the catalogue name and treatment', () => {
    const draft = draftFor('authorize.net')
    expect(draft.handles).toEqual(['authorize.net'])
    expect(draft.name).toBe('Authorize.Net')
    // Billed in the catalogue, so its fees get an account of their own by default.
    expect(draft.feeTreatment).toBe('billed')
    expect(draft.accounts).toEqual({
      clearing: MINT_ACCOUNT_VALUE,
      payment_processing_fees: MINT_ACCOUNT_VALUE,
      bank: null,
    })
  })

  it('keeps the raw spelling of a handle and inherits fees on a netted rail', () => {
    const draft = draftFor('Affirm')
    expect(draft.handles).toEqual(['Affirm'])
    expect(draft.accounts.payment_processing_fees).toBe('inherit')
  })

  it('starts blank without a handle', () => {
    const draft = draftFor()
    expect(draft.handles).toEqual([])
    expect(draft.name).toBe('')
  })
})

describe('findSiblingGateway', () => {
  it('finds the gateway routing another catalogue spelling of the same rail', () => {
    const existing = gateway({})
    expect(findSiblingGateway('authorize.net', [existing])).toBe(existing)
  })

  it('ignores a gateway that already routes this handle', () => {
    expect(
      findSiblingGateway('authorize.net', [gateway({ handles: ['Authorize.net'] })])
    ).toBeNull()
  })

  it('ignores closed gateways and unknown handles', () => {
    expect(findSiblingGateway('authorize.net', [gateway({ status: 'closed' })])).toBeNull()
    expect(findSiblingGateway('my_gateway', [gateway({ handles: ['my-gateway'] })])).toBeNull()
  })
})

describe('railReadinessLine', () => {
  it('needs a clearing account first, then a bank once a feed is linked', () => {
    expect(
      railReadinessLine({ clearingMapped: false, bankMapped: false, feedLinked: false }).ready
    ).toBe(false)
    expect(
      railReadinessLine({ clearingMapped: true, bankMapped: false, feedLinked: true })
    ).toEqual({
      ready: false,
      text: 'Needs a receiving bank account for its feed.',
    })
    expect(
      railReadinessLine({ clearingMapped: true, bankMapped: false, feedLinked: false }).ready
    ).toBe(true)
  })

  it('says by hand when an app could supply the feed and none is linked', () => {
    const base = { clearingMapped: true, bankMapped: false, feedLinked: false }
    for (const state of ['not_installed', 'not_connected', 'syncing', 'available'] as const) {
      expect(railReadinessLine({ ...base, feed: { state, optional: false } })).toEqual({
        ready: true,
        text: 'Ready to post by hand.',
      })
    }
    expect(
      railReadinessLine({ ...base, feed: { state: 'not_installed', optional: true } }).text
    ).toBe('Ready to post.')
    expect(railReadinessLine({ ...base, feed: { state: 'none', optional: false } }).text).toBe(
      'Ready to post.'
    )
  })
})

describe('addDialogFeed', () => {
  // DemoOrg1: Shopify installed and connected, its one feed linked to the Shopify Payments rail.
  const shopCash: RailFeedStatus = {
    state: 'linked_elsewhere',
    feedApp: 'shopify',
    feedAppTitle: 'Shopify',
    processorLabel: 'Shopify Payments',
    connectorId: 'dc_shop',
    candidateSourceAccountId: null,
    optional: false,
    processorHandle: 'shop_cash',
    linkedGateway: { id: 'pg_shop', name: 'Shopify Payments', handles: ['shopify_payments'] },
  }

  it('does not tell a person to connect Shopify when it is connected and its feed is linked', () => {
    const feed = addDialogFeed(shopCash, false)
    const copy = railFeedCopy(feed, true)
    expect(copy?.sentence).toBe(
      'The Shopify Payments feed is linked to Shopify Payments (shopify_payments). Payouts for shop_cash settle there - add shop_cash to that gateway instead.'
    )
    expect(copy?.sentence).not.toMatch(/connect/i)
    expect(copy?.action).toMatchObject({ kind: 'href', label: 'Open Shopify Payments' })
  })

  it('leaves linked_elsewhere to the sibling suggestion when that is showing', () => {
    expect(addDialogFeed(shopCash, true)).toBeNull()
  })

  it('says syncing rather than connect while the connector has not synced', () => {
    const feed = addDialogFeed(
      { ...shopCash, state: 'syncing', linkedGateway: null, processorHandle: 'shopify_payments' },
      false
    )
    expect(railFeedCopy(feed, true)?.sentence).toBe(
      'Shopify is connected and has not synced payouts yet.'
    )
  })

  it('drops states with nothing to say', () => {
    expect(addDialogFeed({ ...shopCash, state: 'none', linkedGateway: null }, false)).toBeNull()
    expect(addDialogFeed(undefined, false)).toBeNull()
  })
})

describe('railReadinessLine with a feed linked elsewhere', () => {
  it('stays ready and names the gateway the payouts clear on', () => {
    expect(
      railReadinessLine({
        clearingMapped: true,
        bankMapped: false,
        feedLinked: false,
        feed: {
          state: 'linked_elsewhere',
          optional: false,
          linkedGateway: { id: 'pg_shop', name: 'Shopify Payments', handles: [] },
        },
      })
    ).toEqual({ ready: true, text: 'Ready to post, but its payouts clear on Shopify Payments.' })
  })
})
