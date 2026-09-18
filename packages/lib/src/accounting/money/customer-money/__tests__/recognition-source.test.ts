// packages/lib/src/accounting/money/customer-money/__tests__/recognition-source.test.ts

import { describe, expect, it } from 'vitest'
import { sourceOccurrence } from '../recognition-source'

describe('sourceOccurrence', () => {
  it('normalizes PostgreSQL shipment timestamp text while refusing date-only evidence', () => {
    expect(sourceOccurrence('2026-07-05 19:49:02+00', 'shipment')).toBe('2026-07-05T19:49:02.000Z')
    expect(sourceOccurrence('2026-07-05T12:49:02-07:00', 'shipment')).toBe(
      '2026-07-05T19:49:02.000Z'
    )
    expect(() => sourceOccurrence('2026-07-05', 'shipment')).toThrow('occurrence instant')
  })
})
