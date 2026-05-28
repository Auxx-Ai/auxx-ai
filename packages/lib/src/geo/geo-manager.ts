// packages/lib/src/geo/geo-manager.ts

import { createScopedLogger } from '@auxx/logger'
import { isPrivateIp } from './private-ip'
import { IpApiProvider } from './providers/ipapi-provider'
import { MaxMindProvider } from './providers/maxmind-provider'
import { NoopProvider } from './providers/noop-provider'
import type { GeoLocation, IpLookupProvider } from './types'

const log = createScopedLogger('geo-manager')

let provider: IpLookupProvider | null = null
let initPromise: Promise<void> | null = null

function selectProvider(): IpLookupProvider {
  const choice = (process.env.AUXX_GEO_PROVIDER ?? 'maxmind').toLowerCase()
  if (choice === 'none') return new NoopProvider()
  if (choice === 'ipapi') return new IpApiProvider()
  if (choice === 'maxmind') return new MaxMindProvider()
  log.warn(`Unknown AUXX_GEO_PROVIDER=${choice} — falling back to none`)
  return new NoopProvider()
}

/**
 * Initialize the geo lookup provider. Idempotent — safe to call multiple
 * times. Never throws: provider init failures swap in {@link NoopProvider}
 * so the rest of the app continues to boot.
 */
export async function initGeo(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const p = selectProvider()
    try {
      await p.init?.()
      provider = p
      log.info(`Geo lookup ready: provider=${p.id}`)
    } catch (err) {
      log.warn(`Geo provider ${p.id} failed to init — lookups disabled`, {
        error: err instanceof Error ? err.message : String(err),
      })
      provider = new NoopProvider()
    }
  })()
  return initPromise
}

/**
 * Resolve an IP to a {@link GeoLocation}. Returns `null` for:
 * - missing / empty input
 * - private, loopback, or link-local ranges
 * - any provider failure (logged at warn, never thrown)
 * - calls before {@link initGeo} has resolved (silent fallback)
 */
export async function lookupIp(ip: string | null | undefined): Promise<GeoLocation | null> {
  if (!ip) return null
  if (isPrivateIp(ip)) return null
  if (!provider) return null
  try {
    return await provider.lookup(ip)
  } catch (err) {
    log.warn('Geo lookup failed', {
      ip,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Test-only — resets the module-level provider + init promise so tests
 * can re-init with a different `AUXX_GEO_PROVIDER`. Do not call from app code.
 */
export function __resetGeoForTests(): void {
  provider = null
  initPromise = null
}
