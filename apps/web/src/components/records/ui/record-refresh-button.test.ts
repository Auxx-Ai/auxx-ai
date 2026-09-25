// apps/web/src/components/records/ui/record-refresh-button.test.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('~/trpc/react', () => ({ api: {} }))

const { buildRefreshEntries } = await import('./record-refresh-button')

const SHOPIFY_CHIP = { source: 'shopify', appInstallationId: 'ai_shop', connectionId: 'cred_1' }
const appTitle = (id: string) => (id === 'ai_shop' ? 'Shopify' : undefined)
const shopify = {
  id: 'dc_shop',
  name: 'My store',
  type: 'app:shopify',
  appInstallationId: 'ai_shop',
}
const rest = { id: 'dc_rest', name: 'Stripe REST', type: 'generic-rest', appInstallationId: null }

describe('buildRefreshEntries', () => {
  it('gives one entry per connector the cells name, branded from the cached list', () => {
    const entries = buildRefreshEntries({
      connectorIds: ['dc_shop', 'dc_other'],
      sources: [SHOPIFY_CHIP],
      connectors: [
        shopify,
        { ...shopify, id: 'dc_other', appInstallationId: 'ai_x', name: 'Other' },
      ],
      appTitle,
    })
    expect(entries).toEqual([
      { key: 'dc_shop', label: 'Refresh from Shopify', connectorId: 'dc_shop' },
      { key: 'dc_other', label: 'Refresh from Other', connectorId: 'dc_other' },
    ])
  })

  it('leaves out a connector the cached list says is generic REST', () => {
    const entries = buildRefreshEntries({
      connectorIds: ['dc_rest'],
      sources: [],
      connectors: [rest],
      appTitle,
    })
    expect(entries).toEqual([])
  })

  it('without the list, brands a lone connector from the lone chip, else reads "source"', () => {
    const lone = buildRefreshEntries({
      connectorIds: ['dc_shop'],
      sources: [SHOPIFY_CHIP],
      connectors: undefined,
      appTitle,
    })
    expect(lone[0]?.label).toBe('Refresh from Shopify')

    const unknown = buildRefreshEntries({
      connectorIds: ['dc_rest'],
      sources: [],
      connectors: undefined,
      appTitle,
    })
    expect(unknown).toEqual([
      { key: 'dc_rest', label: 'Refresh from source', connectorId: 'dc_rest' },
    ])
  })

  it('falls back to the source chips before the cells hydrate', () => {
    const entries = buildRefreshEntries({
      connectorIds: [],
      sources: [SHOPIFY_CHIP],
      connectors: undefined,
      appTitle,
    })
    expect(entries).toEqual([
      {
        key: 'ai_shop:cred_1',
        label: 'Refresh from Shopify',
        source: { appInstallationId: 'ai_shop', connectionId: 'cred_1' },
      },
    ])
  })
})
