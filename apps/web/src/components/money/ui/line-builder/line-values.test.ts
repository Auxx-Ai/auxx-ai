// apps/web/src/components/money/ui/line-builder/line-values.test.ts

import { FieldType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LINE_VALUES, diffLineValues, linePatchToFieldValues } from './line-values'

describe('linePatchToFieldValues', () => {
  it('maps semantic keys to system attributes and field types', () => {
    expect(
      linePatchToFieldValues({
        name: 'Drain repair',
        qty: 2,
        unit: 'hour',
        unitPriceCents: 12500,
      })
    ).toEqual([
      { fieldId: 'line_item_name', value: 'Drain repair', fieldType: FieldType.TEXT },
      { fieldId: 'line_item_qty', value: 2, fieldType: FieldType.NUMBER },
      { fieldId: 'line_item_unit', value: 'hour', fieldType: FieldType.SINGLE_SELECT },
      {
        fieldId: 'line_item_unit_price',
        value: 12500,
        fieldType: FieldType.CURRENCY,
      },
    ])
  })

  it('retains explicit null and false while omitting absent keys', () => {
    expect(linePatchToFieldValues({ description: null, taxable: false })).toEqual([
      { fieldId: 'line_item_description', value: null, fieldType: FieldType.TEXT },
      { fieldId: 'line_item_taxable', value: false, fieldType: FieldType.CHECKBOX },
    ])
  })

  it('returns only changed snapshot values', () => {
    const after = { ...DEFAULT_LINE_VALUES, qty: 3, unit: null, optional: true }
    expect(diffLineValues(DEFAULT_LINE_VALUES, after)).toEqual({
      qty: 3,
      unit: null,
      optional: true,
    })
  })
})
