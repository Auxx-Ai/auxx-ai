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
})
