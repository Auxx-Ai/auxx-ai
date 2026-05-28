// packages/lib/src/geo/types.ts

/**
 * Resolved location for an IP address. All fields are optional — providers
 * fill in what they know; callers must handle partial results.
 */
export interface GeoLocation {
  /** City name (English). */
  city?: string
  /** First-level subdivision — US state, Canadian province, etc. */
  region?: string
  /** Country name (English). */
  country?: string
  /** ISO 3166-1 alpha-2 country code. */
  countryCode?: string
  /** IANA timezone, e.g. `America/Los_Angeles`. */
  timezone?: string
}

/**
 * Pluggable IP-to-location provider. Implementations live under
 * `packages/lib/src/geo/providers/` and are selected by
 * {@link selectProvider} based on the `AUXX_GEO_PROVIDER` env var.
 */
export interface IpLookupProvider {
  readonly id: 'maxmind' | 'ipapi' | 'noop'
  /** One-time setup. Called from {@link initGeo} at API boot. */
  init?(): Promise<void>
  /** Resolve a single IP. Returns `null` when the IP is unknown or invalid. */
  lookup(ip: string): Promise<GeoLocation | null>
}
