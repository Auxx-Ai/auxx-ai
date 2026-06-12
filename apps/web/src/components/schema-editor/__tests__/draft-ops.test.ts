// apps/web/src/components/schema-editor/__tests__/draft-ops.test.ts

import { FieldType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import {
  addField,
  changeRowType,
  removeRow,
  STRUCTURAL_ARRAY,
  STRUCTURAL_OBJECT,
  siblingNames,
  updateRow,
} from '../draft-ops'
import { jsonSchemaToDraft } from '../schema-draft'

const nested = () =>
  jsonSchemaToDraft({
    type: 'object',
    properties: {
      title: { type: 'string' },
      meta: { type: 'object', properties: { author: { type: 'string' } } },
      lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } },
    },
  })

describe('updateRow', () => {
  it('patches a deeply nested row', () => {
    const rows = nested()
    const authorId = rows[1]!.children![0]!.id
    const out = updateRow(rows, authorId, (r) => ({ ...r, name: 'writer' }))
    expect(out[1]!.children![0]!.name).toBe('writer')
    // Original untouched (immutable).
    expect(rows[1]!.children![0]!.name).toBe('author')
  })

  it('patches a row inside array items', () => {
    const rows = nested()
    const skuId = rows[2]!.items!.children![0]!.id
    const out = updateRow(rows, skuId, (r) => ({ ...r, nullable: true }))
    expect(out[2]!.items!.children![0]!.nullable).toBe(true)
  })
})

describe('removeRow', () => {
  it('removes a top-level row', () => {
    const rows = nested()
    const out = removeRow(rows, rows[0]!.id)
    expect(out.map((r) => r.name)).toEqual(['meta', 'lines'])
  })

  it('removes a nested array-item child', () => {
    const rows = nested()
    const skuId = rows[2]!.items!.children![0]!.id
    const out = removeRow(rows, skuId)
    expect(out[2]!.items!.children).toEqual([])
  })
})

describe('addField', () => {
  it('appends to the root', () => {
    const { rows, id } = addField(nested(), null)
    expect(rows).toHaveLength(4)
    expect(rows[3]!.id).toBe(id)
    expect(rows[3]!.fieldType).toBe(FieldType.TEXT)
  })

  it('appends to an object child list', () => {
    const base = nested()
    const { rows } = addField(base, base[1]!.id)
    expect(rows[1]!.children).toHaveLength(2)
  })

  it('appends to array items children', () => {
    const base = nested()
    const { rows } = addField(base, base[2]!.id)
    expect(rows[2]!.items!.children).toHaveLength(2)
  })
})

describe('changeRowType', () => {
  it('switches a leaf to an object, keeping name/description', () => {
    const row = nested()[0]!
    const out = changeRowType({ ...row, description: 'hi' }, STRUCTURAL_OBJECT)
    expect(out.kind).toBe('object')
    expect(out.fieldType).toBeUndefined()
    expect(out.description).toBe('hi')
    expect(out.children).toEqual([])
  })

  it('switches to an array of objects with an items draft', () => {
    const out = changeRowType(nested()[0]!, STRUCTURAL_ARRAY)
    expect(out.kind).toBe('array')
    expect(out.items?.kind).toBe('object')
  })

  it('initializes an options list when switching to a select', () => {
    const out = changeRowType(nested()[0]!, FieldType.SINGLE_SELECT)
    expect(out.kind).toBe('field')
    expect(out.options).toEqual([])
  })

  it('drops object children when switching to a leaf', () => {
    const meta = nested()[1]!
    const out = changeRowType(meta, FieldType.NUMBER)
    expect(out.children).toBeUndefined()
    expect(out.fieldType).toBe(FieldType.NUMBER)
  })
})

describe('siblingNames', () => {
  it('returns peer names for a nested row', () => {
    const base = nested()
    const { rows } = addField(base, base[1]!.id)
    const newId = rows[1]!.children![1]!.id
    expect(siblingNames(rows, newId)).toEqual(['author'])
  })

  it('returns top-level peers', () => {
    const rows = nested()
    expect(siblingNames(rows, rows[0]!.id)).toEqual(['meta', 'lines'])
  })
})
