// packages/lib/src/data-connectors/watermark.test.ts
// maxWatermark must compare numeric watermarks numerically (epoch — HubSpot/Stripe)
// and everything else lexically (ISO-8601 — Shopify/Salesforce/QBO).

import { describe, expect, it } from 'vitest'
import { isNumericWatermark, maxWatermark, parseUpstreamUpdatedAt } from './watermark'

describe('isNumericWatermark', () => {
  it('detects epoch numbers but not ISO timestamps', () => {
    expect(isNumericWatermark('1718000000')).toBe(true)
    expect(isNumericWatermark('1718000000000')).toBe(true)
    expect(isNumericWatermark('2026-06-22T00:00:00Z')).toBe(false)
    expect(isNumericWatermark('')).toBe(false)
  })
})

describe('maxWatermark', () => {
  it('treats undefined as "no watermark"', () => {
    expect(maxWatermark(undefined, '5')).toBe('5')
    expect(maxWatermark('5', undefined)).toBe('5')
    expect(maxWatermark(undefined, undefined)).toBeUndefined()
  })

  it('compares epoch watermarks NUMERICALLY (the lexical-compare trap)', () => {
    // "100" < "99" lexically but 100 > 99 numerically — must return "100".
    expect(maxWatermark('99', '100')).toBe('100')
    expect(maxWatermark('1718000000', '1717000000')).toBe('1718000000')
  })

  it('compares ISO-8601 watermarks lexically (which is chronological)', () => {
    expect(maxWatermark('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z')).toBe(
      '2026-03-01T00:00:00Z'
    )
  })
})

describe('parseUpstreamUpdatedAt', () => {
  it('parses ISO-8601 strings', () => {
    expect(parseUpstreamUpdatedAt('2026-06-22T00:00:00Z')?.toISOString()).toBe(
      '2026-06-22T00:00:00.000Z'
    )
  })

  it('treats numeric values < 1e12 as unix SECONDS, else millis', () => {
    expect(parseUpstreamUpdatedAt(1_700_000_000)?.getTime()).toBe(1_700_000_000_000)
    expect(parseUpstreamUpdatedAt('1700000000')?.getTime()).toBe(1_700_000_000_000)
    expect(parseUpstreamUpdatedAt(1_700_000_000_000)?.getTime()).toBe(1_700_000_000_000)
  })

  it('passes a Date through and rejects an invalid one', () => {
    const d = new Date('2026-06-22T00:00:00Z')
    expect(parseUpstreamUpdatedAt(d)).toBe(d)
    expect(parseUpstreamUpdatedAt(new Date('nope'))).toBeNull()
  })

  it('returns null for absent / blank / unparseable values', () => {
    expect(parseUpstreamUpdatedAt(null)).toBeNull()
    expect(parseUpstreamUpdatedAt(undefined)).toBeNull()
    expect(parseUpstreamUpdatedAt('')).toBeNull()
    expect(parseUpstreamUpdatedAt('   ')).toBeNull()
    expect(parseUpstreamUpdatedAt('not-a-date')).toBeNull()
    expect(parseUpstreamUpdatedAt({})).toBeNull()
  })
})
