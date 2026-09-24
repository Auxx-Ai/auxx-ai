// packages/credentials/src/connections/__tests__/oauth2-token-url-guard.test.ts

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BlockedAddressError } from '@auxx/utils/net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/config/server', () => ({ WEBAPP_URL: 'https://app.example.com' }))
vi.mock('@auxx/credentials', () => ({
  CredentialTypeRegistry: class {},
  configService: { get: () => null },
}))
vi.mock('@auxx/workflow-nodes/server', () => ({ URLTemplateService: {} }))
vi.mock('../../store', () => ({
  recordRefreshFailure: async () => undefined,
  recordRefreshSuccess: async () => undefined,
  revealSecrets: async () => undefined,
  rotateSecrets: async () => undefined,
}))
vi.mock('@auxx/database', () => ({ database: { query: {} }, schema: {} }))

import { makeClientCredentialsRequest } from '../oauth2-token-grants'

let server: Server
let tokenUrl: string
let hits = 0

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"access_token":"t"}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  tokenUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/token`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

afterEach(() => {
  vi.unstubAllEnvs()
  hits = 0
})

describe('OAuth2 token request address guard', () => {
  it('refuses a private token URL in production without sending the client secret', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(
      makeClientCredentialsRequest(tokenUrl, 'client', 'secret', [], 'request-body')
    ).rejects.toBeInstanceOf(BlockedAddressError)
    expect(hits).toBe(0)
  })

  it('reaches an allowed token URL', async () => {
    const result = await makeClientCredentialsRequest(
      tokenUrl,
      'client',
      'secret',
      [],
      'basic-auth'
    )
    expect(result.access_token).toBe('t')
    expect(hits).toBe(1)
  })
})
