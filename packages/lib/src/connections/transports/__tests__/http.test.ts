// packages/lib/src/connections/transports/__tests__/http.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConnectionData } from '../../resolve-connection-for-runtime'
import { httpTransport } from '../http'

/** Capture the (url, init) of the last fetch and return a canned Response. */
function stubFetch(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return response
    })
  )
  return calls
}

/** Spec for one stubbed response. A new `Response` is built per call (bodies are
 *  single-use), and the last spec repeats once the sequence is exhausted. */
interface RespSpec {
  status: number
  body?: string
  headers?: Record<string, string>
}

/** Stub `fetch` to return a sequence of responses; returns the per-call counter. */
function stubFetchSeq(specs: RespSpec[]) {
  const state = { count: 0 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const spec = specs[Math.min(state.count, specs.length - 1)]!
      state.count++
      return new Response(spec.body ?? '{}', { status: spec.status, headers: spec.headers })
    })
  )
  return state
}

/** Drive a request to completion under fake timers (flushes Retry-After/pace sleeps). */
async function runWithTimers<T>(start: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  try {
    const p = start()
    await vi.runAllTimersAsync()
    return await p
  } finally {
    vi.useRealTimers()
  }
}

const bearerConn = (value: string): RuntimeConnectionData =>
  ({
    id: 'c1',
    type: 'oauth2-code',
    value,
    authApply: { in: 'header', name: 'Authorization', format: 'Bearer {value}' },
  }) as RuntimeConnectionData

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('httpTransport.request', () => {
  it('applies the connection authApply (bearer) to the request headers', async () => {
    const calls = stubFetch(new Response('{}', { status: 200 }))
    await httpTransport.request(bearerConn('tok123'), {
      method: 'GET',
      url: 'https://api.example.com/v1',
    })
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok123')
  })

  it('passes through with no auth when conn is null', async () => {
    const calls = stubFetch(new Response('{}', { status: 200 }))
    await httpTransport.request(null, { method: 'GET', url: 'https://api.example.com/v1' })
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('merges query params into the URL', async () => {
    const calls = stubFetch(new Response('{}', { status: 200 }))
    await httpTransport.request(null, {
      method: 'GET',
      url: 'https://api.example.com/v1?a=1',
      query: { b: '2' },
    })
    expect(calls[0]!.url).toBe('https://api.example.com/v1?a=1&b=2')
  })

  it('prepends the connection baseUrl to a relative path', async () => {
    const calls = stubFetch(new Response('{}', { status: 200 }))
    const conn = {
      id: 'c1',
      type: 'oauth2-code',
      value: 't',
      baseUrl: 'https://acme.myshopify.com',
    }
    await httpTransport.request(conn as RuntimeConnectionData, {
      method: 'GET',
      url: '/admin/api/2024-10/orders.json',
    })
    expect(calls[0]!.url).toBe('https://acme.myshopify.com/admin/api/2024-10/orders.json')
  })

  it('uses an absolute URL as-is even when a baseUrl is present', async () => {
    const calls = stubFetch(new Response('{}', { status: 200 }))
    const conn = {
      id: 'c1',
      type: 'oauth2-code',
      value: 't',
      baseUrl: 'https://acme.myshopify.com',
    }
    await httpTransport.request(conn as RuntimeConnectionData, {
      method: 'GET',
      url: 'https://other.example.com/x',
    })
    expect(calls[0]!.url).toBe('https://other.example.com/x')
  })

  it('throws on a relative path with no connection baseUrl', async () => {
    stubFetch(new Response('{}', { status: 200 }))
    await expect(
      httpTransport.request(null, { method: 'GET', url: '/relative/path' })
    ).rejects.toThrow(/no connection baseUrl/)
  })

  it('JSON-encodes a plain object body and defaults a Content-Type', async () => {
    const calls = stubFetch(new Response('{}', { status: 200 }))
    await httpTransport.request(null, {
      method: 'POST',
      url: 'https://api.example.com/v1',
      body: { hello: 'world' },
    })
    expect(calls[0]!.init.body).toBe('{"hello":"world"}')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('passes a string body through and does not set Content-Type', async () => {
    const calls = stubFetch(new Response('{}', { status: 200 }))
    await httpTransport.request(null, {
      method: 'POST',
      url: 'https://api.example.com/v1',
      body: 'raw-text',
    })
    expect(calls[0]!.init.body).toBe('raw-text')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('returns ok:false for a 4xx instead of throwing', async () => {
    stubFetch(new Response('nope', { status: 404 }))
    const res = await httpTransport.request(null, {
      method: 'GET',
      url: 'https://api.example.com/v1',
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(res.body).toBe('nope')
  })

  it('lazily parses JSON via json() and lowercases response headers', async () => {
    stubFetch(
      new Response(JSON.stringify({ items: [1, 2] }), {
        status: 200,
        headers: { Link: '<https://x/next>; rel="next"' },
      })
    )
    const res = await httpTransport.request(null, {
      method: 'GET',
      url: 'https://api.example.com/v1',
    })
    expect(res.json<{ items: number[] }>().items).toEqual([1, 2])
    expect(res.headers.link).toBe('<https://x/next>; rel="next"')
  })

  it('reports rateLimitWaitMs: 0 on a clean response', async () => {
    stubFetch(new Response('{}', { status: 200 }))
    const res = await httpTransport.request(null, {
      method: 'GET',
      url: 'https://api.example.com/v1',
    })
    expect(res.rateLimitWaitMs).toBe(0)
  })
})

describe('httpTransport rate-limit handling (G3)', () => {
  it('honors 429 + Retry-After and retries to the next 200', async () => {
    const state = stubFetchSeq([
      { status: 429, headers: { 'Retry-After': '2' } },
      { status: 200, body: '{"ok":true}' },
    ])
    const res = await runWithTimers(() =>
      httpTransport.request(null, { method: 'GET', url: 'https://api.example.com/v1' })
    )
    expect(state.count).toBe(2)
    expect(res.status).toBe(200)
    expect(res.rateLimitWaitMs).toBe(2_000)
  })

  it('detects a Shopify GraphQL HTTP-200 Throttled body and waits the cost-restore delay', async () => {
    const throttled = JSON.stringify({
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: {
        cost: {
          requestedQueryCost: 1000,
          throttleStatus: { currentlyAvailable: 500, restoreRate: 100 },
        },
      },
    })
    const state = stubFetchSeq([
      { status: 200, body: throttled },
      { status: 200, body: '{"data":{}}' },
    ])
    const res = await runWithTimers(() =>
      httpTransport.request(null, {
        method: 'POST',
        url: 'https://shop.myshopify.com/admin/api/graphql.json',
        rateLimit: { strategy: 'graphql-cost' },
      })
    )
    expect(state.count).toBe(2)
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ data: {} })
    // (1000 − 500) / 100 = 5s
    expect(res.rateLimitWaitMs).toBe(5_000)
  })

  it('backs off (with jitter) on a 429 carrying no Retry-After', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const state = stubFetchSeq([{ status: 429 }, { status: 200 }])
    const res = await runWithTimers(() =>
      httpTransport.request(null, {
        method: 'GET',
        url: 'https://api.stripe.com/v1/charges',
        rateLimit: { strategy: 'backoff-jitter' },
      })
    )
    expect(state.count).toBe(2)
    expect(res.status).toBe(200)
    // full-jitter: round(0.5 · base·2^0) = 500ms
    expect(res.rateLimitWaitMs).toBe(500)
  })

  it('gives up after maxRetries and returns the throttled response', async () => {
    const state = stubFetchSeq([{ status: 429, headers: { 'Retry-After': '1' } }])
    const res = await runWithTimers(() =>
      httpTransport.request(null, {
        method: 'GET',
        url: 'https://api.example.com/v1',
        rateLimit: { maxRetries: 2 },
      })
    )
    // initial attempt + 2 retries = 3 calls, then surrender.
    expect(state.count).toBe(3)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(429)
    expect(res.rateLimitWaitMs).toBe(2_000)
  })

  it('applies the configured minDelayMs inter-page pacing floor', async () => {
    const state = stubFetchSeq([{ status: 200 }])
    const res = await runWithTimers(() =>
      httpTransport.request(null, {
        method: 'GET',
        url: 'https://api.example.com/v1',
        rateLimit: { minDelayMs: 250 },
      })
    )
    expect(state.count).toBe(1)
    expect(res.status).toBe(200)
    expect(res.rateLimitWaitMs).toBe(250)
  })
})
