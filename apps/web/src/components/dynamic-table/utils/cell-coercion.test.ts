// apps/web/src/components/dynamic-table/utils/cell-coercion.test.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { toFieldId } from '@auxx/types/field'
import { afterEach, describe, expect, it } from 'vitest'
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

/**
 * Paste checked only the def PREFIX of a pasted RecordId, never that the target
 * still existed — so copying a dangling cell cloned the broken reference into
 * another row. `isMissingRecord` is the verdict from `record.checkMissingTargets`,
 * which resolves the target's own backing table; it is never "the client could
 * not resolve it", because a record this member cannot see is alive.
 */
describe('coerceForPaste — dangling relationship targets', () => {
  const DEAD = 'work_order:dead_instance_id'
  const LIVE = 'work_order:live_instance_id'

  function relationshipField(): ResourceField {
    return {
      id: toFieldId('rel'),
      key: 'rel',
      label: 'Work Order',
      type: 'string',
      fieldType: 'RELATIONSHIP',
      options: {
        relationship: { relationshipType: 'has_many', relatedEntityDefinitionId: 'work_order' },
      },
      capabilities: { updatable: true },
    } as unknown as ResourceField
  }

  const isMissingRecord = (recordId: string) => recordId === DEAD

  it('refuses a lossless RecordId whose target is confirmed deleted', () => {
    const result = coerceForPaste(
      { display: 'Dead WO', fieldType: 'RELATIONSHIP', recordId: DEAD },
      relationshipField(),
      { columnId: 'rel', isMissingRecord }
    )
    expect(result).toEqual({ ok: false, reason: 'no-matching-record' })
  })

  it('still accepts a live RecordId', () => {
    const result = coerceForPaste(
      { display: 'Live WO', fieldType: 'RELATIONSHIP', recordId: LIVE },
      relationshipField(),
      { columnId: 'rel', isMissingRecord }
    )
    expect(result).toEqual({ ok: true, value: LIVE })
  })

  it('drops only the dead legs of a has_many RecordId round-trip', () => {
    const result = coerceForPaste(
      { display: `${LIVE}, ${DEAD}`, fieldType: 'RELATIONSHIP' },
      relationshipField(),
      { columnId: 'rel', isMissingRecord }
    )
    expect(result).toEqual({ ok: true, value: [LIVE] })
  })

  it('skips the cell when every leg of the round-trip is dead', () => {
    const result = coerceForPaste(
      { display: DEAD, fieldType: 'RELATIONSHIP' },
      relationshipField(),
      { columnId: 'rel', isMissingRecord }
    )
    expect(result).toEqual({ ok: false, reason: 'no-matching-record' })
  })

  it('is unchanged when no verdict is supplied — the check fails OPEN', () => {
    // No callback (or a failed/timed-out existence call) must never block a
    // paste: the reference is already broken, and refusing a valid paste is the
    // worse failure.
    const result = coerceForPaste(
      { display: 'Dead WO', fieldType: 'RELATIONSHIP', recordId: DEAD },
      relationshipField(),
      { columnId: 'rel' }
    )
    expect(result).toEqual({ ok: true, value: DEAD })
  })
})

/**
 * A DATE field is a calendar day stored as UTC midnight. Pasting "May 10" must
 * land on May 10 in every browser zone; only DATETIME keeps the instant.
 */
describe('coerceForPaste - calendar days', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  function dateField(fieldType: 'DATE' | 'DATETIME'): ResourceField {
    return {
      id: toFieldId('when'),
      key: 'when',
      label: 'When',
      type: 'string',
      fieldType,
      capabilities: { updatable: true },
    } as unknown as ResourceField
  }

  const MAY_10 = '2026-05-10T00:00:00.000Z'

  for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'Europe/Berlin']) {
    describe(`in ${tz}`, () => {
      it('takes a bare day as written', () => {
        process.env.TZ = tz
        const result = coerceForPaste({ display: '2026-05-10' }, dateField('DATE'), {
          columnId: 'when',
        })
        expect(result).toEqual({ ok: true, value: MAY_10 })
      })

      it('keeps a stored DATE value on its day', () => {
        process.env.TZ = tz
        const result = coerceForPaste({ display: 'May 10, 2026', raw: MAY_10 }, dateField('DATE'), {
          columnId: 'when',
        })
        expect(result).toEqual({ ok: true, value: MAY_10 })
      })

      it('reads a formatted day in the local zone', () => {
        process.env.TZ = tz
        const result = coerceForPaste({ display: 'May 10, 2026' }, dateField('DATE'), {
          columnId: 'when',
        })
        expect(result).toEqual({ ok: true, value: MAY_10 })
      })
    })
  }

  it('keeps the local calendar day of a pasted instant', () => {
    process.env.TZ = 'America/Los_Angeles'
    // 03:00Z on May 10 is still the evening of May 9 in Los Angeles.
    const result = coerceForPaste(
      { display: 'May 9, 2026 8:00 PM', raw: '2026-05-10T03:00:00.000Z', fieldType: 'DATETIME' },
      dateField('DATE'),
      { columnId: 'when' }
    )
    expect(result).toEqual({ ok: true, value: '2026-05-09T00:00:00.000Z' })
  })

  it('leaves DATETIME as the instant', () => {
    process.env.TZ = 'Pacific/Auckland'
    const result = coerceForPaste({ display: '2026-05-10T03:00:00.000Z' }, dateField('DATETIME'), {
      columnId: 'when',
    })
    expect(result).toEqual({ ok: true, value: '2026-05-10T03:00:00.000Z' })
  })

  it('still rejects text that is not a date', () => {
    const result = coerceForPaste({ display: 'sometime soon' }, dateField('DATE'), {
      columnId: 'when',
    })
    expect(result).toEqual({ ok: false, reason: 'not-a-date' })
  })
})
