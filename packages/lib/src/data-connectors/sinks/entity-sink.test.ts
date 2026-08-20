// packages/lib/src/data-connectors/sinks/entity-sink.test.ts

import { describe, expect, it } from 'vitest'
import { coerceListValue } from './entity-sink'

/**
 * A connector cannot source an array — the fan-out drops array-shaped source values
 * before the sink is reached — so a comma string is the ONLY shape a connector can use
 * to deliver a list. Before this split, that string was written whole and a two-tag
 * source landed as a single compound tag, which meant a connector could never write
 * more than one tag to a tag column.
 */
describe('coerceListValue', () => {
  it('splits a comma string for TAGS into separate values', () => {
    expect(coerceListValue('TAGS', 'Line Item Discount, Order Discount', false)).toEqual([
      'Line Item Discount',
      'Order Discount',
    ])
  })

  it('splits a comma string for MULTI_SELECT too', () => {
    expect(coerceListValue('MULTI_SELECT', 'a,b,c', false)).toEqual(['a', 'b', 'c'])
  })

  it('trims whitespace and drops empty segments', () => {
    expect(coerceListValue('TAGS', ' vip ,, gift ,', false)).toEqual(['vip', 'gift'])
  })

  it('leaves a single-tag string untouched — the common case keeps its old behaviour', () => {
    expect(coerceListValue('TAGS', 'vip', false)).toBe('vip')
  })

  it('leaves an empty string untouched so existing blank handling decides', () => {
    expect(coerceListValue('TAGS', '', false)).toBe('')
  })

  it('falls through to the original value when the string carries no actual tags', () => {
    // `,` would otherwise split to [] and clear the current list.
    expect(coerceListValue('TAGS', ',', false)).toBe(',')
    expect(coerceListValue('TAGS', ' , , ', false)).toBe(' , , ')
  })

  it('NEVER splits a comma in a scalar type — a comma is ordinary TEXT content', () => {
    expect(coerceListValue('TEXT', 'Doe, Jane', false)).toBe('Doe, Jane')
    expect(coerceListValue('EMAIL', 'a@b.com,c@d.com', false)).toBe('a@b.com,c@d.com')
    expect(coerceListValue(undefined, 'a,b', false)).toBe('a,b')
  })

  it('leaves the row-level multi path alone — it is per-row and refuses arrays', () => {
    expect(coerceListValue('TAGS', 'a,b', true)).toBe('a,b')
  })

  it('passes non-string values through untouched', () => {
    expect(coerceListValue('TAGS', null, false)).toBeNull()
    expect(coerceListValue('TAGS', undefined, false)).toBeUndefined()
    expect(coerceListValue('TAGS', 42, false)).toBe(42)
    // An array is already the target shape; the fan-out should never deliver one,
    // but if it does it must not be mangled further.
    expect(coerceListValue('TAGS', ['a', 'b'], false)).toEqual(['a', 'b'])
  })
})
