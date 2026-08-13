// packages/credentials/src/connections/__tests__/client-credentials-request.test.ts
//
// Covers `makeClientCredentialsRequest`: the `grant_type=client_credentials` body, scope joining,
// `request-body` vs `basic-auth` client authentication, and non-2xx error surfacing. The heavy
// module graph oauth2-token-grants pulls in is mocked wholesale (mirrors oauth2-refresh-request);
// the request itself is asserted via a fetch stub.

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
vi.mock('../../store', () => ({
  recordRefreshFailure: async () => undefined,
  recordRefreshSuccess: async () => undefined,
  revealSecrets: async () => undefined,
  rotateSecrets: async () => undefined,
}))
vi.mock('@auxx/database', () => ({ database: { query: {} }, schema: {} }))
vi.mock('../interpolate-connection', () => ({
  interpolateConnectionFields: () => ({}),
  mergeConnectionVariables: () => ({}),
}))

import { makeClientCredentialsRequest } from '../oauth2-token-grants'

const fetchCalls: { url: string; headers: Record<string, string>; body: URLSearchParams }[] = []

function stubFetch(ok: boolean, payload: unknown) {
  vi.stubGlobal(
    'fetch',
    async (url: string, init: { headers: Record<string, string>; body: string }) => {
      fetchCalls.push({ url, headers: init.headers, body: new URLSearchParams(init.body) })
      return {
        ok,
        status: ok ? 200 : 401,
        json: async () => payload,
        text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
      }
    }
  )
}

beforeEach(() => {
  fetchCalls.length = 0
  stubFetch(true, { access_token: 'minted-token', expires_in: 3600 })
})

describe('makeClientCredentialsRequest', () => {
  it('posts grant_type=client_credentials with joined scope (request-body auth)', async () => {
    const result = await makeClientCredentialsRequest(
      'https://as.example.com/token',
      'client-123',
      'secret-xyz',
      ['scope.a', 'scope.b'],
      'request-body'
    )

    expect(result.access_token).toBe('minted-token')
    const call = fetchCalls[0]
    expect(call?.url).toBe('https://as.example.com/token')
    expect(call?.body.get('grant_type')).toBe('client_credentials')
    expect(call?.body.get('scope')).toBe('scope.a scope.b')
    expect(call?.body.get('client_id')).toBe('client-123')
    expect(call?.body.get('client_secret')).toBe('secret-xyz')
    expect(call?.headers.Authorization).toBeUndefined()
  })

  it('omits the scope param entirely when no scopes are configured', async () => {
    await makeClientCredentialsRequest('https://as.example.com/token', 'c', 's', [], 'request-body')
    expect(fetchCalls[0]?.body.has('scope')).toBe(false)
  })

  it('puts id/secret in the Authorization header and omits them from the body (basic-auth)', async () => {
    await makeClientCredentialsRequest(
      'https://as.example.com/token',
      'client-123',
      'secret-xyz',
      ['scope.a'],
      'basic-auth'
    )

    const call = fetchCalls[0]
    const expected = Buffer.from('client-123:secret-xyz').toString('base64')
    expect(call?.headers.Authorization).toBe(`Basic ${expected}`)
    expect(call?.body.has('client_id')).toBe(false)
    expect(call?.body.has('client_secret')).toBe(false)
    expect(call?.body.get('grant_type')).toBe('client_credentials')
  })

  it('omits client_secret from the body when none is supplied (request-body)', async () => {
    await makeClientCredentialsRequest(
      'https://as.example.com/token',
      'c',
      undefined,
      [],
      'request-body'
    )
    expect(fetchCalls[0]?.body.has('client_secret')).toBe(false)
  })

  it('throws with the response body text on a non-2xx response', async () => {
    stubFetch(false, 'invalid_client')
    await expect(
      makeClientCredentialsRequest('https://as.example.com/token', 'c', 's', [], 'request-body')
    ).rejects.toThrow(/Client credentials grant failed: 401 invalid_client/)
  })
})
