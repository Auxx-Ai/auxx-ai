// packages/lib/src/ai/mcp/__tests__/manage.test.ts
//
// Orchestration-level tests for the connect surface: the OAuth/DCR fork in createCustomMcpServer,
// curated `none`-auth servers that carry connection variables (Shopify), and lazy discovery for
// curated OAuth servers (Linear/Notion).

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Configurable DB state + recorded writes. */
const state = {
  servers: [] as Array<Record<string, unknown>>,
  connectionDef: undefined as undefined | Record<string, unknown>,
  installation: undefined as undefined | { id: string },
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ and: a }),
  or: (...a: unknown[]) => ({ or: a }),
  eq: (...a: unknown[]) => ({ eq: a }),
  isNull: (...a: unknown[]) => ({ isNull: a }),
}))

vi.mock('@auxx/database', () => {
  const tableName = (t: unknown) => (t as { _name?: string })?._name ?? 'unknown'
  return {
    schema: {
      McpServer: { _name: 'McpServer' },
      ConnectionDefinition: { _name: 'ConnectionDefinition' },
      McpInstallation: { _name: 'McpInstallation' },
    },
    database: {
      query: {
        McpServer: {
          findMany: async () => state.servers.map((s) => ({ slug: s.slug })),
          findFirst: async () => state.servers[0],
        },
        ConnectionDefinition: { findFirst: async () => state.connectionDef },
        McpInstallation: { findFirst: async () => state.installation },
      },
      insert: (table: unknown) => ({
        // Awaitable (for `await ...values(v)`) with a `.returning()` for the McpServer insert.
        values: (values: Record<string, unknown>) => {
          state.inserts.push({ table: tableName(table), values })
          const promise = Promise.resolve(undefined) as Promise<undefined> & {
            returning: () => Promise<Array<{ id: string }>>
          }
          promise.returning = async () => [{ id: 'srv-new' }]
          return promise
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          state.updates.push({ table: tableName(table), values })
          return { where: async () => undefined }
        },
      }),
    },
  }
})

const discoverMcpAuth = vi.fn()
const registerDcrClient = vi.fn()
vi.mock('../discovery', () => ({
  discoverMcpAuth: (...a: unknown[]) => discoverMcpAuth(...a),
  registerDcrClient: (...a: unknown[]) => registerDcrClient(...a),
}))

const saveMcpConnection = vi.fn(async () => {
  const { ok } = await import('neverthrow')
  return ok('cred-1')
})
const deleteMcpConnection = vi.fn(async () => undefined)
vi.mock('../connections', () => ({
  saveMcpConnection: (...a: unknown[]) => saveMcpConnection(...a),
  deleteMcpConnection: (...a: unknown[]) => deleteMcpConnection(...a),
}))

const syncMcpTools = vi.fn(async () => ({ ok: true, toolCount: 1 }))
vi.mock('../sync', () => ({ syncMcpTools: (...a: unknown[]) => syncMcpTools(...a) }))

const ensureCuratedMcpServer = vi.fn(async () => ({ serverId: 'srv-curated' }))
vi.mock('../templates/ensure', () => ({
  ensureCuratedMcpServer: (...a: unknown[]) => ensureCuratedMcpServer(...a),
}))

vi.mock('../../../cache/invalidate', () => ({ onCacheEvent: async () => undefined }))

vi.mock('@auxx/credentials/store', async () => {
  const { ok } = await import('neverthrow')
  return { findCredential: async () => ok(null) }
})

import { decryptValue, HIDDEN_VALUE, isV2Payload } from '@auxx/credentials/crypto'
import { ok } from 'neverthrow'
import {
  connectCuratedMcpServer,
  connectMcpTemplate,
  createCustomMcpServer,
  updateMcpServer,
} from '../manage'

/** Decrypt a recorded write value (client creds are persisted as v2 ciphertext). */
function decryptWrite(value: unknown): string | null {
  return decryptValue((value as string | undefined) ?? null)
}

const OAUTH_DISCOVERY = ok({
  kind: 'oauth' as const,
  authorizationServer: 'https://as.example.com',
  authorizeUrl: 'https://as.example.com/authorize',
  tokenUrl: 'https://as.example.com/token',
  registrationEndpoint: 'https://as.example.com/register',
  scopesSupported: ['read'],
  resource: 'https://server.example.com/mcp',
})

beforeEach(() => {
  vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'a'.repeat(64))
  state.servers = []
  state.connectionDef = undefined
  state.installation = undefined
  state.inserts = []
  state.updates = []
  discoverMcpAuth.mockReset()
  registerDcrClient.mockReset()
  saveMcpConnection.mockClear()
  syncMcpTools.mockClear()
  ensureCuratedMcpServer.mockClear()
})

describe('createCustomMcpServer (auth: auto → oauth)', () => {
  it('discovers OAuth, mints a DCR client, and returns needsOAuth', async () => {
    discoverMcpAuth.mockResolvedValue(OAUTH_DISCOVERY)
    registerDcrClient.mockResolvedValue(ok({ clientId: 'dcr-cid' }))

    const result = await createCustomMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      name: 'My Server',
      endpoint: 'https://server.example.com/mcp',
      auth: 'auto',
    })

    expect(result).toMatchObject({ needsOAuth: true, serverId: 'srv-new', slug: 'my-server' })
    if ('authorizeUrl' in result) {
      expect(result.authorizeUrl).toBe('/api/mcp/srv-new/oauth2/authorize')
    }
    // DCR-minted client id persisted onto the connection definition (encrypted).
    const clientUpdate = state.updates.find(
      (u) => decryptWrite(u.values.oauth2ClientId) === 'dcr-cid'
    )
    expect(clientUpdate).toBeDefined()
    expect(isV2Payload(clientUpdate?.values.oauth2ClientId as string)).toBe(true)
    expect(syncMcpTools).not.toHaveBeenCalled()
  })

  it('returns needsClientCredentials when DCR fails', async () => {
    discoverMcpAuth.mockResolvedValue(OAUTH_DISCOVERY)
    registerDcrClient.mockResolvedValue(
      (await import('neverthrow')).err({ code: 'DCR_FAILED', message: 'nope' })
    )

    const result = await createCustomMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      name: 'My Server',
      endpoint: 'https://server.example.com/mcp',
      auth: 'auto',
    })
    expect(result).toMatchObject({ needsClientCredentials: true })
  })
})

describe('createCustomMcpServer (explicit auth modes)', () => {
  it('oauth with manual authorize/token URLs skips discovery entirely', async () => {
    const result = await createCustomMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      name: 'Manual OAuth',
      endpoint: 'https://server.example.com/mcp',
      auth: 'oauth',
      oauth: {
        clientId: 'pasted-cid',
        clientSecret: 'pasted-secret',
        authorizeUrl: 'https://as.example.com/authorize',
        tokenUrl: 'https://as.example.com/token',
        scopes: ['read', 'write'],
      },
    })

    expect(discoverMcpAuth).not.toHaveBeenCalled()
    expect(result).toMatchObject({ needsOAuth: true })
    const defInsert = state.inserts.find((i) => i.table === 'ConnectionDefinition')
    expect(defInsert?.values).toMatchObject({
      connectionType: 'oauth2-code',
      oauth2AuthorizeUrl: 'https://as.example.com/authorize',
      oauth2AccessTokenUrl: 'https://as.example.com/token',
      oauth2Scopes: ['read', 'write'],
    })
    // Pasted creds are persisted as v2 ciphertext, never plaintext.
    expect(isV2Payload(defInsert?.values.oauth2ClientId as string)).toBe(true)
    expect(isV2Payload(defInsert?.values.oauth2ClientSecret as string)).toBe(true)
    expect(decryptWrite(defInsert?.values.oauth2ClientId)).toBe('pasted-cid')
    expect(decryptWrite(defInsert?.values.oauth2ClientSecret)).toBe('pasted-secret')
  })

  it('oauth without overrides throws when discovery finds no OAuth metadata', async () => {
    discoverMcpAuth.mockResolvedValue(
      (await import('neverthrow')).err({ code: 'DISCOVERY_FAILED', message: 'no metadata' })
    )

    await expect(
      createCustomMcpServer({
        organizationId: 'org-1',
        createdById: 'user-1',
        name: 'Broken OAuth',
        endpoint: 'https://server.example.com/mcp',
        auth: 'oauth',
        oauth: { clientId: 'cid' },
      })
    ).rejects.toThrow(/OAuth discovery failed/)
  })

  it('headers mode stores the header map as secrets and the names in metadata', async () => {
    const result = await createCustomMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      name: 'Header Server',
      endpoint: 'https://server.example.com/mcp',
      auth: 'headers',
      headers: [
        { name: 'X-API-Key', value: 'secret-1' },
        { name: 'X-Api-Version', value: '2026-01' },
      ],
    })

    expect(result).toMatchObject({ connected: true })
    const defInsert = state.inserts.find((i) => i.table === 'ConnectionDefinition')
    expect(defInsert?.values).toMatchObject({ connectionType: 'secret' })
    expect(saveMcpConnection).toHaveBeenCalledTimes(1)
    const arg = saveMcpConnection.mock.calls[0]![0] as {
      connectionData: { headers?: Record<string, string>; metadata?: { headerNames?: string[] } }
    }
    expect(arg.connectionData.headers).toEqual({
      'X-API-Key': 'secret-1',
      'X-Api-Version': '2026-01',
    })
    expect(arg.connectionData.metadata?.headerNames).toEqual(['X-API-Key', 'X-Api-Version'])
    expect(syncMcpTools).toHaveBeenCalled()
  })
})

describe('masked-prefill echoes are never persisted', () => {
  const oauthEcho = (clientSecret: string) => ({
    clientId: 'cid-1',
    clientSecret,
    authorizeUrl: 'https://as.example.com/authorize',
    tokenUrl: 'https://as.example.com/token',
  })

  it.each([
    HIDDEN_VALUE,
    'past****cret',
    '********',
  ])('createCustomMcpServer on an existing server drops %s from the definition update', async (echo) => {
    state.servers = [{ id: 'srv-1', slug: 'my-server' }]

    await createCustomMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      name: 'My Server',
      endpoint: 'https://server.example.com/mcp',
      auth: 'oauth',
      oauth: oauthEcho(echo),
    })

    const defUpdate = state.updates.find((u) => u.table === 'ConnectionDefinition')
    expect(defUpdate).toBeDefined()
    expect(decryptWrite(defUpdate?.values.oauth2ClientId)).toBe('cid-1')
    expect(defUpdate?.values).not.toHaveProperty('oauth2ClientSecret')
  })

  it.each([
    HIDDEN_VALUE,
    'past****cret',
  ])('updateMcpServer (oauth) drops %s from the definition update', async (echo) => {
    await updateMcpServer({
      organizationId: 'org-1',
      serverId: 'srv-1',
      auth: 'oauth',
      oauth: { clientSecret: echo },
    })

    const defUpdate = state.updates.find((u) => u.table === 'ConnectionDefinition')
    expect(defUpdate).toBeDefined()
    expect(defUpdate?.values).toMatchObject({ connectionType: 'oauth2-code' })
    expect(defUpdate?.values).not.toHaveProperty('oauth2ClientSecret')
  })

  it('updateMcpServer (oauth) still persists a real replacement secret', async () => {
    await updateMcpServer({
      organizationId: 'org-1',
      serverId: 'srv-1',
      auth: 'oauth',
      oauth: { clientSecret: 'brand-new-real-secret' },
    })

    const defUpdate = state.updates.find((u) => u.table === 'ConnectionDefinition')
    expect(decryptWrite(defUpdate?.values.oauth2ClientSecret)).toBe('brand-new-real-secret')
  })

  it('createCustomMcpServer rejects a mask echo for a brand-new server', async () => {
    await expect(
      createCustomMcpServer({
        organizationId: 'org-1',
        createdById: 'user-1',
        name: 'New Server',
        endpoint: 'https://server.example.com/mcp',
        auth: 'oauth',
        oauth: oauthEcho(HIDDEN_VALUE),
      })
    ).rejects.toThrow(/masked placeholder/)
    expect(state.inserts).toHaveLength(0)
  })
})

describe('connectMcpTemplate', () => {
  it('throws on an unknown template id', async () => {
    await expect(
      connectMcpTemplate({
        organizationId: 'org-1',
        createdById: 'user-1',
        templateId: 'not-a-template',
      })
    ).rejects.toThrow(/Unknown MCP template/)
    expect(ensureCuratedMcpServer).not.toHaveBeenCalled()
  })

  it('upserts the curated row from the catalog, then runs the curated connect flow', async () => {
    // `shopify` is a none-auth template; the curated row + def come from the upsert.
    ensureCuratedMcpServer.mockResolvedValue({ serverId: 'srv-curated' })
    state.servers = [
      {
        id: 'srv-curated',
        name: 'Shopify Storefront',
        endpoint: 'https://{shop}.myshopify.com/api/mcp',
        authDiscovery: null,
      },
    ]
    state.connectionDef = { connectionType: 'none', oauth2ClientId: null }

    const result = await connectMcpTemplate({
      organizationId: 'org-1',
      createdById: 'user-1',
      templateId: 'shopify',
      connectionVariables: { shop: 'my-store' },
    })

    expect(result).toMatchObject({ connected: true, serverId: 'srv-curated', slug: 'shopify' })
    const ensureArg = ensureCuratedMcpServer.mock.calls[0]![0] as { id: string }
    expect(ensureArg.id).toBe('shopify')
    expect(saveMcpConnection).toHaveBeenCalledTimes(1)
  })
})

describe('connectCuratedMcpServer', () => {
  it('persists connection variables for a none-auth curated server (Shopify)', async () => {
    state.servers = [
      {
        id: 'shopify',
        name: 'Shopify Storefront',
        endpoint: 'https://{shop}.myshopify.com/api/mcp',
        authDiscovery: null,
      },
    ]
    state.connectionDef = { connectionType: 'none', oauth2ClientId: null }

    const result = await connectCuratedMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      serverId: 'shopify',
      connectionVariables: { shop: 'my-store' },
    })

    expect(result).toEqual({ connected: true })
    expect(saveMcpConnection).toHaveBeenCalledTimes(1)
    const arg = saveMcpConnection.mock.calls[0]![0] as {
      connectionData: { metadata?: { connectionVariables?: Record<string, string> } }
    }
    expect(arg.connectionData.metadata?.connectionVariables).toEqual({ shop: 'my-store' })
    expect(syncMcpTools).toHaveBeenCalled()
  })

  it('lazily discovers + provisions a curated OAuth server, then mints a DCR client', async () => {
    state.servers = [
      { id: 'linear', name: 'Linear', endpoint: 'https://mcp.linear.app/mcp', authDiscovery: null },
    ]
    // Curated def starts without authorize/token URLs (filled at connect time).
    state.connectionDef = {
      connectionType: 'oauth2-code',
      oauth2ClientId: null,
      oauth2AuthorizeUrl: null,
      oauth2AccessTokenUrl: null,
    }
    discoverMcpAuth.mockResolvedValue(OAUTH_DISCOVERY)
    registerDcrClient.mockResolvedValue(ok({ clientId: 'linear-cid' }))

    const result = await connectCuratedMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      serverId: 'linear',
    })

    expect(result).toMatchObject({ needsOAuth: true })
    expect(discoverMcpAuth).toHaveBeenCalledWith('https://mcp.linear.app/mcp')
    // Discovered authorize URL persisted onto the definition.
    const urlUpdate = state.updates.find(
      (u) => u.values.oauth2AuthorizeUrl === 'https://as.example.com/authorize'
    )
    expect(urlUpdate).toBeDefined()
    // DCR client persisted too (encrypted).
    expect(state.updates.some((u) => decryptWrite(u.values.oauth2ClientId) === 'linear-cid')).toBe(
      true
    )
  })

  it('skips DCR when the curated OAuth def already has a client id', async () => {
    state.servers = [
      {
        id: 'linear',
        name: 'Linear',
        endpoint: 'https://mcp.linear.app/mcp',
        authDiscovery: { registrationEndpoint: 'https://x/register' },
      },
    ]
    state.connectionDef = {
      connectionType: 'oauth2-code',
      oauth2ClientId: 'existing-cid',
      oauth2AuthorizeUrl: 'https://as.example.com/authorize',
      oauth2AccessTokenUrl: 'https://as.example.com/token',
    }

    const result = await connectCuratedMcpServer({
      organizationId: 'org-1',
      createdById: 'user-1',
      serverId: 'linear',
    })

    expect(result).toMatchObject({ needsOAuth: true })
    expect(discoverMcpAuth).not.toHaveBeenCalled()
    expect(registerDcrClient).not.toHaveBeenCalled()
  })
})
