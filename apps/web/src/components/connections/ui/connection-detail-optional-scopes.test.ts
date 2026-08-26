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
  it('is false for a non-oauth2 method even with optional scopes declared', () => {
    const secret = method({ connectionType: 'secret', requiresOwnClient: true })
    expect(shouldOfferOptionalScopes(secret, true)).toBe(false)
    expect(shouldOfferOptionalScopes(secret, false)).toBe(false)
  })

  it('is false when the optional list is empty, missing or null', () => {
    expect(
      shouldOfferOptionalScopes(method({ oauth2OptionalScopes: [], requiresOwnClient: true }), true)
    ).toBe(false)
    expect(
      shouldOfferOptionalScopes(
        method({ oauth2OptionalScopes: null, requiresOwnClient: true }),
        true
      )
    ).toBe(false)
    expect(
      shouldOfferOptionalScopes(
        method({ oauth2OptionalScopes: undefined, requiresOwnClient: true }),
        true
      )
    ).toBe(false)
  })

  it('is true for requiresOwnClient regardless of the disclosure state', () => {
    const mandatory = method({ requiresOwnClient: true })
    expect(shouldOfferOptionalScopes(mandatory, false)).toBe(true)
    expect(shouldOfferOptionalScopes(mandatory, true)).toBe(true)
  })

  it('follows the disclosure for an ownClientOptional method', () => {
    const optionalByo = method({ ownClientOptional: true })
    expect(shouldOfferOptionalScopes(optionalByo, false)).toBe(false)
    expect(shouldOfferOptionalScopes(optionalByo, true)).toBe(true)
  })

  it('is false on the platform client when BYO is not offered at all', () => {
    const platformOnly = method()
    expect(shouldOfferOptionalScopes(platformOnly, false)).toBe(false)
    expect(shouldOfferOptionalScopes(platformOnly, true)).toBe(false)
  })
})
