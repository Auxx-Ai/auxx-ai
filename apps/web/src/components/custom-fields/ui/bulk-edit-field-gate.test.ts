// apps/web/src/components/custom-fields/ui/bulk-edit-field-gate.test.ts
// B6 (multi-email plan): the bulk editor excludes multi-value EMAIL/URL/PHONE
// fields (whole-list replace across N records would wipe N alias lists) with a
// per-record hint, while single-value and non-scalar-multi fields stay editable.

import { describe, expect, it } from 'vitest'
import { getBulkEditFieldGate } from './bulk-edit-field-gate'

describe('getBulkEditFieldGate', () => {
  it.each([
    'EMAIL',
    'URL',
    'PHONE',
    'PHONE_INTL',
  ])('disables a multi-value %s field with the per-record hint', (fieldType) => {
    expect(getBulkEditFieldGate({ fieldType, options: { multi: true } }, 1)).toEqual({
      disabled: true,
      description: 'Multi-value fields are edited per record',
    })
  })

  it('keeps single-value EMAIL editable', () => {
    expect(getBulkEditFieldGate({ fieldType: 'EMAIL', options: {} }, 3)).toEqual({
      disabled: false,
    })
  })

  it('does not exclude multi TEXT (only EMAIL/URL/PHONE are locked out)', () => {
    expect(getBulkEditFieldGate({ fieldType: 'TEXT', options: { multi: true } }, 3)).toEqual({
      disabled: false,
    })
  })

  it('disables unique fields only when editing more than one record', () => {
    expect(getBulkEditFieldGate({ isUnique: true, fieldType: 'TEXT' }, 2)).toEqual({
      disabled: true,
      description: 'Unique fields cannot be bulk edited',
    })
    expect(getBulkEditFieldGate({ isUnique: true, fieldType: 'TEXT' }, 1)).toEqual({
      disabled: false,
    })
  })

  it('multi EMAIL stays excluded even for a single selected record', () => {
    expect(getBulkEditFieldGate({ fieldType: 'EMAIL', options: { multi: true } }, 1).disabled).toBe(
      true
    )
  })
})
