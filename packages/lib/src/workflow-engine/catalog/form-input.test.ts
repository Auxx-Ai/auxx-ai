// packages/lib/src/workflow-engine/catalog/form-input.test.ts

import { describe, expect, it } from 'vitest'
import { BaseType } from '../core/types'
import {
  createFormInputDefaultData,
  type FormInputNodeData,
  formInputManifest,
  formInputNodeDataSchema,
  getFormInputOutputVariables,
  validateFormInputData,
} from './nodes/form-input'
import { NOT_YET_MIGRATED } from './not-yet-migrated'
import { getManifest } from './registry'
import { NodeCategory } from './types'

/**
 * The `form-input` manifest (`plans/kopilot/workflow/15-form-input-migration.md`
 * PR 2).
 *
 * apps/web's catalog-coverage suite already asserts registry ⇄ tracker set
 * equality and parses every manifest's defaults, and the output-resolution
 * parity suite compares this resolver across the browser and server
 * orchestrations. What is covered HERE is what neither of those reaches: the
 * config-DEPENDENT resolver branches, the validator, the keys the schema was
 * widened to accept, and the manifest facts the input-wiring rule depends on.
 */

const NODE_ID = 'n1'

function node(overrides: Partial<FormInputNodeData> = {}): FormInputNodeData {
  return {
    id: NODE_ID,
    type: 'form-input',
    title: 'Form Input',
    selected: false,
    ...createFormInputDefaultData(),
    ...overrides,
  } as FormInputNodeData
}

function paths(variables: Array<{ id: string }>): string[] {
  return variables.map((v) => v.id.replace(`${NODE_ID}.`, ''))
}

describe('form-input manifest', () => {
  it('is registered and off the migration tracker', () => {
    expect(getManifest('form-input')).toBe(formInputManifest)
    expect(NOT_YET_MIGRATED).not.toContain('form-input')
  })

  /**
   * Load-bearing, not cosmetic: `graph-edit/validate.ts` reads the source
   * category (`isInputNodePair`) and the canvas reads the
   * same one, so a different category silently breaks form-input → manual
   * wiring in both. `branches` must stay absent for the same reason — the
   * handle exception is written against the default `['source']` set.
   */
  it('declares INPUT category, no branches, and no single run', () => {
    expect(formInputManifest.category).toBe(NodeCategory.INPUT)
    expect(formInputManifest.connection.branches).toBeUndefined()
    expect(formInputManifest.connection.canRunSingle).toBe(false)
    expect(formInputManifest.agent?.authorable).toBe(true)
  })

  it('resolves the icon name from inputType, falling back to its static icon', () => {
    expect(formInputManifest.getIcon?.(node({ inputType: BaseType.FILE }))).toBe('file')
    expect(formInputManifest.getIcon?.(node({ inputType: BaseType.CURRENCY }))).toBe('dollar-sign')
    expect(formInputManifest.getIcon?.(node({ inputType: undefined as never }))).toBe('type')
  })

  it('parses its own defaults against its configSchema', () => {
    const parsed = formInputNodeDataSchema.safeParse({
      id: 'test-node',
      type: 'form-input',
      title: formInputManifest.displayName,
      ...formInputManifest.defaultData(),
    })
    expect(parsed.success).toBe(true)
  })
})

describe('form-input schema (widened to the interface)', () => {
  it('accepts typeOptions.string, boolean.label, file categories and position', () => {
    const parsed = formInputNodeDataSchema.safeParse({
      ...node(),
      position: 'a0',
      typeOptions: {
        string: { multiline: true, minLength: 1, maxLength: 500 },
        boolean: { variant: 'switch', label: 'Enable notifications' },
        file: {
          allowMultiple: true,
          maxFiles: 3,
          allowedFileTypes: ['document', 'image'],
          allowedFileExtensions: ['.dwg'],
        },
      },
    })
    expect(parsed.success).toBe(true)
  })

  /** The processor only ever reads `currencyCode`; the rest settle as optional. */
  it('accepts a currency option set carrying only currencyCode', () => {
    const parsed = formInputNodeDataSchema.safeParse({
      ...node({ inputType: BaseType.CURRENCY }),
      typeOptions: { currency: { currencyCode: 'EUR' } },
    })
    expect(parsed.success).toBe(true)
  })

  it('still rejects an unknown file type category', () => {
    const parsed = formInputNodeDataSchema.safeParse({
      ...node({ inputType: BaseType.FILE }),
      typeOptions: { file: { allowMultiple: false, allowedFileTypes: ['spreadsheet'] } },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('validateFormInputData', () => {
  /**
   * The schema deliberately has no `.min(1)` on `label` (a fresh node has an
   * empty one and defaults must parse) — required-ness lives here instead,
   * with the same field and message.
   */
  it('flags a missing label as an error', () => {
    const result = validateFormInputData(node({ label: '   ' }))
    expect(result.isValid).toBe(false)
    expect(result.errors).toContainEqual({
      field: 'label',
      message: 'Label is required',
      type: 'error',
    })
  })

  it('flags an option-less ENUM as a warning, not a blocker', () => {
    const result = validateFormInputData(node({ label: 'Priority', inputType: BaseType.ENUM }))
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([
      { field: 'typeOptions.enum', message: 'At least one option is required', type: 'warning' },
    ])
  })

  it('passes a configured ENUM field', () => {
    const result = validateFormInputData(
      node({
        label: 'Priority',
        inputType: BaseType.ENUM,
        typeOptions: { enum: [{ label: 'High', value: 'high' }] },
      })
    )
    expect(result).toEqual({ isValid: true, errors: [] })
  })
})

describe('getFormInputOutputVariables', () => {
  const COMMON = ['label', 'inputType', 'isEmpty']

  it('advertises a simple `value` plus the common variables by default', () => {
    const variables = getFormInputOutputVariables(node({ label: 'Subject' }), NODE_ID)
    expect(paths(variables)).toEqual(['value', ...COMMON])
    expect(variables[0]?.type).toBe(BaseType.STRING)
  })

  it('carries the configured inputType onto the simple `value`', () => {
    const variables = getFormInputOutputVariables(node({ inputType: BaseType.EMAIL }), NODE_ID)
    expect(variables[0]?.type).toBe(BaseType.EMAIL)
  })

  it('expands ADDRESS into its six components', () => {
    const variables = getFormInputOutputVariables(node({ inputType: BaseType.ADDRESS }), NODE_ID)
    expect(paths(variables)).toEqual(['value', ...COMMON])
    expect(Object.keys(variables[0]?.properties ?? {})).toEqual([
      'street1',
      'street2',
      'city',
      'state',
      'zipCode',
      'country',
    ])
  })

  it('advertises a single `file` unless allowMultiple is set', () => {
    const single = getFormInputOutputVariables(node({ inputType: BaseType.FILE }), NODE_ID)
    expect(paths(single)).toEqual(['file', ...COMMON])
    expect(Object.keys(single[0]?.properties ?? {})).toEqual([
      'id',
      'filename',
      'size',
      'mimeType',
      'url',
    ])

    const multiple = getFormInputOutputVariables(
      node({ inputType: BaseType.FILE, typeOptions: { file: { allowMultiple: true } } }),
      NODE_ID
    )
    expect(paths(multiple)).toEqual(['files', 'fileCount', ...COMMON])
    expect(multiple[0]?.type).toBe(BaseType.ARRAY)
    expect(multiple[0]?.items?.type).toBe(BaseType.FILE)
  })

  it('advertises values/count for TAGS and ARRAY alike', () => {
    for (const inputType of [BaseType.TAGS, BaseType.ARRAY]) {
      const variables = getFormInputOutputVariables(node({ inputType }), NODE_ID)
      expect(paths(variables)).toEqual(['values', 'count', ...COMMON])
    }
  })

  it('expands CURRENCY into amount/currency/formatted', () => {
    const variables = getFormInputOutputVariables(node({ inputType: BaseType.CURRENCY }), NODE_ID)
    expect(paths(variables)).toEqual(['value', ...COMMON])
    expect(Object.keys(variables[0]?.properties ?? {})).toEqual(['amount', 'currency', 'formatted'])
  })
})
