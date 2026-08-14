// apps/web/src/components/resources/hooks/use-seed-created-record.test.ts
//
// Regression: the create-dialog optimistic seed used to convert a multi-email
// array through the scalar converter branch — `String(array)` — so the records
// table rendered "a@x.io,b@y.io" in ONE CopyableLinkCell right after create,
// and the joined string survived every list refetch (the fetch queue skips
// keys that already hold a value) until a full page reload. With
// `fieldOptions` threaded through (the #1623 third-param pattern) the seed
// stores the same ordered TypedFieldValueInput[] shape `fieldValue.batchGet`
// delivers.

import type { RecordId } from '@auxx/lib/resources/client'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildFieldValueKey, useFieldValueStore } from '../store/field-value-store'
import { useSeedCreatedRecord } from './use-seed-created-record'

const DEF_ID = 'cmdefcontact1234567890abcd'
const EMAIL_FIELD = `${DEF_ID}:cmfldemail1234567890abcd`
const NOTES_FIELD = `${DEF_ID}:cmfldnotes1234567890abcd`

const recordId = `${DEF_ID}:rec1` as RecordId

const instance = {
  id: 'rec1',
  displayName: 'Anna Multimail',
  secondaryDisplayValue: null,
  avatarUrl: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
}

function seed(
  values: Parameters<ReturnType<typeof useSeedCreatedRecord>['seedCreatedRecord']>[0]['values']
) {
  const { result } = renderHook(() => useSeedCreatedRecord())
  result.current.seedCreatedRecord({
    entityDefinitionId: DEF_ID,
    recordId,
    instance,
    values,
  })
}

beforeEach(() => {
  useFieldValueStore.getState().clearAll()
})

describe('useSeedCreatedRecord — options.multi fields', () => {
  it('seeds a multi EMAIL array as TypedFieldValueInput[] (primary first), not a comma string', () => {
    seed([
      {
        fieldId: EMAIL_FIELD,
        value: ['anna.work@corp.io', 'anna@example.com'],
        fieldType: 'EMAIL',
        fieldOptions: { multi: true },
      },
    ])

    const value = useFieldValueStore.getState().values[buildFieldValueKey(recordId, EMAIL_FIELD)]
    expect(value).toEqual([
      { type: 'text', value: 'anna.work@corp.io' },
      { type: 'text', value: 'anna@example.com' },
    ])
    // The old bug: String(['a','b']) => 'a,b' stored as ONE text value.
    expect(JSON.stringify(value)).not.toContain('anna.work@corp.io,anna@example.com')
  })

  it('normalizes a scalar on a multi field to a one-element array (stable shape)', () => {
    seed([
      {
        fieldId: EMAIL_FIELD,
        value: 'anna.work@corp.io',
        fieldType: 'EMAIL',
        fieldOptions: { multi: true },
      },
    ])

    expect(useFieldValueStore.getState().values[buildFieldValueKey(recordId, EMAIL_FIELD)]).toEqual(
      [{ type: 'text', value: 'anna.work@corp.io' }]
    )
  })

  it('keeps single-value fields scalar-shaped', () => {
    seed([{ fieldId: NOTES_FIELD, value: 'hello', fieldType: 'TEXT', fieldOptions: {} }])

    expect(useFieldValueStore.getState().values[buildFieldValueKey(recordId, NOTES_FIELD)]).toEqual(
      { type: 'text', value: 'hello' }
    )
  })
})
