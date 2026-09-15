// apps/web/src/components/connections/ui/connection-detail-optional-scopes.test.ts

import { describe, expect, it } from 'vitest'
import { type DetailMethod, shouldOfferOptionalScopes } from './connection-detail-page'

function method(overrides: Partial<DetailMethod> = {}): DetailMethod {
  return {
    id: 'm1',
    label: 'Shopify',
    description: null,
    connectionType: 'oauth2-code',
    global: true,
    oauth2Scopes: ['read_orders'],
    oauth2OptionalScopes: ['read_all_orders'],
    ...overrides,
  }
}

describe('shouldOfferOptionalScopes', () => {
  it('excludes non-OAuth methods', () => {
    expect(shouldOfferOptionalScopes(method({ connectionType: 'secret' }))).toBe(false)
  })
  it.each([[], null, undefined])('excludes an empty optional vocabulary: %s', (scopes) => {
    expect(shouldOfferOptionalScopes(method({ oauth2OptionalScopes: scopes }))).toBe(false)
  })
  it.each([
    {},
    { requiresOwnClient: true },
    { ownClientOptional: true },
  ])('offers permissions regardless of OAuth client ownership: %s', (client) => {
    expect(shouldOfferOptionalScopes(method(client))).toBe(true)
  })
})
