// packages/utils/src/__tests__/strings.test.ts

import { describe, expect, it } from 'vitest'
import { humanizeFieldName, humanizeFieldPath } from '../strings'

describe('humanizeFieldName', () => {
  it('splits camelCase', () => {
    expect(humanizeFieldName('totalPrice')).toBe('Total Price')
    expect(humanizeFieldName('first.name')).toBe('First Name')
  })

  it('splits snake_case and kebab-case', () => {
    expect(humanizeFieldName('total_price')).toBe('Total Price')
    expect(humanizeFieldName('line-items')).toBe('Line Items')
  })

  it('preserves all-caps acronyms', () => {
    expect(humanizeFieldName('customerID')).toBe('Customer ID')
    expect(humanizeFieldName('URL')).toBe('URL')
  })

  it('drops the array marker', () => {
    expect(humanizeFieldName('tags[]')).toBe('Tags')
  })

  it('returns empty string for empty / nullish input', () => {
    expect(humanizeFieldName('')).toBe('')
    expect(humanizeFieldName(null)).toBe('')
    expect(humanizeFieldName(undefined)).toBe('')
  })
})

describe('humanizeFieldPath', () => {
  it('prepends ancestor object names', () => {
    expect(humanizeFieldPath('owner.url')).toBe('Owner Url')
    expect(humanizeFieldPath('owner.id')).toBe('Owner Id')
    expect(humanizeFieldPath('a.b.c')).toBe('A B C')
    expect(humanizeFieldPath('customer.totalPrice')).toBe('Customer Total Price')
  })

  it('does not prefix a root-level leaf', () => {
    expect(humanizeFieldPath('url')).toBe('Url')
  })

  it('handles array markers per segment', () => {
    expect(humanizeFieldPath('line_items[].sku')).toBe('Line Items Sku')
    expect(humanizeFieldPath('owner.aliases[]')).toBe('Owner Aliases')
  })

  it('does not double a parent name the child restates', () => {
    expect(humanizeFieldPath('owner.owner_id')).toBe('Owner Id')
    expect(humanizeFieldPath('owner.owner')).toBe('Owner')
    expect(humanizeFieldPath('order.order_line_id')).toBe('Order Line Id')
    expect(humanizeFieldPath('owner.owner.id')).toBe('Owner Id')
  })

  it('returns empty string for empty / nullish input', () => {
    expect(humanizeFieldPath('')).toBe('')
    expect(humanizeFieldPath(null)).toBe('')
    expect(humanizeFieldPath(undefined)).toBe('')
  })
})
