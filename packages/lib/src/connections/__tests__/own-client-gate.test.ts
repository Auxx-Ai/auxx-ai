// packages/lib/src/connections/__tests__/own-client-gate.test.ts
//
// The org-aware own-client gate. The definition's verification state decides first and is
// never overridden by the feature; `byoOAuthClient` only adds the third case — a verified
// platform client whose org may substitute its own app. The strip helper is the server-side
// half: it drops caller-supplied client credentials when the gate offers no BYO path.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const hasAccess = vi.fn<(orgId: string, key: string) => Promise<boolean>>()

vi.mock('../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    hasAccess = hasAccess
  },
}))

const { resolveOwnClientGateForOrg, stripUnentitledOwnClientVars } = await import(
  '../own-client-gate'
)

/** A verified platform client — the case the feature actually changes. */
const APPROVED = {
  oauth2ClientId: 'platform-id',
  oauth2ClientSecret: 'platform-secret',
  platformClientApproved: true,
}

describe('resolveOwnClientGateForOrg', () => {
  beforeEach(() => {
    hasAccess.mockReset()
  })

  it('offers nothing for a verified platform client when the org lacks the feature', async () => {
    hasAccess.mockResolvedValue(false)
    expect(await resolveOwnClientGateForOrg('org-1', APPROVED)).toEqual({
      requiresOwnClient: false,
      ownClientOptional: false,
      reason: null,
    })
  })

  it('offers BYO for a verified platform client when the org holds the feature', async () => {
    hasAccess.mockResolvedValue(true)
    expect(await resolveOwnClientGateForOrg('org-1', APPROVED)).toEqual({
      requiresOwnClient: false,
      ownClientOptional: true,
      reason: 'byo-entitled',
    })
  })

  it('keeps BYO mandatory when there is no platform client, without reading the feature', async () => {
    hasAccess.mockResolvedValue(false)
    const gate = await resolveOwnClientGateForOrg('org-1', {
      oauth2ClientId: null,
      oauth2ClientSecret: null,
      platformClientApproved: true,
    })
    expect(gate).toEqual({
      requiresOwnClient: true,
      ownClientOptional: false,
      reason: 'no-platform-client',
    })
    // The feature must never be able to un-require BYO — the org could not connect at all.
    expect(hasAccess).not.toHaveBeenCalled()
  })

  it('keeps the pending-approval reason (and its warning copy) over byo-entitled', async () => {
    hasAccess.mockResolvedValue(true)
    const gate = await resolveOwnClientGateForOrg('org-1', {
      ...APPROVED,
      platformClientApproved: false,
    })
    expect(gate).toEqual({
      requiresOwnClient: false,
      ownClientOptional: true,
      reason: 'pending-approval',
    })
    expect(hasAccess).not.toHaveBeenCalled()
  })
})

describe('oauth callback urls', () => {
  it('pins the provider segment to the providerKey, not a caller-supplied id', async () => {
    const { providerOAuthCallbackUrl } = await import('../oauth-callback-url')
    // The authorize route resolves its path param as `id OR providerKey`. Both spellings
    // must produce ONE redirect URI — a BYO user registers exactly one string.
    const byKey = providerOAuthCallbackUrl({ providerKey: 'gmail', id: 'cuid_abc' })
    const byIdOnly = providerOAuthCallbackUrl({ providerKey: 'gmail' })
    expect(byKey).toBe(byIdOnly)
    expect(byKey).toContain('/api/connections/gmail/oauth2/callback')
  })

  it('falls back to the definition id when there is no providerKey (app/mcp rows)', async () => {
    const { providerOAuthCallbackUrl } = await import('../oauth-callback-url')
    expect(providerOAuthCallbackUrl({ providerKey: null, id: 'cuid_abc' })).toContain(
      '/api/connections/cuid_abc/oauth2/callback'
    )
  })

  it('gives one app callback url per slug, shared by every method', async () => {
    const { appOAuthCallbackUrl } = await import('../oauth-callback-url')
    expect(appOAuthCallbackUrl('gog-calendar')).toContain('/api/apps/gog-calendar/oauth2/callback')
  })

  it('honours a definition-level callbackBaseUrl override', async () => {
    const { appOAuthCallbackUrl } = await import('../oauth-callback-url')
    expect(appOAuthCallbackUrl('shopify', 'https://tunnel.example')).toBe(
      'https://tunnel.example/api/apps/shopify/oauth2/callback'
    )
  })
})

describe('stripUnentitledOwnClientVars', () => {
  const CLOSED = { requiresOwnClient: false, ownClientOptional: false, reason: null } as const
  const OPEN = {
    requiresOwnClient: false,
    ownClientOptional: true,
    reason: 'byo-entitled',
  } as const

  it('drops query-supplied client credentials when the gate offers no BYO path', () => {
    expect(
      stripUnentitledOwnClientVars({ clientId: 'x', clientSecret: 'y', shop: 'acme' }, CLOSED)
    ).toEqual({ shop: 'acme' })
  })

  it('keeps them when the gate offers BYO', () => {
    const vars = { clientId: 'x', clientSecret: 'y' }
    expect(stripUnentitledOwnClientVars(vars, OPEN)).toEqual(vars)
  })

  it('leaves already-stored credentials alone so revoking the feature cannot repoint a live connection', () => {
    expect(
      stripUnentitledOwnClientVars({ clientId: 'stored', clientSecret: 'stored-secret' }, CLOSED, {
        clientId: 'stored',
        clientSecret: 'stored-secret',
      })
    ).toEqual({ clientId: 'stored', clientSecret: 'stored-secret' })
  })

  it('does not mutate the input', () => {
    const vars = { clientId: 'x' }
    stripUnentitledOwnClientVars(vars, CLOSED)
    expect(vars).toEqual({ clientId: 'x' })
  })
})
