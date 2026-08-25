// apps/web/src/components/resources/hooks/use-save-field-value.name-split.test.ts
//
// A NAME field is a COMPOSITE over two TEXT part fields
// (`options.name.firstNameFieldId` / `.lastNameFieldId`). It stores NOTHING of
// its own — the value the UI shows is derived from the parts — so a write that
// lands on the NAME field itself leaves the parts stale and is silently undone
// by the next refetch.
//
// The split used to live ABOVE this funnel, in `PropertyProvider.commitValue`
// and in the create form. `commitValue`'s sibling `commitValueAndClose` never
// got a copy, so committing a name with Enter wrote the composite raw for the
// ~7 months the linking existed, while clicking away wrote the parts. Grid
// paste (`saveBulkMultipleFields`) never split at all.
//
// These tests pin the split at the funnel, where no commit path can skip it:
// what goes on the wire is TWO part-field entries and ZERO NAME entries, and
// the optimistic store writes land on the PART keys.

import type { CustomResource, RecordId, ResourceField } from '@auxx/lib/resources/client'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFieldValueKey, useFieldValueStore } from '../store/field-value-store'
import { useRecordStore } from '../store/record-store'
import { getResourceStoreState } from '../store/resource-store'
import { useSaveFieldValue } from './use-save-field-value'

const DEF = 'def_contact00000000000000000'
const ROW = 'ein_anita0000000000000000000'
const RECORD_ID = `${DEF}:${ROW}` as RecordId

const OTHER_DEF = 'def_lead00000000000000000000'
const OTHER_RECORD_ID = `${OTHER_DEF}:ein_lead0000000000000000000` as RecordId

const NAME_ID = 'fld_full_name000000000000000'
const FIRST_ID = 'fld_first_name00000000000000'
const LAST_ID = 'fld_last_name0000000000000000'
const NOTES_ID = 'fld_notes00000000000000000000'

/** One tRPC payload as the funnel put it on the wire. */
interface SetInput {
  recordId: string
  fieldId: string
  value: unknown
}
interface BulkInput {
  recordIds: string[]
  values: Array<{ fieldId: string; value: unknown }>
}

const h = vi.hoisted(() => ({
  set: [] as unknown[],
  bulk: [] as unknown[],
}))

// The wire. Both mutations resolve successfully with an empty value list —
// what is asserted is the REQUEST, not what the server would answer.
vi.mock('~/trpc/react', () => {
  const record = (sink: unknown[]) => ({
    useMutation: () => ({
      mutate: (input: unknown, opts?: { onSuccess?: (result: unknown) => void }) => {
        sink.push(input)
        opts?.onSuccess?.({ values: [] })
      },
      mutateAsync: async (input: unknown) => {
        sink.push(input)
        return { values: [] }
      },
      isPending: false,
    }),
  })
  return { api: { fieldValue: { set: record(h.set), setBulk: record(h.bulk) } } }
})

function makeField(overrides: Partial<ResourceField> = {}): ResourceField {
  return {
    id: FIRST_ID,
    key: 'firstName',
    label: 'First Name',
    type: 'string',
    fieldType: 'TEXT',
    capabilities: { updatable: true },
    ...overrides,
  } as unknown as ResourceField
}

/** The NAME composite, linked to both parts and addressable as `full_name`. */
function nameField(name: unknown = { firstNameFieldId: FIRST_ID, lastNameFieldId: LAST_ID }) {
  return makeField({
    id: NAME_ID,
    key: 'fullName',
    label: 'Full Name',
    fieldType: 'NAME',
    systemAttribute: 'full_name',
    options: name ? { name } : {},
  } as Partial<ResourceField>)
}

function contactsResource(fields: ResourceField[], primaryDisplayFieldId?: string): CustomResource {
  return {
    id: DEF,
    type: 'custom',
    apiSlug: 'contacts',
    entityType: 'contact',
    entityDefinitionId: DEF,
    organizationId: 'org_1',
    label: 'Contact',
    plural: 'Contacts',
    icon: 'user',
    color: 'blue',
    isVisible: true,
    fields,
    display: {
      primaryDisplayField: primaryDisplayFieldId ? { id: primaryDisplayFieldId } : null,
      secondaryDisplayField: null,
      avatarField: null,
      defaultSortField: 'updatedAt',
      defaultSortDirection: 'desc',
      orgScopingStrategy: 'direct',
    },
  } as unknown as CustomResource
}

/** The default registry: a linked NAME composite, both parts, and a plain TEXT. */
function givenLinkedNameField(primaryDisplayFieldId?: string) {
  getResourceStoreState().setResources([
    contactsResource(
      [
        nameField(),
        makeField(),
        makeField({ id: LAST_ID, key: 'lastName', label: 'Last Name' }),
        makeField({ id: NOTES_ID, key: 'notes', label: 'Notes' }),
      ],
      primaryDisplayFieldId
    ),
  ])
}

function save() {
  return renderHook(() => useSaveFieldValue()).result.current
}

/** Every `{ fieldId, value }` the funnel sent, across both mutations. */
function wireEntries(): Array<{ fieldId: string; value: unknown }> {
  return [
    ...(h.set as SetInput[]).map((i) => ({ fieldId: i.fieldId, value: i.value })),
    ...(h.bulk as BulkInput[]).flatMap((i) => i.values),
  ]
}

beforeEach(() => {
  h.set.length = 0
  h.bulk.length = 0
  useFieldValueStore.getState().clearAll()
  useRecordStore.getState().clearAll()
  getResourceStoreState().reset()
  givenLinkedNameField()
})

describe('NAME writes split into their part fields — saveFieldValue', () => {
  // THE regression. This is the exact payload the record drawer sent when the
  // name was committed with Enter: one write, on the NAME field itself.
  it('sends two part-field writes and never the NAME field', () => {
    save().saveFieldValue(RECORD_ID, NAME_ID, { firstName: 'Anita', lastName: 'Bicknell' }, 'NAME')

    expect(wireEntries()).toEqual([
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: 'Bicknell' },
    ])
    expect(wireEntries().some((e) => e.fieldId === NAME_ID)).toBe(false)
  })

  // Both parts must travel in ONE request: each part write recomposes
  // `displayName` by reading its SIBLING from the DB, so two concurrent
  // single-field writes can each read a stale sibling and persist an outdated
  // composed name.
  it('batches both parts into a single request', () => {
    save().saveFieldValue(RECORD_ID, NAME_ID, { firstName: 'Anita', lastName: 'Bicknell' }, 'NAME')

    expect(h.set).toHaveLength(0)
    expect(h.bulk).toHaveLength(1)
    expect((h.bulk[0] as BulkInput).recordIds).toEqual([RECORD_ID])
  })

  // The funnel receives whatever spelling the caller had. This field is
  // `systemAttribute: 'full_name'`, `isCustom: false` — the alias form has to
  // resolve or the guard is decorative.
  it('resolves a systemAttribute-shaped fieldId and still splits', () => {
    save().saveFieldValue(
      RECORD_ID,
      'full_name',
      { firstName: 'Anita', lastName: 'Bicknell' },
      'NAME'
    )

    expect(wireEntries()).toEqual([
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: 'Bicknell' },
    ])
  })

  it('resolves the static key form and still splits', () => {
    save().saveFieldValue(
      RECORD_ID,
      'fullName',
      { firstName: 'Anita', lastName: 'Bicknell' },
      'NAME'
    )

    expect(wireEntries().map((e) => e.fieldId)).toEqual([FIRST_ID, LAST_ID])
  })

  // The instant part-row refresh in an open drawer is the whole reason the
  // split stayed on the client: the optimistic write has to land on the keys
  // the part rows subscribe to, not on the composite's.
  it('applies the optimistic store update to the PART keys', () => {
    save().saveFieldValue(RECORD_ID, NAME_ID, { firstName: 'Anita', lastName: 'Bicknell' }, 'NAME')

    const values = useFieldValueStore.getState().values
    expect(values[buildFieldValueKey(RECORD_ID, FIRST_ID)]).toEqual({
      type: 'text',
      value: 'Anita',
    })
    expect(values[buildFieldValueKey(RECORD_ID, LAST_ID)]).toEqual({
      type: 'text',
      value: 'Bicknell',
    })
    expect(values[buildFieldValueKey(RECORD_ID, NAME_ID)]).toBeUndefined()
  })

  // The composed `displayName` is recomputed server-side on every part write,
  // but the editing tab is excluded from the `record:updated` realtime echo —
  // without the mirror the drawer header stays stale until a refetch.
  it('mirrors the composed displayName into the record store', () => {
    getResourceStoreState().reset()
    givenLinkedNameField(NAME_ID)
    useRecordStore.getState().setRecords(DEF, [
      {
        id: ROW,
        displayName: 'Anita Old',
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    ])

    save().saveFieldValue(RECORD_ID, NAME_ID, { firstName: 'Anita', lastName: 'Bicknell' }, 'NAME')

    expect(useRecordStore.getState().records[DEF]?.get(ROW)?.displayName).toBe('Anita Bicknell')
  })

  it('leaves displayName alone when the NAME field is not the primary display field', () => {
    useRecordStore.getState().setRecords(DEF, [
      {
        id: ROW,
        displayName: 'Anita Old',
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    ])

    save().saveFieldValue(RECORD_ID, NAME_ID, { firstName: 'Anita', lastName: 'Bicknell' }, 'NAME')

    expect(useRecordStore.getState().records[DEF]?.get(ROW)?.displayName).toBe('Anita Old')
  })

  it('leaves a non-NAME write completely untouched', () => {
    save().saveFieldValue(RECORD_ID, NOTES_ID, 'hello', 'TEXT')

    expect(h.bulk).toHaveLength(0)
    expect(h.set).toEqual([{ recordId: RECORD_ID, fieldId: NOTES_ID, value: 'hello' }])
    expect(useFieldValueStore.getState().values[buildFieldValueKey(RECORD_ID, NOTES_ID)]).toEqual({
      type: 'text',
      value: 'hello',
    })
  })

  // An unlinked composite has no parts to write through. Falling back to the
  // raw write is the only behavior that does not lose the edit outright, and
  // it must not throw on the way.
  it('falls through unsplit when options.name is missing a part id', () => {
    getResourceStoreState().reset()
    getResourceStoreState().setResources([
      contactsResource([nameField({ firstNameFieldId: FIRST_ID }), makeField()]),
    ])

    expect(() =>
      save().saveFieldValue(
        RECORD_ID,
        NAME_ID,
        { firstName: 'Anita', lastName: 'Bicknell' },
        'NAME'
      )
    ).not.toThrow()

    expect(h.bulk).toHaveLength(0)
    expect((h.set[0] as SetInput).fieldId).toBe(NAME_ID)
  })

  // Both part ids pointing at the SAME field is a misconfigured composite, not
  // a linked one. The shared predicate (`readNameParts`, which the server
  // decomposes with) rejects it, and the client must give the same answer —
  // splitting here would write a value the server would have stored raw.
  it('falls through unsplit when both part ids are the same field', () => {
    getResourceStoreState().reset()
    getResourceStoreState().setResources([
      contactsResource([
        nameField({ firstNameFieldId: FIRST_ID, lastNameFieldId: FIRST_ID }),
        makeField(),
      ]),
    ])

    save().saveFieldValue(RECORD_ID, NAME_ID, { firstName: 'Anita', lastName: 'Bicknell' }, 'NAME')

    expect(h.bulk).toHaveLength(0)
    expect(h.set).toEqual([
      {
        recordId: RECORD_ID,
        fieldId: NAME_ID,
        value: { firstName: 'Anita', lastName: 'Bicknell' },
      },
    ])
  })

  it('falls through unsplit when options.name is absent entirely', () => {
    getResourceStoreState().reset()
    getResourceStoreState().setResources([contactsResource([nameField(null), makeField()])])

    save().saveFieldValue(RECORD_ID, NAME_ID, { firstName: 'Anita', lastName: 'Bicknell' }, 'NAME')

    expect((h.set[0] as SetInput).fieldId).toBe(NAME_ID)
  })
})

describe('NAME writes split into their part fields — the other funnel doors', () => {
  it('splits in saveFieldValueAsync', async () => {
    await save().saveFieldValueAsync(
      RECORD_ID,
      NAME_ID,
      { firstName: 'Anita', lastName: 'Bicknell' },
      'NAME'
    )

    expect(wireEntries()).toEqual([
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: 'Bicknell' },
    ])
  })

  // The create/edit form door. The NAME entry is expanded in place, and the
  // other entries in the same submit ride along untouched.
  it('splits in saveMultipleAsync and leaves sibling entries in place', async () => {
    await save().saveMultipleAsync(RECORD_ID, [
      { fieldId: NOTES_ID, value: 'hello', fieldType: 'TEXT' },
      { fieldId: NAME_ID, value: { firstName: 'Anita', lastName: 'Bicknell' }, fieldType: 'NAME' },
    ])

    expect(h.bulk).toHaveLength(1)
    expect((h.bulk[0] as BulkInput).values).toEqual([
      { fieldId: NOTES_ID, value: 'hello' },
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: 'Bicknell' },
    ])
  })

  // Grid paste/fill. This door never had a split copy at all.
  it('splits in saveBulkMultipleFields, and coerces a pasted full-name string', () => {
    save().saveBulkMultipleFields(
      [RECORD_ID],
      [{ fieldId: NAME_ID, value: 'Anita Bicknell', fieldType: 'NAME' }]
    )

    expect((h.bulk[0] as BulkInput).values).toEqual([
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: 'Bicknell' },
    ])
  })

  it('splits in saveBulkValues across every record', () => {
    const second = `${DEF}:ein_second000000000000000000` as RecordId
    save().saveBulkValues(
      [RECORD_ID, second],
      NAME_ID,
      { firstName: 'Anita', lastName: '' },
      'NAME'
    )

    expect((h.bulk[0] as BulkInput).recordIds).toEqual([RECORD_ID, second])
    expect((h.bulk[0] as BulkInput).values).toEqual([
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: '' },
    ])
  })

  // One payload serves every record in a bulk set, so a split is only safe
  // when every record's definition resolves the same composite. Otherwise the
  // part ids would be written against a definition that does not own them.
  it('leaves a bulk write unsplit when the records span definitions that disagree', () => {
    getResourceStoreState().reset()
    getResourceStoreState().setResources([
      contactsResource([nameField(), makeField(), makeField({ id: LAST_ID, key: 'lastName' })]),
      {
        ...contactsResource([makeField({ id: NAME_ID, key: 'fullName', fieldType: 'TEXT' })]),
        id: OTHER_DEF,
        entityDefinitionId: OTHER_DEF,
        apiSlug: 'leads',
        entityType: 'lead',
      } as CustomResource,
    ])

    save().saveBulkValues(
      [RECORD_ID, OTHER_RECORD_ID],
      NAME_ID,
      { firstName: 'Anita', lastName: 'Bicknell' },
      'NAME'
    )

    expect((h.bulk[0] as BulkInput).values).toEqual([
      { fieldId: NAME_ID, value: { firstName: 'Anita', lastName: 'Bicknell' } },
    ])
  })
})
