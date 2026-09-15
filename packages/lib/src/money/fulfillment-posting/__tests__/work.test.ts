// packages/lib/src/money/fulfillment-posting/__tests__/work.test.ts
import { describe, expect, it } from 'vitest'
import { fulfillmentDecimal } from '../work'

describe('durable fulfillment decimal values', () => {
  it('preserves fractional minor-unit rates and tiny quantities without exponent notation', () => {
    expect(fulfillmentDecimal(90.5)).toBe('90.5')
    expect(fulfillmentDecimal(1.25e-7)).toBe('0.000000125')
    expect(fulfillmentDecimal(1e21)).toBe('1000000000000000000000')
    expect(fulfillmentDecimal(0)).toBe('0')
  })
  it('refuses nonfinite and negative calculation inputs before sealing', () => {
    for (const value of [NaN, Infinity, -1]) expect(() => fulfillmentDecimal(value)).toThrow()
  })
})
