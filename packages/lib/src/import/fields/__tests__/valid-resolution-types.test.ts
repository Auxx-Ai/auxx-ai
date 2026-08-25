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
    expect(getValidResolutionTypes(field({ type: 'tags', options: OPTIONS }))).toContain(
      'multiselect:split'
    )
  })

  it('leads with the SUGGESTED type, not with the multi splitter', () => {
    // The picker reads entry 0 as "suggested" and compares the stored type
    // against it to decide whether the column is customised. A TAGS column's
    // stored default is `select:value`, so leading with `multiselect:split`
    // badged the wrong row and rendered every default column as customised.
    const tags = field({ type: 'tags', options: OPTIONS })

    expect(getValidResolutionTypes(tags)[0]).toBe(suggestResolutionType(tags))
    expect(getValidResolutionTypes(tags)[0]).toBe('select:value')
  })
})

describe('getValidResolutionTypes — every column can reach its own suggestion', () => {
  /**
   * §2 B of `plans/importer/06-select-option-creation.md`: a column whose
   * SUGGESTED type is absent from its own alternatives list is unreachable in
   * the picker and, worse, is silently rewritten by `buildPayload`'s
   * re-validation on the next unrelated save.
   */
  const cases: Array<[string, ImportableField]> = [
    ['tags with options', field({ type: 'tags', options: OPTIONS })],
    [
      'tags with options, creatable',
      field({ type: 'tags', options: OPTIONS, canCreateOptions: true }),
    ],
    ['enum with options', field({ type: 'enum', options: OPTIONS })],
    ['bare tags', field({ type: 'tags' })],
    ['currency', field({ type: 'currency' })],
    ['number', field({ type: 'number' })],
    ['decimal', field({ type: 'decimal' })],
    ['date', field({ type: 'date' })],
    ['datetime', field({ type: 'datetime' })],
    ['boolean', field({ type: 'boolean' })],
    ['domain', field({ type: 'domain' })],
    ['url', field({ type: 'url' })],
    ['multi url', field({ type: 'url', multi: true })],
    ['email', field({ type: 'email' })],
    ['multi email', field({ type: 'email', multi: true })],
    ['phone', field({ type: 'phone' })],
    ['multi phone', field({ type: 'phone', multi: true })],
    ['text', field({ type: 'text' })],
    ['text keyed like a date', field({ type: 'text', key: 'shippedAt' })],
    ['relation', field({ type: 'relation', isRelation: true })],
  ]

  it.each(cases)('%s leads with its suggestion', (_name, f) => {
    expect(getValidResolutionTypes(f)[0]).toBe(suggestResolutionType(f))
  })
})

describe('suggestResolutionType — the default a FRESH job gets', () => {
  /**
   * Option creation is opt-in per column, by choosing the type. A new job on a
   * field that MAY grow still lands on match-only `select:value`, so the review
   * step's "create these as new options" action is the discovery mechanism, not
   * a convenience. Changing this changes what every new import does silently.
   */
  it('lands on match-only even where the field admits new options', () => {
    expect(suggestResolutionType(field({ options: OPTIONS, canCreateOptions: true }))).toBe(
      'select:value'
    )
    expect(
      suggestResolutionType(field({ type: 'enum', options: OPTIONS, canCreateOptions: true }))
    ).toBe('select:value')
  })

  it('still offers select:create as the reachable alternative', () => {
    const creatable = field({ options: OPTIONS, canCreateOptions: true })

    expect(getValidResolutionTypes(creatable)).toContain('select:create')
    expect(suggestResolutionType(creatable)).not.toBe('select:create')
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
