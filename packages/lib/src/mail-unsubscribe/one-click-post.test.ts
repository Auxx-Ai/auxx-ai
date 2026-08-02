// packages/lib/src/mail-unsubscribe/one-click-post.test.ts
// SSRF + downgrade rejections on the only outbound request we make to an
// address a stranger put in an email header, plus the redirect re-validation
// that stops a 302 walking us onto the metadata endpoint.

import { describe, expect, it, vi } from 'vitest'
import { assertPublicHttpsUrl, ONE_CLICK_BODY, postOneClickUnsubscribe } from './one-click-post'

describe('assertPublicHttpsUrl', () => {
  it('accepts an ordinary public https url', () => {
    expect(assertPublicHttpsUrl('https://list.example.com/u/abc').hostname).toBe('list.example.com')
  })

  it('refuses http — HTTPS only, no cleartext downgrade', () => {
    expect(() => assertPublicHttpsUrl('http://list.example.com/u')).toThrow(/HTTPS only/)
  })

  it('refuses non-web schemes', () => {
    expect(() => assertPublicHttpsUrl('file:///etc/passwd')).toThrow(/HTTPS only/)
    expect(() => assertPublicHttpsUrl('ftp://example.com/u')).toThrow(/HTTPS only/)
  })

  it('refuses garbage', () => {
    expect(() => assertPublicHttpsUrl('not a url')).toThrow(/not a valid URL/)
  })

  it.each([
    'https://localhost/u',
    'https://api.localhost/u',
    'https://printer.local/u',
    'https://vault.internal/u',
    'https://box.home.arpa/u',
  ])('refuses the private hostname %s', (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow(/private hostname/)
  })

  it.each([
    ['https://127.0.0.1/u', 'loopback'],
    ['https://10.1.2.3/u', 'RFC1918 /8'],
    ['https://172.16.0.1/u', 'RFC1918 /12'],
    ['https://192.168.1.1/u', 'RFC1918 /16'],
    ['https://169.254.169.254/latest/meta-data', 'cloud metadata'],
    ['https://100.64.0.1/u', 'CGNAT'],
    ['https://0.0.0.0/u', 'unspecified'],
    ['https://239.1.1.1/u', 'multicast'],
  ])('refuses %s (%s)', (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow(/private IP/)
  })

  it.each([
    'https://[::1]/u',
    'https://[fe80::1]/u',
    'https://[fd00::1]/u',
  ])('refuses the private IPv6 address %s', (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow(/private IPv6/)
  })

  it('lets a public IPv4 literal through — the gate is about privacy, not literals', () => {
    expect(() => assertPublicHttpsUrl('https://8.8.8.8/u')).not.toThrow()
  })
})

/** A `fetch` stand-in returning a scripted sequence of responses. */
function scriptedFetch(responses: Array<{ status: number; location?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses[calls.length - 1] ?? { status: 200 }
    return {
      status: next.status,
      body: null,
      headers: { get: (key: string) => (key === 'location' ? (next.location ?? null) : null) },
    } as unknown as Response
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('postOneClickUnsubscribe', () => {
  it('POSTs the RFC 8058 body with no credentials and no runtime redirect following', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200 }])

    const result = await postOneClickUnsubscribe('https://list.example.com/u/abc', {
      fetchImpl: impl,
    })

    expect(result).toEqual({
      accepted: true,
      status: 200,
      finalUrl: 'https://list.example.com/u/abc',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.body).toBe(ONE_CLICK_BODY)
    expect(calls[0]!.init.credentials).toBe('omit')
    expect(calls[0]!.init.redirect).toBe('manual')
  })

  it('treats a non-2xx as not accepted rather than throwing', async () => {
    const { impl } = scriptedFetch([{ status: 500 }])
    const result = await postOneClickUnsubscribe('https://list.example.com/u', { fetchImpl: impl })
    expect(result.accepted).toBe(false)
    expect(result.status).toBe(500)
  })

  it('never fetches a private URL at all', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200 }])
    await expect(
      postOneClickUnsubscribe('https://169.254.169.254/latest', { fetchImpl: impl })
    ).rejects.toThrow(/private IP/)
    expect(calls).toHaveLength(0)
  })

  it('re-validates every redirect hop — a 302 cannot downgrade to http', async () => {
    const { impl } = scriptedFetch([{ status: 302, location: 'http://list.example.com/confirm' }])
    await expect(
      postOneClickUnsubscribe('https://list.example.com/u', { fetchImpl: impl })
    ).rejects.toThrow(/HTTPS only/)
  })

  it('re-validates every redirect hop — a 302 cannot walk us onto the metadata endpoint', async () => {
    const { impl } = scriptedFetch([{ status: 302, location: 'https://169.254.169.254/latest' }])
    await expect(
      postOneClickUnsubscribe('https://list.example.com/u', { fetchImpl: impl })
    ).rejects.toThrow(/private IP/)
  })

  it('follows a public https redirect and reports the final url', async () => {
    const { impl, calls } = scriptedFetch([
      { status: 301, location: 'https://list.example.com/confirmed' },
      { status: 204 },
    ])

    const result = await postOneClickUnsubscribe('https://list.example.com/u', { fetchImpl: impl })

    expect(result).toEqual({
      accepted: true,
      status: 204,
      finalUrl: 'https://list.example.com/confirmed',
    })
    expect(calls).toHaveLength(2)
  })

  it('caps redirect chains', async () => {
    const { impl } = scriptedFetch(
      Array.from({ length: 8 }, () => ({ status: 302, location: 'https://list.example.com/next' }))
    )
    await expect(
      postOneClickUnsubscribe('https://list.example.com/u', { fetchImpl: impl })
    ).rejects.toThrow(/redirected too many times/)
  })
})
