// apps/web/src/components/data-connectors/hooks/use-source-paths.test.ts

import { describe, expect, it } from 'vitest'
import { flattenSourceSchema, leafPathsUnder } from './use-source-paths'

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    customer: {
      type: 'object',
      properties: { email: { type: 'string' }, name: { type: 'string' } },
    },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { sku: { type: 'string' }, price: { type: 'number' } },
      },
    },
  },
}

describe('flattenSourceSchema', () => {
  it('emits dotted leaf + branch paths, arrays under `[]`', () => {
    const paths = flattenSourceSchema(SCHEMA).map((p) => p.path)
    expect(paths).toContain('customer.email')
    expect(paths).toContain('line_items[].sku')
    expect(paths).toContain('line_items[].price')
  })
})

describe('leafPathsUnder', () => {
  it('returns root leaves unchanged (relative == absolute)', () => {
    const leaves = leafPathsUnder(flattenSourceSchema(SCHEMA), '').map((p) => p.path)
    expect(leaves).toContain('id')
    expect(leaves).toContain('customer.email')
    // branches are excluded
    expect(leaves).not.toContain('customer')
    expect(leaves).not.toContain('line_items')
  })

  it('strips an object rootPath prefix', () => {
    const leaves = leafPathsUnder(flattenSourceSchema(SCHEMA), 'customer').map((p) => p.path)
    expect(leaves.sort()).toEqual(['email', 'name'])
  })

  it('strips an array rootPath prefix (the `[]` segment too)', () => {
    const leaves = leafPathsUnder(flattenSourceSchema(SCHEMA), 'line_items[]').map((p) => p.path)
    expect(leaves.sort()).toEqual(['price', 'sku'])
  })

  it('flattens an array-of-objects ROOT and strips the `[]` root prefix', () => {
    // The generic-rest raw-response case: the source schema IS the array.
    const arrayRoot = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'number' }, title: { type: 'string' } },
      },
    }
    expect(
      flattenSourceSchema(arrayRoot)
        .map((p) => p.path)
        .sort()
    ).toEqual(['[].id', '[].title'])
    const leaves = leafPathsUnder(flattenSourceSchema(arrayRoot), '[]').map((p) => p.path)
    expect(leaves.sort()).toEqual(['id', 'title'])
  })
})
