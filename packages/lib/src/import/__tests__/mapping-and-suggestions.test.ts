// packages/lib/src/import/__tests__/mapping-and-suggestions.test.ts

import { describe, expect, it } from 'vitest'
import { ConflictError } from '../../errors'
import type { ImportableField } from '../fields/get-importable-fields'
import { suggestResolutionType } from '../fields/suggest-resolution-type'
import { assertNoDuplicateTargetMapping } from '../mapping/save-mapping-property'

function field(overrides: Partial<ImportableField>): ImportableField {
  return {
    key: 'primary_email',
    label: 'Email',
    type: 'email',
    required: false,
    isRelation: false,
    isIdentifier: false,
    group: 'system',
    ...overrides,
  }
}

describe('suggestResolutionType — split variants for multi fields', () => {
  it('picks email:split for a multi email field, email:value for single', () => {
    expect(suggestResolutionType(field({ multi: true }))).toBe('email:split')
    expect(suggestResolutionType(field({ multi: false }))).toBe('email:value')
    expect(suggestResolutionType(field({}))).toBe('email:value')
  })

  it('picks phone:split / url:split for multi phone and url fields', () => {
    expect(suggestResolutionType(field({ key: 'phone', type: 'phone', multi: true }))).toBe(
      'phone:split'
    )
    expect(suggestResolutionType(field({ key: 'phone', type: 'phone' }))).toBe('phone:value')
    expect(suggestResolutionType(field({ key: 'website', type: 'url', multi: true }))).toBe(
      'url:split'
    )
    // single URL fields map to url:value since #1618 (scheme/path preserved)
    expect(suggestResolutionType(field({ key: 'website', type: 'url' }))).toBe('url:value')
  })

  it('branches the name-based text fallback on multi too', () => {
    expect(suggestResolutionType(field({ key: 'work_email', type: 'text', multi: true }))).toBe(
      'email:split'
    )
  })
})

describe('assertNoDuplicateTargetMapping — duplicate target mappings are rejected', () => {
  const existing = [
    { sourceColumnIndex: 0, sourceColumnName: 'Email', targetFieldKey: 'primary_email' },
    { sourceColumnIndex: 1, sourceColumnName: 'Name', targetFieldKey: 'first_name' },
  ]

  it('throws a ConflictError naming the already-mapped column', () => {
    expect(() =>
      assertNoDuplicateTargetMapping(existing, { columnIndex: 2, targetFieldKey: 'primary_email' })
    ).toThrow(ConflictError)
    expect(() =>
      assertNoDuplicateTargetMapping(existing, { columnIndex: 2, targetFieldKey: 'primary_email' })
    ).toThrow(/"Email" is already mapped/)
  })

  it('allows re-saving the same column and unmapped targets', () => {
    expect(() =>
      assertNoDuplicateTargetMapping(existing, { columnIndex: 0, targetFieldKey: 'primary_email' })
    ).not.toThrow()
    expect(() =>
      assertNoDuplicateTargetMapping(existing, { columnIndex: 2, targetFieldKey: null })
    ).not.toThrow()
    expect(() =>
      assertNoDuplicateTargetMapping(existing, { columnIndex: 2, targetFieldKey: 'last_name' })
    ).not.toThrow()
  })
})
