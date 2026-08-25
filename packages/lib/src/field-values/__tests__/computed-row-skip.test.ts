// packages/lib/src/field-values/__tests__/computed-row-skip.test.ts

/**
 * A stored `FieldValue` row on a COMPUTED field type warns and skips — it does
 * not throw (`plans/field-values/name-field-writes.md` §7).
 *
 * CALC is the only computed type and it is never persisted (its converter's
 * `toTypedInput` returns `null`), so a row under one was invented by a caller
 * that went around the converters — a raw insert in a migration, a connector
 * sink, a seeder. `rowToTypedValue` used to answer that with a `throw`, which
 * turns ONE bad row into a hard failure of every read of that field, for every
 * caller, forever. That is the poison pill §7 asked to be defused before the
 * NAME work could rely on it.
 */

import type { FieldType } from '@auxx/database/types'

// Intercept ONLY this module's logger, leaving every other scope real — the
// import graph builds a lot of loggers at module load and none of them should
// change shape for this file.
const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }))
vi.mock('@auxx/logger', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const real = actual.createScopedLogger as (scope: string, options?: unknown) => object
  return {
    ...actual,
    createScopedLogger: (scope: string, options?: unknown) =>
      scope === 'field-value-helpers' ? { ...real(scope), warn: logWarn } : real(scope, options),
  }
})

import {
  isComputedStoredFieldType,
  rowsToTypedValues,
  rowToTypedValue,
} from '../field-value-helpers'
import type { FieldValueRow } from '../types'

const CALC = 'CALC' as FieldType
const TEXT = 'TEXT' as FieldType

const WARNING = 'Stored FieldValue row on a computed field type; skipping it'

/** The row a bypassing caller would have written. */
const calcRow = {
  id: 'fv_calc',
  entityId: 'con_1',
  fieldId: 'fld_margin',
  sortKey: 'a0',
  valueText: '42',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
} as unknown as FieldValueRow

beforeEach(() => {
  logWarn.mockReset()
})

describe('isComputedStoredFieldType', () => {
  it('names CALC and nothing in the stored families', () => {
    expect(isComputedStoredFieldType(CALC)).toBe(true)
    for (const type of ['TEXT', 'NAME', 'NUMBER', 'DATE', 'JSON', 'RELATIONSHIP', 'ACTOR']) {
      expect(isComputedStoredFieldType(type as FieldType)).toBe(false)
    }
  })

  it('does NOT name NAME — a NAME field is `json`, not `computed`', () => {
    // NAME is composed on read (§4) but its VALUE TYPE is `json`, so the stray
    // rows §6 leaves in place were never on the throwing path. The §7 defusal
    // and the §4 composition are independent fixes.
    expect(isComputedStoredFieldType('NAME' as FieldType)).toBe(false)
  })
})

describe('rowToTypedValue — computed rows warn instead of throwing', () => {
  it('no longer throws on an invented CALC row', () => {
    expect(() => rowToTypedValue(calcRow, CALC)).not.toThrow()
  })

  it('warns with the row identity so the invented row can be found', () => {
    rowToTypedValue(calcRow, CALC)
    expect(logWarn).toHaveBeenCalledWith(WARNING, {
      fieldId: 'fld_margin',
      entityId: 'con_1',
      fieldType: 'CALC',
    })
  })
})

describe('rowsToTypedValues — the read seam skips the row', () => {
  it('reads as unset for a single-value field', () => {
    expect(rowsToTypedValues([calcRow], CALC, false)).toBeNull()
    expect(logWarn).toHaveBeenCalledWith(WARNING, expect.objectContaining({ fieldType: 'CALC' }))
  })

  it('reads as empty for an array-return field', () => {
    expect(rowsToTypedValues([calcRow], CALC, true)).toEqual([])
  })

  it('says nothing when there is no invented row to skip', () => {
    expect(rowsToTypedValues([], CALC, false)).toBeNull()
    expect(rowsToTypedValues([], CALC, true)).toEqual([])
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('still converts non-computed types normally and silently', () => {
    expect(rowsToTypedValues([calcRow], TEXT, false)).toMatchObject({ type: 'text', value: '42' })
    expect(logWarn).not.toHaveBeenCalled()
  })
})
