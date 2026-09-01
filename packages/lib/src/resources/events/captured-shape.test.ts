// packages/lib/src/resources/events/captured-shape.test.ts
//
// The contract every pre-delete hook, post-delete hook and lifecycle-event
// consumer depends on and that nothing else states: WHAT SHAPE does
// `captureEventData` produce, per field type?
//
// 🛑 This test exists because the answer is NOT "the same as a create event".
// A create threads the caller's own input (a relation is a bare
// `'defId:instId'` string); a capture reads through `getValues`, which arrays
// every `ARRAY_RETURN_FIELD_TYPES` member regardless of value count. Five
// readers assumed the create shape on the delete chain, and each one silently
// matched nothing rather than failing — see
// `plans/money/tasks/24-captured-value-shape.md`.
//
// If a change here forces this file to be edited, that is a contract change for
// the guards and the worker's roll-up handlers. Fix them in the same commit.

import type { TypedFieldValue } from '@auxx/types/field-value'
import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it } from 'vitest'
import type { FieldValueService } from '../../field-values/field-value-service'
import { captureEventData } from './extract-event-data'

const RECORD_ID = 'movement-def:movement-1' as RecordId
const PART_RECORD_ID = 'part-def:part-1' as RecordId

/** The BaseFieldValue columns every variant carries; irrelevant to the shape. */
const base = {
  id: 'fv-1',
  entityId: 'movement-1',
  fieldId: 'f',
  organizationId: 'org-1',
  sortKey: '0',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
}

const FIELDS = [
  { id: 'f-part', systemAttribute: 'stock_movement_part', type: 'RELATIONSHIP' },
  { id: 'f-type', systemAttribute: 'stock_movement_type', type: 'SINGLE_SELECT' },
  { id: 'f-qty', systemAttribute: 'stock_movement_quantity', type: 'NUMBER' },
  { id: 'f-cost', systemAttribute: 'stock_movement_unit_cost', type: 'CURRENCY' },
  { id: 'f-account', systemAttribute: 'stock_movement_gl_account', type: 'TEXT' },
  { id: 'f-occurred', systemAttribute: 'stock_movement_occurred_at', type: 'DATETIME' },
  { id: 'f-explode', systemAttribute: 'stock_movement_adjust_subparts', type: 'CHECKBOX' },
]

/**
 * `getValues` arrays the ARRAY_RETURN types and leaves scalars bare — this stub
 * reproduces that split, which is the behaviour the readers actually meet.
 */
function serviceReturning(): FieldValueService {
  const values = new Map<string, TypedFieldValue | TypedFieldValue[]>([
    ['f-part', [{ ...base, type: 'relationship', recordId: PART_RECORD_ID }] as TypedFieldValue[]],
    ['f-type', [{ ...base, type: 'option', optionId: 'build_consume' }] as TypedFieldValue[]],
    ['f-qty', { ...base, type: 'number', value: -10 } as TypedFieldValue],
    ['f-cost', { ...base, type: 'number', value: 9822 } as TypedFieldValue],
    ['f-account', { ...base, type: 'text', value: 'inventory_raw_materials' } as TypedFieldValue],
    ['f-occurred', { ...base, type: 'date', value: '2026-08-31T23:55:10.318Z' } as TypedFieldValue],
    ['f-explode', { ...base, type: 'boolean', value: false } as TypedFieldValue],
  ])
  return { getValues: async () => values } as unknown as FieldValueService
}

describe('captureEventData — the shape delete consumers actually receive', () => {
  it('emits RELATIONSHIP as an ARRAY of RecordId strings, never a bare string', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(captured.stock_movement_part).toEqual([PART_RECORD_ID])
    // The regression this whole task is about: the natural-looking test below is
    // what a reader written against the create chain would satisfy, and it fails.
    expect(typeof captured.stock_movement_part).not.toBe('string')
  })

  it('emits SINGLE_SELECT as an ARRAY of option ids', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(captured.stock_movement_type).toEqual(['build_consume'])
    expect(typeof captured.stock_movement_type).not.toBe('string')
  })

  it('keeps a to-ONE relation an array — the shape is not count-dependent', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(Array.isArray(captured.stock_movement_part)).toBe(true)
    expect((captured.stock_movement_part as unknown[]).length).toBe(1)
  })

  it('emits scalars bare — NUMBER, CURRENCY, TEXT, CHECKBOX', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(captured.stock_movement_quantity).toBe(-10)
    expect(captured.stock_movement_unit_cost).toBe(9822)
    expect(captured.stock_movement_gl_account).toBe('inventory_raw_materials')
    expect(captured.stock_movement_adjust_subparts).toBe(false)
  })

  it('emits DATETIME as a string, not a Date', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(typeof captured.stock_movement_occurred_at).toBe('string')
    expect(captured.stock_movement_occurred_at).not.toBeInstanceOf(Date)
  })

  it('keys by systemAttribute and drops fields that have none', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, [
      ...FIELDS,
      { id: 'f-custom', systemAttribute: null, type: 'TEXT' },
    ])

    expect(Object.keys(captured).sort()).toEqual(FIELDS.map((f) => f.systemAttribute).sort())
  })
})
