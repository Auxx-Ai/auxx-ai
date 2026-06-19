// packages/lib/src/data-connectors/connectors/generic-rest.test.ts
// The generic-REST connector applies the resolved connection's declarative
// `authApply` spec (header / basic / query) to each request, instead of the old
// hand-rolled Bearer header (unify-connection-definition §3, Phase 8).

import type { AuthApply } from '@auxx/database'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { genericRestConnector } from './generic-rest'
import type { ConnectorFetchArgs } from './types'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  // One non-paginated JSON page, then stop (no next token).
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => ({ data: [] }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function args(
  over: { authApply?: AuthApply | null; value?: string; fields?: Record<string, string> } & {
    auth?: 'credential' | 'none'
  } = {}
): ConnectorFetchArgs {
  const { auth = 'credential', authApply = null, value = 'tok', fields } = over
  return {
    streamKey: 's1',
    mode: 'snapshot',
    state: {},
    credential: { id: 'c1', type: 'secret', value, fields, authApply },
    config: { endpoint: { baseUrl: 'https://api.example.com', auth } },
    requestConfig: { path: 'orders' },
  }
}

/** Drive the lazy iterable to completion so the request fires. */
async function drain(a: ConnectorFetchArgs): Promise<void> {
  const { records } = await genericRestConnector.fetch(a)
  for await (const _ of records) {
    // exhaust
  }
}

describe('genericRestConnector — applyAuth', () => {
  it('applies a Bearer header from the authApply spec', async () => {
    await drain(
      args({ authApply: { in: 'header', name: 'Authorization', format: 'Bearer {value}' } })
    )

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('applies a query-param auth onto the request URL', async () => {
    await drain(args({ authApply: { in: 'query', name: 'api_key' }, value: 'sekret' }))

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toContain('api_key=sekret')
  })

  it('applies basic auth from connection fields', async () => {
    await drain(args({ authApply: { in: 'basic' }, fields: { user: 'u', password: 'p' } }))

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('sends no auth when endpoint.auth is none', async () => {
    await drain(
      args({
        auth: 'none',
        authApply: { in: 'header', name: 'Authorization', format: 'Bearer {value}' },
      })
    )

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('sends no auth header when the connection carries no authApply spec', async () => {
    await drain(args({ authApply: null }))

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.headers.Authorization).toBeUndefined()
  })
})
