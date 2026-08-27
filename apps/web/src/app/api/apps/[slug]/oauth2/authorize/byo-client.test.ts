// apps/web/src/app/api/apps/[slug]/oauth2/authorize/byo-client.test.ts
//
// The regression guard for plans/connections/byo-oauth-client-runtime-gap.md F1.
//
// What this pins is one thing: **which `client_id` ends up on the authorize URL**. The whole
// bug was that a bring-your-own client id/secret was collected by the dialog, sent as
// `var_clientId`/`var_clientSecret`, and then dropped by this route's allowlist — which read
// the definition's STORED `connectionVariables` (for Shopify: just `shop`) instead of the
// gated list that injects the BYO descriptors. The merchant was silently sent to consent for
// the PLATFORM app, believing they were installing their own.
//
// Before this file, `var_clientId` appeared in exactly two files repo-wide — the two
// authorize routes — and neither had a test.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  resolveAppConnectionForRuntime,
  getSession,
  resolveAppSlug,
  findFirstInstallation,
  findFirstConnDef,
  resolveOwnClientGateForOrg,
  requirePermission,
  redisSetex,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveAppSlug: vi.fn(),
  findFirstInstallation: vi.fn(),
  findFirstConnDef: vi.fn(),
  resolveOwnClientGateForOrg: vi.fn(),
  requirePermission: vi.fn(async () => undefined),
  redisSetex: vi.fn(async () => 'OK'),
  resolveAppConnectionForRuntime: vi.fn(),
}))

const PLATFORM_CLIENT = '588ef3496716248f2de2d485e57364ec'
const BYO_CLIENT = '923366ae8d1cea01903c8ce4bb2de30c'
const BYO_SECRET = 'shpss_byo_secret_value'

const ORG = 'gax9ejju84qyloup0ctdxc8r'
const USER = 'PXDf74MTsYWf9vaVUMgLS9kWmozN6Ydz'
const APP_ID = 'seawyfbhwukgionxzv5o30yb'
const INSTALLATION = 'jdquls613446zt7qyxum8eqw'
const CONN_DEF = 'mq1klf9zvjhnfczvuj8s8a0r'

/** The real Shopify app def: declares `shop` only — no BYO descriptors stored. */
const shopifyDef = {
  id: CONN_DEF,
  appId: APP_ID,
  connectionType: 'oauth2-code',
  global: true,
  connectionVariables: [{ key: 'shop', label: 'Shop subdomain' }],
  oauth2AuthorizeUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
  oauth2AccessTokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
  oauth2ClientId: PLATFORM_CLIENT,
  oauth2ClientSecret: 'shps_platform_secret',
  oauth2Scopes: ['read_orders', 'write_orders'],
  oauth2Features: {},
  oauth2TokenRequestAuthMethod: 'request-body',
  platformClientApproved: true,
}

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    database: {
      query: {
        AppInstallation: { findFirst: (...a: unknown[]) => findFirstInstallation(...a) },
        ConnectionDefinition: { findFirst: (...a: unknown[]) => findFirstConnDef(...a) },
      },
    },
  })
)
vi.mock('@auxx/lib/cache', () => ({ resolveAppSlug }))
vi.mock('@auxx/lib/apps', () => ({ resolveAppConnectionForRuntime }))
vi.mock('@auxx/lib/permissions', () => ({
  PermissionKey: { integrationsManage: 'integrationsManage' },
  requirePermission,
}))
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
// Partial: `@auxx/lib/connections` is loaded for real below, and it reaches
// `credential-lock.ts` → `createCredentialLockProvider`. Replacing the module wholesale
// breaks that import chain.
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisClient: async () => ({ setex: redisSetex }),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Everything in `@auxx/lib/connections` is real EXCEPT the org-aware gate, which would need a
// feature-permission DB read. Keeping the rest real is the point: `effectiveConnectionVariables`
// and `resolveOAuth2Client` are exactly the collaborators under test.
vi.mock('@auxx/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/lib/connections')>()),
  resolveOwnClientGateForOrg,
}))

const authorizeUrlFor = async (params: Record<string, string>) => {
  const { GET } = await import('./route')
  const url = new URL('https://app.auxx.ai/api/apps/shopify/oauth2/authorize')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await GET({ nextUrl: url, cookies: { get: () => undefined } } as never, {
    params: Promise.resolve({ slug: 'shopify' }),
  })
  return res
}

const BASE_PARAMS = {
  installation: INSTALLATION,
  type: 'organization',
  connectionDefinitionId: CONN_DEF,
  var_shop: 'storage-system',
  mode: 'redirect',
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: USER, defaultOrganizationId: ORG } })
  resolveAppSlug.mockResolvedValue(APP_ID)
  findFirstInstallation.mockResolvedValue({ id: INSTALLATION, app: { title: 'Shopify' } })
  findFirstConnDef.mockResolvedValue(shopifyDef)
  redisSetex.mockResolvedValue('OK')
})

describe('app authorize route — bring-your-own OAuth client', () => {
  it('uses the BYO client id when the org is entitled (F1)', async () => {
    resolveOwnClientGateForOrg.mockResolvedValue({
      requiresOwnClient: false,
      ownClientOptional: true,
      reason: 'byo-entitled',
    })

    const res = await authorizeUrlFor({
      ...BASE_PARAMS,
      var_clientId: BYO_CLIENT,
      var_clientSecret: BYO_SECRET,
    })

    const location = res.headers.get('location') ?? ''
    expect(location).toContain(`client_id=${BYO_CLIENT}`)
    expect(location).not.toContain(PLATFORM_CLIENT)
  })

  it('carries the BYO secret into the Redis state so the code exchange can sign with it', async () => {
    resolveOwnClientGateForOrg.mockResolvedValue({
      requiresOwnClient: false,
      ownClientOptional: true,
      reason: 'byo-entitled',
    })

    await authorizeUrlFor({
      ...BASE_PARAMS,
      var_clientId: BYO_CLIENT,
      var_clientSecret: BYO_SECRET,
    })

    const [, , payload] = redisSetex.mock.calls[0] as [string, number, string]
    expect(JSON.parse(payload).connectionVariables).toMatchObject({
      shop: 'storage-system',
      clientId: BYO_CLIENT,
      clientSecret: BYO_SECRET,
    })
  })

  it('falls back to the platform client when no BYO credentials are supplied', async () => {
    resolveOwnClientGateForOrg.mockResolvedValue({
      requiresOwnClient: false,
      ownClientOptional: true,
      reason: 'byo-entitled',
    })

    const res = await authorizeUrlFor(BASE_PARAMS)
    expect(res.headers.get('location') ?? '').toContain(`client_id=${PLATFORM_CLIENT}`)
  })

  it('ignores query-string BYO credentials when the org is NOT entitled', async () => {
    resolveOwnClientGateForOrg.mockResolvedValue({
      requiresOwnClient: false,
      ownClientOptional: false,
      reason: null,
    })

    const res = await authorizeUrlFor({
      ...BASE_PARAMS,
      var_clientId: BYO_CLIENT,
      var_clientSecret: BYO_SECRET,
    })

    const location = res.headers.get('location') ?? ''
    expect(location).toContain(`client_id=${PLATFORM_CLIENT}`)
    expect(location).not.toContain(BYO_CLIENT)
  })

  it('rejects half a BYO pair rather than mixing clients (F4)', async () => {
    resolveOwnClientGateForOrg.mockResolvedValue({
      requiresOwnClient: false,
      ownClientOptional: true,
      reason: 'byo-entitled',
    })

    const res = await authorizeUrlFor({ ...BASE_PARAMS, var_clientId: BYO_CLIENT })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('secret'),
    })
  })

  // F1's worse half. The stored-value fallback lives INSIDE the same allowlist loop, so a
  // reconnect that supplies no credentials used to drop the connection's own stored client
  // and silently repoint a live BYO connection at the platform app — the exact thing
  // `stripUnentitledOwnClientVars`' doc comment promises can never happen.
  it('preserves a stored BYO client across a reconnect that supplies nothing', async () => {
    resolveOwnClientGateForOrg.mockResolvedValue({
      requiresOwnClient: false,
      ownClientOptional: true,
      reason: 'byo-entitled',
    })
    resolveAppConnectionForRuntime.mockResolvedValue({
      isOk: () => true,
      value: {
        organizationConnection: {
          fields: { shop: 'storage-system', clientId: BYO_CLIENT, clientSecret: BYO_SECRET },
        },
      },
    })

    const res = await authorizeUrlFor({
      installation: INSTALLATION,
      type: 'organization',
      connectionDefinitionId: CONN_DEF,
      connectionId: 'existing-credential-id',
      mode: 'redirect',
    })

    const location = res.headers.get('location') ?? ''
    expect(location).toContain(`client_id=${BYO_CLIENT}`)
    expect(location).not.toContain(PLATFORM_CLIENT)
  })

  it('keeps a stored BYO client even after the org loses the entitlement', async () => {
    resolveOwnClientGateForOrg.mockResolvedValue({
      requiresOwnClient: false,
      ownClientOptional: false,
      reason: null,
    })
    resolveAppConnectionForRuntime.mockResolvedValue({
      isOk: () => true,
      value: {
        organizationConnection: {
          fields: { shop: 'storage-system', clientId: BYO_CLIENT, clientSecret: BYO_SECRET },
        },
      },
    })

    const res = await authorizeUrlFor({
      installation: INSTALLATION,
      type: 'organization',
      connectionDefinitionId: CONN_DEF,
      connectionId: 'existing-credential-id',
      mode: 'redirect',
    })

    expect(res.headers.get('location') ?? '').toContain(`client_id=${BYO_CLIENT}`)
  })
})
