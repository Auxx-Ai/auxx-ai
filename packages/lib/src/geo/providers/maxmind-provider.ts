// packages/lib/src/geo/providers/maxmind-provider.ts

import { promises as fs } from 'node:fs'
import maxmind, { type CityResponse, type Reader } from 'maxmind'
import type { GeoLocation, IpLookupProvider } from '../types'

/**
 * Resolved relative to `process.cwd()`. Both prod (Docker WORKDIR=/app)
 * and local dev (API runs from apps/api/) put the mmdb in a sibling `geo/`
 * dir, so this single default works in both without an env override.
 */
const DEFAULT_PATH = './geo/GeoLite2-City.mmdb'

/**
 * MaxMind GeoLite2-City local mmdb provider. Sub-millisecond lookups via
 * memory-mapped file; the file itself is acquired at container start by
 * the shared `docker-entrypoint.sh` using the operator's
 * `MAXMIND_LICENSE_KEY` env var.
 *
 * License terms forbid redistribution of the mmdb, so it is never baked
 * into the published Docker image — operators always bring their own.
 */
export class MaxMindProvider implements IpLookupProvider {
  readonly id = 'maxmind' as const
  private reader: Reader<CityResponse> | null = null

  async init(): Promise<void> {
    const path = process.env.MAXMIND_DB_PATH ?? DEFAULT_PATH
    try {
      await fs.access(path)
    } catch {
      throw new Error(
        `MaxMind mmdb not found at ${path}. Set MAXMIND_LICENSE_KEY and ` +
          `restart so the entrypoint can download it, set ` +
          `AUXX_GEO_PROVIDER=ipapi to use the hosted fallback, or ` +
          `AUXX_GEO_PROVIDER=none to disable geo lookups.`
      )
    }
    this.reader = await maxmind.open<CityResponse>(path)
  }

  async lookup(ip: string): Promise<GeoLocation | null> {
    if (!this.reader) return null
    const record = this.reader.get(ip)
    if (!record) return null
    return {
      city: record.city?.names?.en,
      region: record.subdivisions?.[0]?.names?.en,
      country: record.country?.names?.en,
      countryCode: record.country?.iso_code,
      timezone: record.location?.time_zone,
    }
  }
}
