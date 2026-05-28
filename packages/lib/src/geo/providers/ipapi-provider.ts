// packages/lib/src/geo/providers/ipapi-provider.ts

import type { GeoLocation, IpLookupProvider } from '../types'

interface IpApiResponse {
  city?: string
  region?: string
  country_name?: string
  country_code?: string
  timezone?: string
  error?: boolean
  reason?: string
}

/**
 * ipapi.co hosted lookup. Free tier requires no signup but is
 * rate-limited (≈30k req/day from a single IP as of last check).
 * Selected when `AUXX_GEO_PROVIDER=ipapi` — useful for self-hosters who
 * don't want a MaxMind account.
 *
 * 2-second hard timeout so a hung ipapi.co never stalls the chat
 * passport-mint critical path; failure is silent (returns `null`).
 */
export class IpApiProvider implements IpLookupProvider {
  readonly id = 'ipapi' as const

  async lookup(ip: string): Promise<GeoLocation | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2_000)
    try {
      const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'auxxai/1.0' },
      })
      if (!res.ok) return null
      const data = (await res.json()) as IpApiResponse
      if (data.error) return null
      return {
        city: data.city,
        region: data.region,
        country: data.country_name,
        countryCode: data.country_code,
        timezone: data.timezone,
      }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }
}
