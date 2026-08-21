// apps/web/src/components/dynamic-table/utils/cell-coercion.test.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { toFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { coerceForPaste, optionLabel } from './cell-coercion'

/**
 * Two tag columns offering the SAME labels hold DIFFERENT option ids — ids are
 * minted per field. This is the shape that produced "no matching option".
 */
const FAVORITE_COLOR_OPTIONS = [
  { label: 'Blue', value: 'oum39u7ui3FXI0KSe9MDr' },
  { label: 'Red', value: 'xcqDrNAB3NsGiGJmbqfPp' },
]
const TAGS_OPTIONS = [
  { label: 'Red', value: 'z6XudI5z5agprmZ0Qdswb' },
  { label: 'Blue', value: 'qZ70qtJNVuOOVUhZjjKXs' },
]

function selectField(
  fieldType: 'TAGS' | 'MULTI_SELECT' | 'SINGLE_SELECT',
  options: Array<{ id?: string; value: string; label: string }>
): ResourceField {
  return {
    id: toFieldId('field1'),
    key: 'field1',
    label: 'Field 1',
    type: 'string',
    fieldType,
    options: { options },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
    },
  } as ResourceField
}

describe('optionLabel', () => {
  it('resolves a stored option id to its label', () => {
    expect(optionLabel('z6XudI5z5agprmZ0Qdswb', TAGS_OPTIONS)).toBe('Red')
  })

  it('matches on a stable id when the option carries one', () => {
    expect(optionLabel('opt_1', [{ id: 'opt_1', value: 'RED', label: 'Red' }])).toBe('Red')
  })

  it('falls back to the id for free-form tag fields with no option set', () => {
    expect(optionLabel('ad-hoc', undefined)).toBe('ad-hoc')
    expect(optionLabel('unknown-id', TAGS_OPTIONS)).toBe('unknown-id')
  })
})

describe('coerceForPaste — select across columns', () => {
  it('lands tags in another tag column with the same labels but different ids', () => {
    const result = coerceForPaste(
      {
        display: 'Red, Blue',
        raw: ['z6XudI5z5agprmZ0Qdswb', 'qZ70qtJNVuOOVUhZjjKXs'],
        fieldType: 'TAGS',
      },
      selectField('TAGS', FAVORITE_COLOR_OPTIONS),
      { columnId: 'field1' }
    )
    expect(result).toEqual({
      ok: true,
      value: ['xcqDrNAB3NsGiGJmbqfPp', 'oum39u7ui3FXI0KSe9MDr'],
    })
  })

  it('keeps the raw ids when pasting back into the source column', () => {
    const result = coerceForPaste(
      { display: 'Red', raw: ['z6XudI5z5agprmZ0Qdswb'], fieldType: 'TAGS' },
      selectField('TAGS', TAGS_OPTIONS),
      { columnId: 'field1' }
    )
    expect(result).toEqual({ ok: true, value: ['z6XudI5z5agprmZ0Qdswb'] })
  })

  it('resolves a single-select label into the target column id space', () => {
    const result = coerceForPaste(
      { display: 'Blue', raw: 'qZ70qtJNVuOOVUhZjjKXs', fieldType: 'SINGLE_SELECT' },
      selectField('SINGLE_SELECT', FAVORITE_COLOR_OPTIONS),
      { columnId: 'field1' }
    )
    expect(result).toEqual({ ok: true, value: 'oum39u7ui3FXI0KSe9MDr' })
  })

  it('still skips a label the target column does not offer', () => {
    const result = coerceForPaste(
      { display: 'Green', raw: ['whatever'], fieldType: 'TAGS' },
      selectField('TAGS', FAVORITE_COLOR_OPTIONS),
      { columnId: 'field1' }
    )
    expect(result).toEqual({ ok: false, reason: 'no-matching-option' })
  })
})
