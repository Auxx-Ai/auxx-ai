// packages/lib/src/conditions/__tests__/date-range.test.ts

import { describe, expect, it } from 'vitest'
import { BaseType } from '../../workflow-engine/core/types'
import { parseDateRange } from '../date-range'
import { FieldInputMode, resolveFieldInputConfig } from '../field-input-modes'
import { getOperatorsForBaseType, getOperatorsForFieldType } from '../operator-definitions'

describe('parseDateRange', () => {
  it('parses both ends', () => {
    expect(parseDateRange({ from: '2026-08-01', to: '2026-09-01' })).toEqual({
      from: new Date('2026-08-01'),
      to: new Date('2026-09-01'),
    })
  })

  it('accepts one end', () => {
    expect(parseDateRange({ from: '2026-08-01' })).toEqual({ from: new Date('2026-08-01') })
    expect(parseDateRange({ to: '2026-09-01', from: '' })).toEqual({ to: new Date('2026-09-01') })
  })

  it.each([
    ['null', null],
    ['a string', '2026-08-01'],
    ['an array', ['2026-08-01', '2026-09-01']],
    ['no ends', {}],
    ['a garbage end', { from: 'soon' }],
    ['an object end', { from: { date: '2026-08-01' } }],
    ['from after to', { from: '2026-09-01', to: '2026-08-01' }],
    ['from equal to', { from: '2026-08-01', to: '2026-08-01' }],
  ])('rejects %s', (_label, value) => {
    expect(parseDateRange(value)).toBeNull()
  })
})

describe('between in the registry', () => {
  it('is offered for DATE and DATETIME fields with a range input', () => {
    for (const fieldType of ['DATE', 'DATETIME']) {
      expect(getOperatorsForFieldType(fieldType).map((op) => op.key)).toContain('between')
      expect(resolveFieldInputConfig(fieldType, 'between').mode).toBe(FieldInputMode.RANGE)
    }
    expect(getOperatorsForFieldType('TIME').map((op) => op.key)).not.toContain('between')
  })

  it('is not offered to typed workflow variables, which cannot hold a range', () => {
    expect(getOperatorsForBaseType(BaseType.DATETIME).map((op) => op.key)).not.toContain('between')
  })
})
