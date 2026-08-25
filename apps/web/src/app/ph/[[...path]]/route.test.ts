// apps/web/src/app/ph/[[...path]]/route.test.ts

import type { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

/**
 * A null-body status (101/204/205/304) paired with a non-null body makes the
 * `Response` constructor THROW `Invalid response status code <n>` rather than
 * return. `response.arrayBuffer()` resolves to a zero-length but non-null
 * ArrayBuffer, so forwarding it verbatim turned every PostHog 204/304 into a 500
 * from this proxy — analytics capture and asset revalidation both silently
 * failing in production.
 */
function upstream(status: number, body: string | null = null) {
  return new Response(body, {
    status,
    headers: { etag: 'W/"abc"', 'cache-control': 'max-age=60' },
  })
}

function proxyRequest(path = '/ph/static/array.js') {
  const url = new URL(`https://app.auxx.ai${path}`)
  return {
    method: 'GET',
    nextUrl: url,
    headers: new Headers({ accept: '*/*' }),
  } as unknown as NextRequest
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PostHog proxy — null-body statuses', () => {
  it.each([204, 205, 304])('forwards %i without throwing', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream(status))
    )

    const res = await GET(proxyRequest())

    expect(res.status).toBe(status)
    expect(res.body).toBeNull()
    // Conditional-request headers must survive, or the browser re-downloads.
    expect(res.headers.get('etag')).toBe('W/"abc"')
  })

  it('still forwards the body on a normal 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream(200, 'console.log(1)'))
    )

    const res = await GET(proxyRequest())

    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('console.log(1)')
  })
})
