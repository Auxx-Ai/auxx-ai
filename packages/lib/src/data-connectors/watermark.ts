// packages/lib/src/data-connectors/watermark.ts
// Watermark comparison for steady (incremental) sync (G2). A watermark is the
// `max(updated_at)` the stream has seen; the next steady run filters `> watermark`.
// Providers express it two ways — ISO-8601 timestamps (Shopify/Salesforce/QBO) and
// epoch numbers (HubSpot millis, Stripe unix seconds). `maxWatermark` auto-detects:
// numeric strings compare numerically (so "100" > "99"), everything else lexically
// (ISO-8601 sorts correctly as a string). This avoids threading a format flag through
// the slice loop while still being right for both families.

/** True when `v` is a non-empty string that parses to a finite number. */
export function isNumericWatermark(v: string): boolean {
  return v.trim() !== '' && Number.isFinite(Number(v))
}

/**
 * Return whichever of `a`/`b` is the LATER watermark (numeric when both are numeric,
 * else lexical). `undefined` is treated as "no watermark" and loses to any value.
 */
export function maxWatermark(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  if (isNumericWatermark(a) && isNumericWatermark(b)) {
    return Number(a) >= Number(b) ? a : b
  }
  return a >= b ? a : b
}

/**
 * Parse a source record's `watermarkField` value (the upstream last-modified) into a
 * `Date` for the durable `DataConnectorItem.upstreamUpdatedAt` stamp + the out-of-order
 * write guard (sync-bridge §9 Q7). Auto-detects the same two families `maxWatermark`
 * handles — ISO-8601 strings and epoch numbers — so no format flag is threaded:
 * numeric values < `1e12` are unix SECONDS (Stripe), else millis (HubSpot). Returns
 * `null` for absent/blank/unparseable values (⇒ no stamp, no guard for that record).
 */
export function parseUpstreamUpdatedAt(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return fromEpoch(value)
  if (typeof value === 'string') {
    const s = value.trim()
    if (s === '') return null
    if (isNumericWatermark(s)) return fromEpoch(Number(s))
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** Coerce an epoch number to a `Date`, treating values below `1e12` as seconds. */
function fromEpoch(n: number): Date | null {
  if (!Number.isFinite(n)) return null
  const d = new Date(n < 1e12 ? n * 1000 : n)
  return Number.isNaN(d.getTime()) ? null : d
}
