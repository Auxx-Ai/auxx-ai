// packages/lib/src/import/fields/__tests__/valid-resolution-types.test.ts

import { describe, expect, it } from 'vitest'
import type { ImportableField } from '../get-importable-fields'
import { getValidResolutionTypes, suggestResolutionType } from '../suggest-resolution-type'

/**
 * Base types as `mapFieldTypeToBaseType` really produces them. There is no
 * `'select'` and no `'multiselect'` — SINGLE_SELECT becomes `BaseType.ENUM` and
 * MULTI_SELECT becomes `BaseType.ARRAY` — which is why the two cases keyed on
 * those strings matched no field that has ever existed.
 */
const field = (over: Partial<ImportableField> = {}): ImportableField => ({
  key: 'category',
  label: 'Category',
  type: 'tags',
  required: false,
  isRelation: false,
  isIdentifier: false,
  group: 'system',
  ...over,
})

const OPTIONS = [
  { value: 'Motor', label: 'Motor' },
  { value: 'Steel', label: 'Steel' },
]

describe('getValidResolutionTypes — option-bearing fields', () => {
  it('offers matching types for a TAGS field that carries options', () => {
    // Before: `case 'tags'` returned `['array:split', 'text:value']`, so the
    // column's own SUGGESTED type (`select:value`) was not in its offer list.
    const types = getValidResolutionTypes(field({ options: OPTIONS }))

    expect(types).toContain('select:value')
    expect(types).toContain(suggestResolutionType(field({ options: OPTIONS })))
  })

  it('offers select:create only when the field may actually grow', () => {
    expect(getValidResolutionTypes(field({ options: OPTIONS, canCreateOptions: true }))).toContain(
      'select:create'
    )
    expect(
      getValidResolutionTypes(field({ options: OPTIONS, canCreateOptions: false }))
    ).not.toContain('select:create')
    // Absent is not permission.
    expect(getValidResolutionTypes(field({ options: OPTIONS }))).not.toContain('select:create')
  })

  it('reaches a SINGLE_SELECT, which arrives as BaseType ENUM', () => {
    const enumField = field({ type: 'enum', options: OPTIONS, canCreateOptions: true })

    expect(getValidResolutionTypes(enumField)).toEqual([
      'select:value',
      'select:create',
      'array:split',
      'text:value',
    ])
  })

  it('offers multiselect:split for types that are multi by TYPE, not by options.multi', () => {
    // `field.multi` reports `options.multi`, which is false for both TAGS and
    // MULTI_SELECT — their multi-ness comes from the base type.
    expect(getValidResolutionTypes(field({ type: 'tags', options: OPTIONS }))[0]).toBe(
      'multiselect:split'
    )
  })

  it('leaves a single-valued select without the multi splitter', () => {
    expect(getValidResolutionTypes(field({ type: 'enum', options: OPTIONS }))).not.toContain(
      'multiselect:split'
    )
  })
})

describe('getValidResolutionTypes — everything else', () => {
  it('treats an unpopulated TAGS field as free-form', () => {
    // A brand-new org's tag field has no taxonomy to match against yet.
    expect(getValidResolutionTypes(field({ type: 'tags' }))).toEqual(['array:split', 'text:value'])
  })

  it('does not divert a relation field into the option branch', () => {
    const relation = field({ type: 'relation', isRelation: true, options: OPTIONS })

    expect(getValidResolutionTypes(relation)).toContain('relation:match')
    expect(getValidResolutionTypes(relation)).not.toContain('select:value')
  })

  it('still offers the money pair for a currency column', () => {
    expect(getValidResolutionTypes(field({ type: 'currency' }))).toEqual([
      'currency:major',
      'number:integer',
      'text:value',
    ])
  })
})
