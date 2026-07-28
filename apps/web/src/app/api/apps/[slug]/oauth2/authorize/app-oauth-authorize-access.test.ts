// apps/web/src/app/api/apps/[slug]/oauth2/authorize/app-oauth-authorize-access.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **The live privilege hole this slice closed.**
 *
 * This REST authorize route authenticated with `auth.api.getSession` alone and read NO
 * capabilities. Its callback writes the credential's `userId` column as
 * `metadata.global ? null : metadata.userId` — and a `null` `userId` is an **org-scoped**
 * credential. Meanwhile the tRPC sibling `apps.saveSecretConnection` computes `isOrgScoped` and
 * asserts `integrationsManage` for exactly that case, and `apps.install` / `uninstall` /
 * `setDefaultConnection` are all `permissionProcedure(integrationsManage)`.
 *
 * The fix mirrors `saveSecretConnection` rather than gating the whole route: **user-scoped
 * connects stay ungated** (the connection belongs to the caller, plan 21 §4.1). The carve-out
 * case below is the regression test that matters most — gating it would break every member
 * connecting their own Google/Slack account.
 *
 * Behavioral: the REAL handler runs and a REAL `CapabilitySet` answers the assert. The Redis
 * `setex` — the state write that makes the callback's credential write reachable — is the
 * observed side effect.
 */

const {
  getCapabilities,
  getSession,
  redis,
  db,
  interpolate,
  resolveAppSlug,
  resolveAppConnection,
  resolveOAuth2Client,
  resolveOwnClientRequirement,
} = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  redis: { setex: vi.fn(async () => 'OK') },
  db: { appInstallation: vi.fn(), connectionDefinition: vi.fn() },
  interpolate: vi.fn(() => ({ authorizeUrl: 'https://provider.test/authorize' })),
  resolveAppSlug: vi.fn(),
  resolveAppConnection: vi.fn(),
  resolveOAuth2Client: vi.fn(() => ({ clientId: 'client_abc' })),
  resolveOwnClientRequirement: vi.fn(() => ({ requiresOwnClient: false, reason: null })),
}))

vi.mock('@auxx/config/urls', () => ({ WEBAPP_URL: 'http://localhost:3000' }))

vi.mock('@auxx/database', () => ({
  database: {
    query: {
      AppInstallation: { findFirst: db.appInstallation },
      ConnectionDefinition: { findFirst: db.connectionDefinition },
    },
  },
}))

vi.mock('@auxx/lib/apps', () => ({ resolveAppConnectionForRuntime: resolveAppConnection }))
vi.mock('@auxx/lib/cache', () => ({ resolveAppSlug }))
vi.mock('@auxx/lib/connections', () => ({ resolveOAuth2Client, resolveOwnClientRequirement }))

/**
 * The `@auxx/lib/permissions` barrel hangs under vitest, so it can't be partially mocked — but
 * `requirePermission` is re-implemented FAITHFULLY rather than stubbed: `integrationsManage`
 * carries no `featureKey` in the registry, so the real function's plan-gate branch is dead for
 * this key and these two lines ARE its whole body. The `PermissionKey` enum and the `assert`
 * that throws are both the real thing.
 */
vi.mock('@auxx/lib/permissions', async () => {
  const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
  return {
    PermissionKey,
    requirePermission: async (userId: string, orgId: string, key: never) => {
      const caps = await getCapabilities(userId, orgId)
      caps.assert(key)
    },
  }
})

vi.mock('@auxx/redis', () => ({ getRedisClient: async () => redis }))
vi.mock('@auxx/services/app-connections', () => ({ interpolateConnectionFields: interpolate }))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs under vitest.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const APP_ID = 'app_cuid000000000000000000000'
const INSTALL_ID = 'ins_cuid000000000000000000000'
const DEF_ID = 'cd_cuid0000000000000000000000'
const SLUG = 'acme'

/** A real `CapabilitySet` at the given `integrations` rung — Full is the only rung that key has. */
function capabilitiesAt(level: Level) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.integrations]: level })),
    {},
    'MEMBER',
    'full'
  )
}

function signedIn(level: Level) {
  getSession.mockResolvedValue({ user: { id: USER_ID, defaultOrganizationId: ORG_ID } })
  getCapabilities.mockResolvedValue(capabilitiesAt(level))
}

const params = { params: Promise.resolve({ slug: SLUG }) }

const request = (query: string) =>
  ({
    nextUrl: new URL(`http://localhost:3000/api/apps/${SLUG}/oauth2/authorize${query}`),
  }) as never

/** `?type=organization` with no picked method — the org-scoped connect. */
const orgConnect = () => request(`?installation=${INSTALL_ID}&type=organization`)
/** `?type=user` with no picked method — the caller's own connection. */
const userConnect = () => request(`?installation=${INSTALL_ID}&type=user`)

/** The single-method lookup constrains `cd.global` to the `type` param, so mirror that. */
function connectionDefinition(global: boolean) {
  return {
    id: DEF_ID,
    connectionType: 'oauth2-code',
    global,
    oauth2Features: {},
    oauth2Scopes: ['read'],
    oauth2AuthorizeUrl: 'https://provider.test/authorize',
    connectionVariables: [],
  }
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  redis.setex.mockClear()
  interpolate.mockClear()
  resolveAppConnection.mockReset()
  resolveAppSlug.mockReset().mockResolvedValue(APP_ID)
  resolveOwnClientRequirement
    .mockReset()
    .mockReturnValue({ requiresOwnClient: false, reason: null })
  resolveOAuth2Client.mockReset().mockReturnValue({ clientId: 'client_abc' })
  db.appInstallation.mockReset().mockResolvedValue({
    id: INSTALL_ID,
    appId: APP_ID,
    organizationId: ORG_ID,
    app: { title: 'Acme' },
  })
  // Default: the org-scoped method. Per-test overrides flip `global`.
  db.connectionDefinition.mockReset().mockResolvedValue(connectionDefinition(true))
})

describe('GET /api/apps/[slug]/oauth2/authorize — org-scoped connects', () => {
  it('401s without a session, before any capability read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('401s a session with no default organization', async () => {
    getSession.mockResolvedValue({ user: { id: USER_ID } })
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('400s without installation/type', async () => {
    signedIn(Level.Full)
    const res = await GET(request(''), params)
    expect(res.status).toBe(400)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('403s a member without `integrationsManage` (THE regression)', async () => {
    // Before this slice any authenticated member reached the redirect, and the callback then
    // wrote a credential with a null `userId` — an org-wide connection.
    signedIn(Level.None)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) })
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('403s a member at the `integrations` Read rung', async () => {
    signedIn(Level.Read)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(403)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('runs the gate BEFORE the state write and the redirect', async () => {
    signedIn(Level.None)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(403)
    expect(redis.setex).not.toHaveBeenCalled()
    expect(interpolate).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('asserts against the SESSION user and org', async () => {
    signedIn(Level.Full)
    await GET(orgConnect(), params)
    expect(getCapabilities).toHaveBeenCalledWith(USER_ID, ORG_ID)
  })

  it('lets an `integrationsManage` holder through to the provider redirect', async () => {
    signedIn(Level.Full)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('https://provider.test/authorize')
    expect(redis.setex).toHaveBeenCalledTimes(1)
    const [key, ttl, payload] = redis.setex.mock.calls[0]!
    expect(key).toMatch(/^oauth:app-connection:/)
    expect(ttl).toBe(600)
    // `global: true` here is precisely what makes the callback write `userId: null`.
    expect(JSON.parse(payload as string)).toMatchObject({
      userId: USER_ID,
      organizationId: ORG_ID,
      appId: APP_ID,
      global: true,
    })
  })
})

describe('GET /api/apps/[slug]/oauth2/authorize — the user-scoped carve-out', () => {
  it('lets a member WITHOUT `integrationsManage` connect their OWN account', async () => {
    // THE carve-out. Gating this would be a regression: a user-scoped connect writes the
    // credential under the caller's own `userId`, so it needs no org-level key
    // (`saveSecretConnection` only asserts when `isOrgScoped`).
    signedIn(Level.None)
    db.connectionDefinition.mockResolvedValue(connectionDefinition(false))
    const res = await GET(userConnect(), params)
    expect(res.status).toBe(307)
    expect(redis.setex).toHaveBeenCalledTimes(1)
    expect(JSON.parse(redis.setex.mock.calls[0]![2] as string)).toMatchObject({
      userId: USER_ID,
      global: false,
    })
    // The gate must not even be consulted for a user-scoped connect.
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('refuses that SAME member an org-scoped connect', async () => {
    signedIn(Level.None)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(403)
    expect(redis.setex).not.toHaveBeenCalled()
  })
})

describe('GET /api/apps/[slug]/oauth2/authorize — a picked method owns the scope', () => {
  const pickedConnect = (type: 'user' | 'organization') =>
    request(`?installation=${INSTALL_ID}&type=${type}&connectionDefinitionId=${DEF_ID}`)

  it('gates a `global` picked method even when the query says `type=user`', async () => {
    // Multi-method apps look the def up BY ID; the def's `global` — not the query param — is
    // what the callback turns into a null `userId`. Trusting the param here would hand the
    // caller an org credential for free.
    signedIn(Level.None)
    db.connectionDefinition.mockResolvedValue(connectionDefinition(true))
    const res = await GET(pickedConnect('user'), params)
    expect(res.status).toBe(403)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('does NOT gate a non-global picked method even when the query says `type=organization`', async () => {
    signedIn(Level.None)
    db.connectionDefinition.mockResolvedValue(connectionDefinition(false))
    const res = await GET(pickedConnect('organization'), params)
    expect(res.status).toBe(307)
    expect(redis.setex).toHaveBeenCalledTimes(1)
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('lets a holder through a `global` picked method', async () => {
    signedIn(Level.Full)
    db.connectionDefinition.mockResolvedValue(connectionDefinition(true))
    const res = await GET(pickedConnect('user'), params)
    expect(res.status).toBe(307)
    expect(redis.setex).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/apps/[slug]/oauth2/authorize — the gate did not replace the other checks', () => {
  it('404s an unknown app slug', async () => {
    signedIn(Level.Full)
    resolveAppSlug.mockResolvedValueOnce(null)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(404)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('404s an installation belonging to another org', async () => {
    signedIn(Level.Full)
    db.appInstallation.mockResolvedValueOnce(undefined)
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(404)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('400s a non-oauth2 connection definition', async () => {
    signedIn(Level.Full)
    db.connectionDefinition.mockResolvedValueOnce({
      ...connectionDefinition(true),
      connectionType: 'secret',
    })
    const res = await GET(orgConnect(), params)
    expect(res.status).toBe(400)
    expect(redis.setex).not.toHaveBeenCalled()
  })
})
