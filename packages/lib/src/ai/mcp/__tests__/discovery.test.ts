// packages/lib/src/ai/mcp/__tests__/discovery.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpAuthError } from '../errors'

/** Set per-test to control the no-auth probe (`withMcpSession`). */
const stubs = {
  probeImpl: undefined as undefined | (() => unknown),
}

vi.mock('../client', () => ({
  withMcpSession: async () => {
    if (stubs.probeImpl) return stubs.probeImpl()
    return [] // probe succeeds → server needs no auth
  },
}))

import { discoverMcpAuth, registerDcrClient } from '../discovery'

/** Minimal fetch Response stub. */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const ENDPOINT = 'https://server.example.com/mcp'
const PRM = { authorization_servers: ['https://as.example.com'] }
const AS_META = {
  authorization_endpoint: 'https://as.example.com/authorize',
  token_endpoint: 'https://as.example.com/token',
  registration_endpoint: 'https://as.example.com/register',
  scopes_supported: ['read', 'write'],
}

beforeEach(() => {
  stubs.probeImpl = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('discoverMcpAuth', () => {
  it('returns { kind: "none" } when the probe succeeds without auth', async () => {
    const result = await discoverMcpAuth(ENDPOINT)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ kind: 'none' })
  })

  it('returns PROBE_FAILED on a non-auth probe error', async () => {
    stubs.probeImpl = () => {
      throw new Error('connection refused')
    }
    const result = await discoverMcpAuth(ENDPOINT)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('PROBE_FAILED')
  })

  it('discovers OAuth via the RFC 9728 resource_metadata directive (+ RFC 8414 AS metadata)', async () => {
    stubs.probeImpl = () => {
      throw new McpAuthError('401', {
        status: 401,
        wwwAuthenticate:
          'Bearer realm="mcp", resource_metadata="https://server.example.com/.well-known/oauth-protected-resource"',
      })
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth-protected-resource')) return jsonResponse(PRM)
      if (url.includes('oauth-authorization-server') || url.includes('openid-configuration')) {
        return jsonResponse(AS_META)
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverMcpAuth(ENDPOINT)
    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value).toMatchObject({
      kind: 'oauth',
      authorizationServer: 'https://as.example.com',
      authorizeUrl: AS_META.authorization_endpoint,
      tokenUrl: AS_META.token_endpoint,
      registrationEndpoint: AS_META.registration_endpoint,
      scopesSupported: ['read', 'write'],
      resource: ENDPOINT,
    })
    // The first metadata fetch must hit the URL advertised in the header.
    expect(fetchMock.mock.calls[0]?.[0]).toContain('oauth-protected-resource')
  })

  it('falls back to the well-known protected-resource path when no header directive is present', async () => {
    stubs.probeImpl = () => {
      throw new McpAuthError('401', { status: 401, wwwAuthenticate: undefined })
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth-protected-resource')) return jsonResponse(PRM)
      if (url.includes('oauth-authorization-server')) return jsonResponse(AS_META)
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverMcpAuth(ENDPOINT)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ kind: 'oauth' })
    // Derived from <origin>/.well-known/oauth-protected-resource<path>.
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://server.example.com/.well-known/oauth-protected-resource/mcp'
    )
  })

  it('returns METADATA_NOT_FOUND when no authorization server is advertised', async () => {
    stubs.probeImpl = () => {
      throw new McpAuthError('401', { status: 401 })
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('oauth-protected-resource') ? jsonResponse({}) : jsonResponse({}, false)
      )
    )

    const result = await discoverMcpAuth(ENDPOINT)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('METADATA_NOT_FOUND')
  })

  it('returns METADATA_FETCH_FAILED when AS metadata lacks endpoints', async () => {
    stubs.probeImpl = () => {
      throw new McpAuthError('401', { status: 401 })
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('oauth-protected-resource')) return jsonResponse(PRM)
        if (url.includes('oauth-authorization-server')) return jsonResponse({ issuer: 'x' })
        return jsonResponse({}, false)
      })
    )

    const result = await discoverMcpAuth(ENDPOINT)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('METADATA_FETCH_FAILED')
  })
})

describe('registerDcrClient', () => {
  const OPTS = {
    registrationEndpoint: 'https://as.example.com/register',
    redirectUri: 'https://app.example.com/api/mcp/srv-1/oauth2/callback',
    serverName: 'Example',
  }

  it('registers a confidential client (client_id + client_secret)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ client_id: 'cid-123', client_secret: 'secret-abc' }))
    )
    const result = await registerDcrClient(OPTS)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({
      clientId: 'cid-123',
      clientSecret: 'secret-abc',
    })
  })

  it('registers a public client (no client_secret) — PKCE covers it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ client_id: 'public-cid' }))
    )
    const result = await registerDcrClient(OPTS)
    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.clientId).toBe('public-cid')
    expect(value.clientSecret).toBeUndefined()
  })

  it('fails when the registration endpoint returns a non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid' }, false))
    )
    const result = await registerDcrClient(OPTS)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('DCR_FAILED')
  })

  it('fails when the response is missing client_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ client_secret: 'orphan' }))
    )
    const result = await registerDcrClient(OPTS)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('DCR_FAILED')
  })
})
