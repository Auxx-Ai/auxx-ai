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
