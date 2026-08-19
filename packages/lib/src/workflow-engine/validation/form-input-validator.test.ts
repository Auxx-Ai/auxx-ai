// packages/lib/src/workflow-engine/validation/form-input-validator.test.ts

import { describe, expect, it } from 'vitest'
import { BaseType } from '../core/types'
import { validateFormInputs } from './form-input-validator'

const NODE_ID = 'node_select'

/** A one-node graph in the persisted shape `extractFormInputConfigs` reads. */
const graph = (data: Record<string, unknown>) => ({
  nodes: [{ id: NODE_ID, data: { type: 'form-input', label: 'Areas', ...data } }],
  edges: [],
})

const OPTIONS = [
  { label: 'Billing', value: 'billing' },
  { label: 'Shipping', value: 'shipping' },
]

describe('validateFormInputs — SELECT', () => {
  it('accepts a declared option on a single select', () => {
    const result = validateFormInputs(
      graph({ inputType: BaseType.ENUM, typeOptions: { enum: { options: OPTIONS } } }),
      { [NODE_ID]: 'billing' }
    )
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('rejects an undeclared option on a single select', () => {
    const result = validateFormInputs(
      graph({ inputType: BaseType.ENUM, typeOptions: { enum: { options: OPTIONS } } }),
      { [NODE_ID]: 'refunds' }
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toBe('Invalid selection')
  })

  /**
   * The regression this guards: the single-select comparison was
   * `validValues.includes(String(value))`, and `String(['billing','shipping'])`
   * is `"billing,shipping"` — a perfectly valid submission rejected as
   * "Invalid selection".
   */
  it('accepts an array of declared options on a multiple select', () => {
    const result = validateFormInputs(
      graph({
        inputType: BaseType.ENUM,
        typeOptions: { enum: { multiple: true, options: OPTIONS } },
      }),
      { [NODE_ID]: ['billing', 'shipping'] }
    )
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('rejects an array containing an undeclared option', () => {
    const result = validateFormInputs(
      graph({
        inputType: BaseType.ENUM,
        typeOptions: { enum: { multiple: true, options: OPTIONS } },
      }),
      { [NODE_ID]: ['billing', 'refunds'] }
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toBe('Invalid selection')
  })

  /**
   * `[]` passes every scalar emptiness test (`undefined`/`null`/`''`), so a
   * required multi select would otherwise submit with nothing picked.
   */
  it('treats an empty array as missing on a required multiple select', () => {
    const result = validateFormInputs(
      graph({
        inputType: BaseType.ENUM,
        required: true,
        typeOptions: { enum: { multiple: true, options: OPTIONS } },
      }),
      { [NODE_ID]: [] }
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toBe('Areas is required')
  })

  it('lets an optional multiple select submit nothing', () => {
    const result = validateFormInputs(
      graph({
        inputType: BaseType.ENUM,
        typeOptions: { enum: { multiple: true, options: OPTIONS } },
      }),
      { [NODE_ID]: [] }
    )
    expect(result).toEqual({ valid: true, errors: [] })
  })
})
