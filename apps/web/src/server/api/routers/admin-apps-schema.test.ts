// apps/web/src/server/api/routers/admin-apps-schema.test.ts
//
// `connectionDefinitionSchema` is a zod `z.object`, which STRIPS unknown keys. Any
// field the exporter writes and this schema omits never reaches `importApps` — that is
// how `key`, `connectionVariables`, `authApply` and `baseUrlTemplate` were each lost
// (see the comment above the schema). These tests pin the newest column,
// `oauth2OptionalScopes`, on both sides of that trap: it must survive a parse, and its
// absence must not reject the export files that already exist.

import { describe, expect, it, vi } from 'vitest'

// The router graph reaches `apps/web/src/auth/session.ts`, which imports `server-only`.
vi.mock('server-only', () => ({}))

const { connectionDefinitionSchema } = await import('./admin-apps')

const BASE = {
  key: 'default',
  connectionType: 'oauth2-code',
  label: 'Shopify',
  description: null,
  global: false,
  major: 1,
  oauth2AuthorizeUrl: 'https://example.test/authorize',
  oauth2AccessTokenUrl: 'https://example.test/token',
  oauth2ClientId: 'client-id',
  oauth2Scopes: ['read_orders'],
  oauth2TokenRequestAuthMethod: 'client_secret_post',
  oauth2RefreshTokenIntervalSeconds: null,
  oauth2Features: null,
}

describe('connectionDefinitionSchema — oauth2OptionalScopes', () => {
  it('retains oauth2OptionalScopes instead of stripping it', () => {
    const parsed = connectionDefinitionSchema.parse({
      ...BASE,
      oauth2OptionalScopes: ['read_all_orders'],
    })

    expect(parsed.oauth2OptionalScopes).toEqual(['read_all_orders'])
  })

  it('still validates an export produced before the exporter emitted the field', () => {
    const parsed = connectionDefinitionSchema.parse(BASE)

    expect(parsed.oauth2Scopes).toEqual(['read_orders'])
    expect(parsed.oauth2OptionalScopes).toBeUndefined()
  })

  it('accepts an explicit null (the column is nullable)', () => {
    const parsed = connectionDefinitionSchema.parse({ ...BASE, oauth2OptionalScopes: null })

    expect(parsed.oauth2OptionalScopes).toBeNull()
  })

  it('rejects a non-string-array', () => {
    expect(() =>
      connectionDefinitionSchema.parse({ ...BASE, oauth2OptionalScopes: 'read_all_orders' })
    ).toThrow()
  })
})
