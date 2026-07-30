// apps/web/src/lib/agents/bindings/arg-to-field-type.test.ts

import { FieldType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { argToFieldType, isVarFieldTypeCompatible } from './arg-to-field-type'

describe('argToFieldType', () => {
  it('maps string → TEXT', () => {
    expect(argToFieldType({ type: 'string' })).toEqual({
      supported: true,
      fieldType: FieldType.TEXT,
    })
  })

  it('maps string + enum → SINGLE_SELECT with options', () => {
    const result = argToFieldType({ type: 'string', enum: ['open', 'closed'] })
    expect(result).toEqual({
      supported: true,
      fieldType: FieldType.SINGLE_SELECT,
      options: {
        options: [
          { value: 'open', label: 'open' },
          { value: 'closed', label: 'closed' },
        ],
      },
    })
  })

  it('maps number and integer → NUMBER', () => {
    expect(argToFieldType({ type: 'number' })).toMatchObject({ fieldType: FieldType.NUMBER })
    expect(argToFieldType({ type: 'integer' })).toMatchObject({ fieldType: FieldType.NUMBER })
  })

  it('maps boolean → CHECKBOX', () => {
    expect(argToFieldType({ type: 'boolean' })).toMatchObject({ fieldType: FieldType.CHECKBOX })
  })

  it('marks object and array as unsupported (scalar-only v6)', () => {
    expect(argToFieldType({ type: 'object' }).supported).toBe(false)
    expect(argToFieldType({ type: 'array' }).supported).toBe(false)
  })

  it('handles nullable union types by taking the first non-null', () => {
    expect(argToFieldType({ type: ['string', 'null'] })).toMatchObject({
      fieldType: FieldType.TEXT,
    })
  })

  it('falls back to TEXT for unknown/absent types', () => {
    expect(argToFieldType({})).toMatchObject({ fieldType: FieldType.TEXT })
  })
})

describe('isVarFieldTypeCompatible', () => {
  it('matches exact field types', () => {
    expect(isVarFieldTypeCompatible(FieldType.NUMBER, FieldType.NUMBER)).toBe(true)
    expect(isVarFieldTypeCompatible(FieldType.TEXT, FieldType.TEXT)).toBe(true)
  })

  it('treats TEXT args as compatible with text-like var types', () => {
    expect(isVarFieldTypeCompatible(FieldType.TEXT, FieldType.EMAIL)).toBe(true)
    expect(isVarFieldTypeCompatible(FieldType.TEXT, FieldType.URL)).toBe(true)
  })

  // Delegates to the workflow engine's coercion-aware matrix (#794), so the
  // scalar pairs the workflow var picker allows are allowed here too: STRING is
  // the most permissive destination, and NUMBER accepts parseable strings.
  it('allows the scalar coercions the workflow variable picker allows', () => {
    expect(isVarFieldTypeCompatible(FieldType.TEXT, FieldType.NUMBER)).toBe(true)
    expect(isVarFieldTypeCompatible(FieldType.NUMBER, FieldType.TEXT)).toBe(true)
  })

  it('rejects structured var types for scalar args', () => {
    expect(isVarFieldTypeCompatible(FieldType.NUMBER, FieldType.MULTI_SELECT)).toBe(false)
    expect(isVarFieldTypeCompatible(FieldType.TEXT, FieldType.MULTI_SELECT)).toBe(false)
  })
})
