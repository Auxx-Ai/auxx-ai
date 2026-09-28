// packages/lib/src/accounting/rails/__tests__/feed-status.test.ts

import { describe, expect, it } from 'vitest'
import { decideRailFeedState, type RailFeedInputs } from '../feed-state'

function inputs(overrides: Partial<RailFeedInputs> = {}): RailFeedInputs {
  return {
    handles: ['affirm'],
    linked: false,
    unlinkedFeeds: [],
    connectors: [],
    installedApps: new Map(),
    installableApps: new Map(),
    ...overrides,
  }
}

const affirmFeed = { processorAccountId: 'fsa_affirm', providerKey: 'affirm' }

describe('decideRailFeedState', () => {
  it('is linked when a live feed points at the rail, whatever else is true', () => {
    const status = decideRailFeedState(
      inputs({
        linked: true,
        unlinkedFeeds: [affirmFeed],
        installedApps: new Map([['affirm', 'Affirm']]),
      })
    )
    expect(status.state).toBe('linked')
    expect(status.candidateSourceAccountId).toBeNull()
  })

  it('is available with a one-click candidate when exactly one unlinked feed matches', () => {
    const status = decideRailFeedState(
      inputs({
        unlinkedFeeds: [
          affirmFeed,
          { processorAccountId: 'fsa_shop', providerKey: 'shopify_payments' },
        ],
      })
    )
    expect(status).toMatchObject({
      state: 'available',
      feedApp: 'affirm',
      processorLabel: 'Affirm',
      candidateSourceAccountId: 'fsa_affirm',
      optional: false,
    })
  })

  it('is available with no candidate when two unlinked feeds match, so the plain picker shows', () => {
    const status = decideRailFeedState(
      inputs({
        unlinkedFeeds: [affirmFeed, { processorAccountId: 'fsa_affirm_2', providerKey: 'affirm' }],
      })
    )
    expect(status.state).toBe('available')
    expect(status.candidateSourceAccountId).toBeNull()
  })

  it('is syncing when a live connector exists and no feed has data yet', () => {
    const status = decideRailFeedState(
      inputs({
        connectors: [{ id: 'dc_1', type: 'app:affirm', status: 'ready' }],
        installedApps: new Map([['affirm', 'Affirm']]),
      })
    )
    expect(status).toMatchObject({ state: 'syncing', connectorId: 'dc_1', feedAppTitle: 'Affirm' })
  })

  it('reads a connector being torn down or disconnected as absent', () => {
    const status = decideRailFeedState(
      inputs({
        connectors: [
          { id: 'dc_1', type: 'app:affirm', status: 'delete_failed' },
          { id: 'dc_2', type: 'app:affirm', status: 'disconnected' },
          { id: 'dc_3', type: 'app:shopify', status: 'live' },
        ],
        installedApps: new Map([['affirm', 'Affirm']]),
      })
    )
    expect(status).toMatchObject({ state: 'not_connected', connectorId: null })
  })

  it('is not_connected when the app is installed with no connector', () => {
    const status = decideRailFeedState(inputs({ installedApps: new Map([['affirm', 'Affirm']]) }))
    expect(status.state).toBe('not_connected')
  })

  it('is not_installed when the picker offers the app', () => {
    const status = decideRailFeedState(inputs({ installableApps: new Map([['affirm', 'Affirm']]) }))
    expect(status).toMatchObject({ state: 'not_installed', feedAppTitle: 'Affirm' })
  })

  it('is none when the feed app is neither installed nor offered', () => {
    const status = decideRailFeedState(inputs())
    expect(status).toMatchObject({ state: 'none', feedApp: 'affirm', feedAppTitle: null })
  })

  it('is none for a handle no processor settles', () => {
    const status = decideRailFeedState(
      inputs({ handles: ['paypal'], installedApps: new Map([['affirm', 'Affirm']]) })
    )
    expect(status).toMatchObject({ state: 'none', feedApp: null, processorLabel: null })
  })

  it('is none for Stripe, which has no feed app, until its own feed shows up', () => {
    expect(decideRailFeedState(inputs({ handles: ['stripe'] })).state).toBe('none')
    const available = decideRailFeedState(
      inputs({
        handles: ['stripe'],
        unlinkedFeeds: [{ processorAccountId: 'fsa_stripe', providerKey: 'stripe' }],
      })
    )
    expect(available).toMatchObject({ state: 'available', candidateSourceAccountId: 'fsa_stripe' })
  })

  it('marks Authorize.net optional, from its billed fee treatment, under any spelling', () => {
    for (const handle of ['authorize_net', 'Authorize.net', 'authorizenet']) {
      const status = decideRailFeedState(
        inputs({
          handles: [handle],
          installableApps: new Map([['authorize-net', 'Authorize.Net']]),
        })
      )
      expect(status).toMatchObject({
        state: 'not_installed',
        feedApp: 'authorize-net',
        optional: true,
      })
    }
  })

  it('names the feed app from the first handle whose processor has one', () => {
    const status = decideRailFeedState(
      inputs({
        handles: ['paypal', 'shop_pay_installments'],
        installedApps: new Map([['shopify', 'Shopify']]),
      })
    )
    expect(status).toMatchObject({
      state: 'not_connected',
      feedApp: 'shopify',
      processorLabel: 'Shopify Payments',
    })
  })
})
