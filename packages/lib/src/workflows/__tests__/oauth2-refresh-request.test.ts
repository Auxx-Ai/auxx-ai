// packages/lib/src/workflows/__tests__/oauth2-refresh-request.test.ts
//
// Covers the MCP branch of `refreshCredentialTokens`: the RFC 8707 `resource` indicator on the
// refresh request, the conditional `client_secret` (DCR public clients have none), and the
// scanner-interval re-stamp from `expires_in`. Heavy deps are mocked wholesale; the token
// request itself is asserted via a fetch stub.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/config/server', () => ({ WEBAPP_URL: 'https://app.example.com' }))
vi.mock('@auxx/credentials', () => ({
  CredentialTypeRegistry: class {},
  configService: { get: () => null },
}))
vi.mock('@auxx/workflow-nodes/server', () => ({ URLTemplateService: {} }))
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}))

const storeCalls = {
  rotated: [] as Record<string, unknown>[],
  refreshSuccess: [] as { expiresAt: Date | null }[],
}
const storeState = {
  record: {} as Record<string, unknown>,
  secrets: {} as Record<string, unknown>,
}

vi.mock('@auxx/credentials/store', () => ({
  insertCredential: async () => ok({ id: 'cred-1' }),
  recordRefreshFailure: async () => ok(undefined),
  recordRefreshSuccess: async (_id: string, _org: string, opts: { expiresAt: Date | null }) => {
    storeCalls.refreshSuccess.push(opts)
    return ok(undefined)
  },
  revealSecrets: async () => ok({ record: storeState.record, secrets: storeState.secrets }),
  rotateSecrets: async (_id: string, _org: string, secrets: Record<string, unknown>) => {
    storeCalls.rotated.push(secrets)
    return ok(undefined)
  },
}))

const dbState = {
  connectionDefinition: null as Record<string, unknown> | null,
  mcpServer: null as { endpoint: string } | null,
  updates: [] as Record<string, unknown>[],
}

vi.mock('@auxx/database', () => ({
  database: {
    query: {
      ConnectionDefinition: { findFirst: async () => dbState.connectionDefinition },
      McpServer: { findFirst: async () => dbState.mcpServer },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          dbState.updates.push(values)
        },
      }),
    }),
  },
  schema: {
    ConnectionDefinition: {
      id: 'ConnectionDefinition.id',
      mcpServerId: 'cd.mcpServerId',
      appId: 'cd.appId',
      connectionType: 'cd.connectionType',
    },
    McpServer: { id: 'McpServer.id' },
  },
}))

const interpolated = {
  clientSecret: undefined as string | undefined,
  refreshUrl: '' as string,
}

vi.mock('@auxx/services/app-connections', () => ({
  interpolateConnectionFields: () => ({
    authorizeUrl: 'https://as.example.com/authorize',
    accessTokenUrl: 'https://as.example.com/token',
    refreshUrl: interpolated.refreshUrl,
    clientId: 'client-123',
    clientSecret: interpolated.clientSecret,
  }),
  mergeConnectionVariables: (
    metadata: { connectionVariables?: Record<string, string> } | null | undefined,
    secrets: { fields?: Record<string, string> } | null | undefined
  ) => ({ ...(metadata?.connectionVariables ?? {}), ...(secrets?.fields ?? {}) }),
}))

import { refreshCredentialTokens } from '../oauth2-workflow'

const fetchCalls: { url: string; body: URLSearchParams }[] = []

beforeEach(() => {
  fetchCalls.length = 0
  storeCalls.rotated.length = 0
  storeCalls.refreshSuccess.length = 0
  dbState.updates.length = 0
  interpolated.clientSecret = undefined
  interpolated.refreshUrl = ''
  storeState.record = {
    id: 'cred-1',
    kind: 'mcp',
    mcpServerId: 'srv-1',
    metadata: {},
    consecutiveRefreshFailures: 0,
  }
  storeState.secrets = { accessToken: 'old-token', refreshToken: 'refresh-1' }
  dbState.connectionDefinition = {
    id: 'def-1',
    oauth2AccessTokenUrl: 'https://as.example.com/token',
    oauth2TokenRequestAuthMethod: null,
    oauth2RefreshTokenIntervalSeconds: null,
  }
  dbState.mcpServer = { endpoint: 'https://mcp.stripe.com' }

  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    fetchCalls.push({ url, body: new URLSearchParams(init.body) })
    return {
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      }),
    }
  })
})

describe('refreshCredentialTokens (mcp)', () => {
  it('sends the RFC 8707 resource indicator and omits client_secret for public clients', async () => {
    const result = await refreshCredentialTokens('cred-1', 'org-1')

    expect(result.success).toBe(true)
    const body = fetchCalls[0]?.body
    expect(body?.get('grant_type')).toBe('refresh_token')
    expect(body?.get('refresh_token')).toBe('refresh-1')
    expect(body?.get('client_id')).toBe('client-123')
    expect(body?.get('resource')).toBe('https://mcp.stripe.com')
    expect(body?.has('client_secret')).toBe(false)
  })

  it('includes client_secret when the definition has one', async () => {
    interpolated.clientSecret = 'shh'
    await refreshCredentialTokens('cred-1', 'org-1')
    expect(fetchCalls[0]?.body.get('client_secret')).toBe('shh')
  })

  it('rotates secrets and re-stamps the scanner interval from expires_in', async () => {
    const result = await refreshCredentialTokens('cred-1', 'org-1')

    expect(result.success).toBe(true)
    expect(storeCalls.rotated[0]).toMatchObject({
      accessToken: 'new-token',
      refreshToken: 'refresh-2',
    })
    expect(storeCalls.refreshSuccess[0]?.expiresAt).toBeInstanceOf(Date)
    expect(dbState.updates).toEqual([{ oauth2RefreshTokenIntervalSeconds: 3600 }])
  })

  it('skips the interval update when it already matches', async () => {
    dbState.connectionDefinition = {
      ...dbState.connectionDefinition!,
      oauth2RefreshTokenIntervalSeconds: 3600,
    }
    await refreshCredentialTokens('cred-1', 'org-1')
    expect(dbState.updates).toHaveLength(0)
  })

  it('does not send a resource indicator for app credentials', async () => {
    storeState.record = {
      id: 'cred-1',
      kind: 'app',
      appId: 'app-1',
      metadata: {},
      consecutiveRefreshFailures: 0,
    }
    await refreshCredentialTokens('cred-1', 'org-1')
    expect(fetchCalls[0]?.body.has('resource')).toBe(false)
    expect(dbState.updates).toHaveLength(0)
  })

  it('refreshes against the dedicated refresh URL when one is configured', async () => {
    interpolated.refreshUrl = 'https://as.example.com/refresh'
    await refreshCredentialTokens('cred-1', 'org-1')
    expect(fetchCalls[0]?.url).toBe('https://as.example.com/refresh')
  })

  it('falls back to the access-token URL when no refresh URL is set', async () => {
    interpolated.refreshUrl = ''
    await refreshCredentialTokens('cred-1', 'org-1')
    expect(fetchCalls[0]?.url).toBe('https://as.example.com/token')
  })
})
