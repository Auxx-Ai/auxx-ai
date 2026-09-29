// packages/lib/src/resources/events/__tests__/captured-shape.test.ts
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
import type { FieldValueService } from '../../../field-values/field-value-service'
import { captureEventData } from '../extract-event-data'

const RECORD_ID = 'build-def:build-1' as RecordId
const PART_RECORD_ID = 'part-def:part-1' as RecordId

/** The BaseFieldValue columns every variant carries; irrelevant to the shape. */
const base = {
  id: 'fv-1',
  entityId: 'build-1',
  fieldId: 'f',
  organizationId: 'org-1',
  sortKey: '0',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
}

const FIELDS = [
  { id: 'f-part', systemAttribute: 'build_part', type: 'RELATIONSHIP' },
  { id: 'f-type', systemAttribute: 'build_status', type: 'SINGLE_SELECT' },
  { id: 'f-qty', systemAttribute: 'build_quantity_produced', type: 'NUMBER' },
  { id: 'f-cost', systemAttribute: 'build_material_cost', type: 'CURRENCY' },
  { id: 'f-account', systemAttribute: 'build_notes', type: 'TEXT' },
  { id: 'f-occurred', systemAttribute: 'build_completed_at', type: 'DATETIME' },
  { id: 'f-explode', systemAttribute: 'part_kind_confirmed', type: 'CHECKBOX' },
]

/**
 * `getValues` arrays the ARRAY_RETURN types and leaves scalars bare — this stub
 * reproduces that split, which is the behaviour the readers actually meet.
 */
function serviceReturning(): FieldValueService {
  const values = new Map<string, TypedFieldValue | TypedFieldValue[]>([
    ['f-part', [{ ...base, type: 'relationship', recordId: PART_RECORD_ID }] as TypedFieldValue[]],
    ['f-type', [{ ...base, type: 'option', optionId: 'completed' }] as TypedFieldValue[]],
    ['f-qty', { ...base, type: 'number', value: 10 } as TypedFieldValue],
    ['f-cost', { ...base, type: 'number', value: 9822 } as TypedFieldValue],
    ['f-account', { ...base, type: 'text', value: 'first batch' } as TypedFieldValue],
    ['f-occurred', { ...base, type: 'date', value: '2026-08-31T23:55:10.318Z' } as TypedFieldValue],
    ['f-explode', { ...base, type: 'boolean', value: false } as TypedFieldValue],
  ])
  return { getValues: async () => values } as unknown as FieldValueService
}

describe('captureEventData — the shape delete consumers actually receive', () => {
  it('emits RELATIONSHIP as an ARRAY of RecordId strings, never a bare string', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(captured.build_part).toEqual([PART_RECORD_ID])
    // The regression this whole task is about: the natural-looking test below is
    // what a reader written against the create chain would satisfy, and it fails.
    expect(typeof captured.build_part).not.toBe('string')
  })

  it('emits SINGLE_SELECT as an ARRAY of option ids', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(captured.build_status).toEqual(['completed'])
    expect(typeof captured.build_status).not.toBe('string')
  })

  it('keeps a to-ONE relation an array — the shape is not count-dependent', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(Array.isArray(captured.build_part)).toBe(true)
    expect((captured.build_part as unknown[]).length).toBe(1)
  })

  it('emits scalars bare — NUMBER, CURRENCY, TEXT, CHECKBOX', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(captured.build_quantity_produced).toBe(10)
    expect(captured.build_material_cost).toBe(9822)
    expect(captured.build_notes).toBe('first batch')
    expect(captured.part_kind_confirmed).toBe(false)
  })

  it('emits DATETIME as a string, not a Date', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, FIELDS)

    expect(typeof captured.build_completed_at).toBe('string')
    expect(captured.build_completed_at).not.toBeInstanceOf(Date)
  })

  it('keys by systemAttribute and drops fields that have none', async () => {
    const captured = await captureEventData(serviceReturning(), RECORD_ID, [
      ...FIELDS,
      { id: 'f-custom', systemAttribute: null, type: 'TEXT' },
    ])

    expect(Object.keys(captured).sort()).toEqual(FIELDS.map((f) => f.systemAttribute).sort())
  })
})
