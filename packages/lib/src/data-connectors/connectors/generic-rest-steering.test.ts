// packages/lib/src/data-connectors/connectors/generic-rest-steering.test.ts
// Webhook fetch steering (sync bridge §4): `triggerContext` tokens interpolate into
// the request's path / query / headers / body using the canonical `{key}` helper,
// and an unresolved token fails the fetch before any HTTP call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { genericRestConnector } from './generic-rest'
import type { ConnectorFetchArgs } from './types'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: 42 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function args(over: Partial<ConnectorFetchArgs> = {}): ConnectorFetchArgs {
  return {
    streamKey: 's1',
    mode: 'snapshot',
    state: {},
    credential: { id: 'c1', type: 'secret', value: 'tok', authApply: null },
    config: { endpoint: { baseUrl: 'https://api.example.com', auth: 'none' } },
    requestConfig: {},
    ...over,
  }
}

async function drain(a: ConnectorFetchArgs): Promise<void> {
  const { records } = await genericRestConnector.fetch(a)
  for await (const _ of records) {
    // exhaust the lazy generator so the request fires
  }
}

describe('genericRestConnector — webhook fetch steering', () => {
  it('interpolates a token into the path (encoded)', async () => {
    await drain(
      args({ requestConfig: { path: 'orders/{orderId}.json' }, triggerContext: { orderId: '123' } })
    )
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toContain('/orders/123.json')
  })

  it('escapes reserved chars in a path token', async () => {
    await drain(
      args({ requestConfig: { path: 'orders/{orderId}' }, triggerContext: { orderId: 'a/b' } })
    )
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toContain('/orders/a%2Fb')
  })

  it('interpolates a token into a query param (encoded)', async () => {
    await drain(
      args({
        requestConfig: { path: 'orders', params: { ids: '{orderId}' } },
        triggerContext: { orderId: '123' },
      })
    )
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toContain('ids=123')
  })

  it('interpolates a token into a header value (not encoded)', async () => {
    await drain(
      args({
        requestConfig: { path: 'orders', headers: { 'X-Resource': '{orderId}' } },
        triggerContext: { orderId: 'a/b' },
      })
    )
    const [, init] = fetchMock.mock.calls[0]!
    expect(init.headers['X-Resource']).toBe('a/b')
  })

  it('interpolates tokens into POST body string leaves', async () => {
    await drain(
      args({
        requestConfig: {
          method: 'POST',
          path: 'graphql',
          body: { query: 'order(id:{orderId})', vars: { nested: '{orderId}' } },
        },
        triggerContext: { orderId: '123' },
      })
    )
    const [, init] = fetchMock.mock.calls[0]!
    expect(init.body).toContain('order(id:123)')
    expect(init.body).toContain('"nested":"123"')
  })

  it('throws on an unresolved token rather than firing a request', async () => {
    await expect(
      drain(args({ requestConfig: { path: 'orders/{missing}' }, triggerContext: { orderId: '1' } }))
    ).rejects.toThrow(/unresolved webhook token/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves the request untouched when no triggerContext is present', async () => {
    await drain(args({ requestConfig: { path: 'orders', params: { foo: 'bar' } } }))
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toContain('/orders')
    expect(url).toContain('foo=bar')
  })
})
