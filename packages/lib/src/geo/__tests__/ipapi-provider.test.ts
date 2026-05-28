// packages/lib/src/geo/__tests__/ipapi-provider.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpApiProvider } from '../providers/ipapi-provider'

describe('IpApiProvider', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('maps a successful response into GeoLocation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        city: 'Inglewood',
        region: 'California',
        country_name: 'United States',
        country_code: 'US',
        timezone: 'America/Los_Angeles',
      }),
    } as Response)

    const result = await new IpApiProvider().lookup('8.8.8.8')
    expect(result).toEqual({
      city: 'Inglewood',
      region: 'California',
      country: 'United States',
      countryCode: 'US',
      timezone: 'America/Los_Angeles',
    })
  })

  it('returns null when ipapi signals an error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: true, reason: 'reserved' }),
    } as Response)

    expect(await new IpApiProvider().lookup('127.0.0.1')).toBeNull()
  })

  it('returns null on non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as Response)

    expect(await new IpApiProvider().lookup('8.8.8.8')).toBeNull()
  })

  it('returns null on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom'))
    expect(await new IpApiProvider().lookup('8.8.8.8')).toBeNull()
  })
})
