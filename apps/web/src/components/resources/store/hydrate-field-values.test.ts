// apps/web/src/components/resources/store/hydrate-field-values.test.ts
//
// Multi-value (options.multi) shape guards for the record-data → field-value
// store bridge. Record-row data carries at most the denormalized PRIMARY value
// for a multi scalar field (e.g. contact `email` via `dbColumn`), so hydration
// must NOT seed a scalar there: the fetch queue and cell hooks skip keys that
// already hold a value, so a seeded scalar blocks the authoritative
// `fieldValue.batchGet` array and the table cell shows only the primary until
// something else overwrites the key.

import type { Resource, ResourceField } from '@auxx/lib/resources/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildFieldValueKey, useFieldValueStore } from './field-value-store'
import { hydrateFieldValues, hydrateMultipleRecords } from './hydrate-field-values'

const DEF_ID = 'cmdefcontact1234567890abcd'

const multiEmailField = {
  id: 'cmfldemail1234567890abcd',
  resourceFieldId: `${DEF_ID}:cmfldemail1234567890abcd`,
  key: 'primaryEmail',
  label: 'Email',
  type: 'email',
  fieldType: 'EMAIL',
  isSystem: true,
  systemAttribute: 'primary_email',
  dbColumn: 'email',
  options: { multi: true },
} as unknown as ResourceField

const notesField = {
  id: 'cmfldnotes1234567890abcd',
  resourceFieldId: `${DEF_ID}:cmfldnotes1234567890abcd`,
  key: 'notes',
  label: 'Notes',
  type: 'text',
  fieldType: 'TEXT',
  options: {},
} as unknown as ResourceField

const resource = {
  id: DEF_ID,
  entityDefinitionId: DEF_ID,
  entityType: 'contact',
  apiSlug: 'contacts',
  fields: [multiEmailField, notesField],
} as unknown as Resource

const recordId = `${DEF_ID}:rec1` as Parameters<typeof hydrateFieldValues>[0]['recordId']
const emailKey = buildFieldValueKey(recordId, multiEmailField.resourceFieldId!)
const notesKey = buildFieldValueKey(recordId, notesField.resourceFieldId!)

beforeEach(() => {
  useFieldValueStore.getState().clearAll()
})

describe('hydrateFieldValues — options.multi fields', () => {
  it('does NOT seed a scalar for a multi field (leaves the key to batchGet)', () => {
    hydrateFieldValues({
      resource,
      recordId,
      recordData: { email: 'anna.work@corp.io', notes: 'hello' },
    })

    const values = useFieldValueStore.getState().values
    // The multi email key must stay unset — a seeded scalar would block the
    // batch fetch (keys with values are skipped) and pin the cell to the
    // primary value only.
    expect(emailKey in values).toBe(false)
    // Single-value fields still hydrate as before.
    expect(values[notesKey]).toEqual({ type: 'text', value: 'hello' })
  })

  it('seeds an ordered array when record data carries the full array', () => {
    hydrateFieldValues({
      resource,
      recordId,
      recordData: { email: ['anna.work@corp.io', 'anna@example.com'] },
    })

    expect(useFieldValueStore.getState().values[emailKey]).toEqual([
      { type: 'text', value: 'anna.work@corp.io' },
      { type: 'text', value: 'anna@example.com' },
    ])
  })

  it('never stores the String(array) comma join', () => {
    hydrateFieldValues({
      resource,
      recordId,
      recordData: { email: ['a@x.io', 'b@y.io'] },
    })

    const value = useFieldValueStore.getState().values[emailKey]
    expect(JSON.stringify(value)).not.toContain('a@x.io,b@y.io')
  })
})

describe('hydrateMultipleRecords — options.multi fields', () => {
  it('applies the same scalar skip + array pass-through per record', () => {
    const otherRecordId = `${DEF_ID}:rec2` as typeof recordId
    hydrateMultipleRecords(resource, [
      { recordId, data: { email: 'primary.only@corp.io', notes: 'a' } },
      { recordId: otherRecordId, data: { email: ['x@x.io', 'y@y.io'] } },
    ])

    const values = useFieldValueStore.getState().values
    expect(emailKey in values).toBe(false)
    expect(values[notesKey]).toEqual({ type: 'text', value: 'a' })
    expect(values[buildFieldValueKey(otherRecordId, multiEmailField.resourceFieldId!)]).toEqual([
      { type: 'text', value: 'x@x.io' },
      { type: 'text', value: 'y@y.io' },
    ])
  })
})
