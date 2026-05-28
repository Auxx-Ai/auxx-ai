// packages/lib/src/geo/providers/noop-provider.ts

import type { GeoLocation, IpLookupProvider } from '../types'

/**
 * Disabled provider. Selected when `AUXX_GEO_PROVIDER=none`, or as the
 * silent fallback when the configured provider fails to init.
 */
export class NoopProvider implements IpLookupProvider {
  readonly id = 'noop' as const

  async lookup(_ip: string): Promise<GeoLocation | null> {
    return null
  }
}
