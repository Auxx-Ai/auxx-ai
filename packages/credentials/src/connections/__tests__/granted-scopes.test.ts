// packages/credentials/src/connections/__tests__/granted-scopes.test.ts

import { describe, expect, it } from 'vitest'
import { resolveGrantedScopes } from '../resolve-connection-definition'

describe('resolveGrantedScopes', () => {
  it('prefers the provider’s token-response scope', () => {
    expect(resolveGrantedScopes('read_orders write_orders', ['read_orders'])).toBe(
      'read_orders write_orders'
    )
  })

  it('falls back to the requested list when the response omits scope (RFC 6749 §5.1)', () => {
    expect(resolveGrantedScopes(undefined, ['read_orders', 'write_products'])).toBe(
      'read_orders write_products'
    )
  })

  it('treats a blank response scope as omitted, not as "no scopes"', () => {
    expect(resolveGrantedScopes('   ', ['read_orders'])).toBe('read_orders')
  })

  it('preserves the previously stored value when there is nothing better', () => {
    // The OAuth-mint path replaces `metadata` wholesale, so returning empty here would
    // destroy the only record of what the connection can do.
    expect(resolveGrantedScopes(undefined, [], 'read_orders write_orders')).toBe(
      'read_orders write_orders'
    )
    expect(resolveGrantedScopes(null, null, 'read_orders')).toBe('read_orders')
  })

  it('returns undefined when nothing is known, rather than an empty string', () => {
    expect(resolveGrantedScopes(undefined, [])).toBeUndefined()
    expect(resolveGrantedScopes(null, null, '  ')).toBeUndefined()
  })
})
