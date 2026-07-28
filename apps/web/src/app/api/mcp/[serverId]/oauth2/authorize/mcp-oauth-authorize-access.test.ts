// apps/web/src/app/api/mcp/[serverId]/oauth2/authorize/mcp-oauth-authorize-access.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **The live privilege hole this slice closed.**
 *
 * This REST authorize route authenticated with `auth.api.getSession` alone and read NO
 * capabilities, while every mutating tRPC sibling (`mcp.create` / `connect` / `update` /
 * `delete`) sits behind `mcpAdminProcedure` = `permissionProcedure(integrationsManage)`.
 * The route mints Redis OAuth state and redirects; its callback then calls
 * `saveMcpConnection` with the `organizationId` taken straight out of that state, writing an
 * **org-level** MCP credential. `mcp.list` is a bare `protectedProcedure`, so any member could
 * enumerate every `serverId` first.
 *
 * Behavioral: the REAL handler is invoked and a REAL `CapabilitySet` (built from
 * `expandLevelsToKeys`) answers the assert. The Redis `setex` — the state write that makes the
 * callback's credential write reachable — is the observed side effect.
 */

const { getCapabilities, getSession, redis, db, interpolate, resolveMcpConnection } = vi.hoisted(
  () => ({
    getCapabilities: vi.fn(),
    getSession: vi.fn(),
    redis: { setex: vi.fn(async () => 'OK') },
    db: {
      mcpServer: vi.fn(),
      connectionDefinition: vi.fn(),
    },
    interpolate: vi.fn(() => ({
      authorizeUrl: 'https://provider.test/authorize',
      clientId: 'client_abc',
    })),
    resolveMcpConnection: vi.fn(),
  })
)

vi.mock('@auxx/config/urls', () => ({ WEBAPP_URL: 'http://localhost:3000' }))

vi.mock('@auxx/database', () => ({
  database: {
    query: {
      McpServer: { findFirst: db.mcpServer },
      ConnectionDefinition: { findFirst: db.connectionDefinition },
    },
  },
}))

vi.mock('@auxx/lib/ai/mcp', () => ({ resolveMcpConnectionForRuntime: resolveMcpConnection }))

/**
 * The `@auxx/lib/permissions` barrel hangs under vitest (get-capabilities, record-view-scope,
 * overage-*), so it can't be partially mocked — but `requirePermission` is re-implemented here
 * FAITHFULLY rather than stubbed: `integrationsManage` carries no `featureKey` in the registry,
 * so the real function's plan-gate branch is dead for this key and these two lines ARE its whole
 * body. The `PermissionKey` enum and the `assert` that throws are both the real thing.
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
const SERVER_ID = 'mcp_cuid00000000000000000000'

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

const params = { params: Promise.resolve({ serverId: SERVER_ID }) }

const request = (query = '') =>
  ({
    nextUrl: new URL(`http://localhost:3000/api/mcp/${SERVER_ID}/oauth2/authorize${query}`),
  }) as never

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  redis.setex.mockClear()
  interpolate.mockClear()
  resolveMcpConnection.mockReset()
  db.mcpServer.mockReset().mockResolvedValue({
    id: SERVER_ID,
    organizationId: ORG_ID,
    name: 'Acme MCP',
    endpoint: 'https://acme.test/mcp',
  })
  db.connectionDefinition.mockReset().mockResolvedValue({
    id: 'cd_cuid0000000000000000000000',
    connectionType: 'oauth2-code',
    oauth2Features: {},
    oauth2Scopes: ['read'],
    connectionVariables: [],
  })
})

describe('GET /api/mcp/[serverId]/oauth2/authorize — the org-credential hole', () => {
  it('401s without a session, before any capability read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('401s a session with no default organization', async () => {
    getSession.mockResolvedValue({ user: { id: USER_ID } })
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('403s a member without `integrationsManage` (THE regression)', async () => {
    // Before this slice any authenticated member reached the redirect, and the callback
    // then wrote an org-level MCP credential on their behalf.
    signedIn(Level.None)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) })
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('403s a member at the `integrations` Read rung', async () => {
    // `integrations` exposes the key only at Full — Read must not be enough.
    signedIn(Level.Read)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('runs the gate BEFORE the server lookup, the state write and the redirect', async () => {
    signedIn(Level.None)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    // No enumeration oracle either: a refused caller never learns whether the server exists.
    expect(db.mcpServer).not.toHaveBeenCalled()
    expect(db.connectionDefinition).not.toHaveBeenCalled()
    expect(redis.setex).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('asserts against the SESSION user and org', async () => {
    signedIn(Level.Full)
    await GET(request(), params)
    expect(getCapabilities).toHaveBeenCalledWith(USER_ID, ORG_ID)
  })

  it('lets an `integrationsManage` holder through to the provider redirect', async () => {
    signedIn(Level.Full)
    const res = await GET(request(), params)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('https://provider.test/authorize')
    expect(redis.setex).toHaveBeenCalledTimes(1)
    const [key, ttl, payload] = redis.setex.mock.calls[0]!
    expect(key).toMatch(/^oauth:mcp-connection:/)
    expect(ttl).toBe(600)
    expect(JSON.parse(payload as string)).toMatchObject({
      userId: USER_ID,
      organizationId: ORG_ID,
      mcpServerId: SERVER_ID,
    })
  })

  it('still 404s an unknown server for a holder (the gate did not replace the lookup)', async () => {
    signedIn(Level.Full)
    db.mcpServer.mockResolvedValueOnce(undefined)
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('still 404s another org’s server for a holder', async () => {
    signedIn(Level.Full)
    db.mcpServer.mockResolvedValueOnce({
      id: SERVER_ID,
      organizationId: 'org_someoneelse000000000000',
      name: 'Theirs',
      endpoint: 'https://theirs.test/mcp',
    })
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    expect(redis.setex).not.toHaveBeenCalled()
  })
})
