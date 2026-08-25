// packages/lib/src/field-values/__tests__/name-compose-on-read.test.ts

/**
 * NAME reads COMPOSE from the two TEXT part fields
 * (`plans/field-values/name-field-writes.md` §4, "server READ semantics").
 *
 * A NAME field is a COMPOSITE and owns no storage: the write side decomposes
 * every set into its parts, so the read side has to compose back out of them.
 * The sharp edge is that stray pre-decomposition rows ON the NAME field are
 * deliberately NOT migrated and NOT deleted (§6/§8) — 84 of them across 5
 * fields in the dev DB when this landed — so "compose" is not just symmetry,
 * it is what makes those rows invisible. Every test below that names a stray
 * row gives it DIFFERENT content from the parts, so a regression that reads the
 * stored composite cannot pass.
 *
 * NOTE on imports: `field-value-helpers` must not be imported for its VALUES
 * here. Pulling it in ahead of `field-value-queries` re-evaluates the cache
 * barrel out from under `vi.mock('../../cache')` and the real, DB-backed
 * `findCachedResource` runs instead of the double. The §7 computed-row tests
 * live in `computed-row-skip.test.ts` for that reason.
 */

import { toRecordId } from '@auxx/types/resource'

const { findCachedResource, getCachedUserInstanceGrants } = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  getCachedUserInstanceGrants: vi.fn(),
}))

// Partial-mock the cache barrel: it is DB/Redis-backed, and a wholesale
// replacement would drop the entries `field-value-helpers` reaches.
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource,
  getCachedUserInstanceGrants,
}))

import type { CachedField, FieldValueContext } from '../field-value-helpers'
import { getValue, getValues } from '../field-value-queries'

const ORG = 'org_1'
const CONTACT_ID = 'con_1'
const CONTACT = toRecordId('contact', CONTACT_ID)

const NAME = 'fld_fullName'
const FIRST = 'fld_firstName'
const LAST = 'fld_lastName'
const EMAIL = 'fld_email'

/** A SECOND NAME field on the same definition, over its own two parts. */
const NAME2 = 'fld_billingName'
const FIRST2 = 'fld_billingFirst'
const LAST2 = 'fld_billingLast'

/** A contact `full_name` NAME field linked to both part fields. */
const NAME_FIELD = {
  id: NAME,
  type: 'NAME',
  options: { name: { firstNameFieldId: FIRST, lastNameFieldId: LAST } },
} as unknown as CachedField

/** The same field with `options.name` never configured — nothing to compose. */
const UNLINKED_NAME_FIELD = {
  id: NAME,
  type: 'NAME',
  options: {},
} as unknown as CachedField

const CONTACT_RESOURCE = {
  id: 'contact',
  fields: [
    {
      id: NAME,
      key: 'full_name',
      fieldType: 'NAME',
      options: { name: { firstNameFieldId: FIRST, lastNameFieldId: LAST } },
    },
    { id: FIRST, key: 'first_name', fieldType: 'TEXT', options: {} },
    { id: LAST, key: 'last_name', fieldType: 'TEXT', options: {} },
    { id: EMAIL, key: 'email', fieldType: 'TEXT', options: {} },
  ],
}

/** The same definition with a second, independently linked NAME field. */
const TWO_NAME_RESOURCE = {
  id: 'contact',
  fields: [
    ...CONTACT_RESOURCE.fields,
    {
      id: NAME2,
      key: 'billing_name',
      fieldType: 'NAME',
      options: { name: { firstNameFieldId: FIRST2, lastNameFieldId: LAST2 } },
    },
    { id: FIRST2, key: 'billing_first', fieldType: 'TEXT', options: {} },
    { id: LAST2, key: 'billing_last', fieldType: 'TEXT', options: {} },
  ],
}

/**
 * Each awaited query resolves the next queued result set — the compose read is
 * a SECOND query behind `getValues`' join, and the two have different shapes.
 * The last set repeats, so a single-query path can be given one array.
 */
function fakeDb(...resultSets: unknown[][]) {
  let issued = 0
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where']) {
    chain[method] = () => chain
  }
  chain.orderBy = () => {
    const rows = resultSets[Math.min(issued, resultSets.length - 1)] ?? []
    issued++
    return Promise.resolve(rows)
  }
  return {
    db: chain as unknown as FieldValueContext['db'],
    queriesIssued: () => issued,
  }
}

function context(db: FieldValueContext['db']): FieldValueContext {
  return {
    db,
    organizationId: ORG,
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: {} as FieldValueContext['validator'],
    bypassFieldGuards: new Set(),
  }
}

/** A stored TEXT part row, as the compose query projects it. */
function partRow(fieldId: string, value: string) {
  return { fieldId, valueText: value }
}

/**
 * A stray row ON the NAME field — what the pre-decomposition doors wrote and
 * what §6 leaves in place. Shaped as a full `FieldValue` row so the legacy read
 * path would happily turn it into a `json` value if it were ever reached.
 */
function strayNameRow(firstName: string, lastName: string) {
  return {
    id: 'fv_stray',
    entityId: CONTACT_ID,
    fieldId: NAME,
    sortKey: 'a0',
    valueText: null,
    valueJson: { v: { firstName, lastName } },
    createdAt: '2026-08-25T18:40:17.000Z',
    updatedAt: '2026-08-25T18:40:17.000Z',
  }
}

/** A stored TEXT row, as the `getValues` join returns it (unprojected). */
function textRow(fieldId: string, value: string) {
  return {
    id: `fv_${fieldId}`,
    entityId: CONTACT_ID,
    fieldId,
    sortKey: 'a0',
    valueText: value,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  }
}

/** `getValues` joins CustomField, so its rows are `{ FieldValue, CustomField }`. */
function joined(row: Record<string, unknown>, type: string) {
  return { FieldValue: row, CustomField: { id: row.fieldId, type, options: {} } }
}

/** A part field's row on the `getValues` path. */
function joinedPart(fieldId: string, value: string) {
  return joined(textRow(fieldId, value), 'TEXT')
}

beforeEach(() => {
  findCachedResource.mockReset().mockImplementation(async (_org: string, key: string) => {
    return key === 'contact' ? CONTACT_RESOURCE : null
  })
  getCachedUserInstanceGrants.mockReset().mockResolvedValue({ userId: 'user_1' })
})

describe('getValue — NAME composes from its parts', () => {
  it('returns the composed { firstName, lastName }', async () => {
    const { db } = fakeDb([partRow(FIRST, 'Anita'), partRow(LAST, 'Bicknell')])

    const result = await getValue(context(db), { recordId: CONTACT, fieldId: NAME }, NAME_FIELD)

    // The converter's own output shape (`nameConverter.toTypedInput`), so an
    // SDK/API reader sees no change now that the stored row is gone.
    expect(result).toEqual({
      id: '',
      entityId: CONTACT_ID,
      fieldId: NAME,
      sortKey: '',
      createdAt: '',
      updatedAt: '',
      type: 'json',
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })
  })

  it('IGNORES a stray row on the NAME field in favour of the parts', async () => {
    // The exact §2 defect row: the composite the raw write stored says
    // "Anita1 Bicknell1" while the part fields still hold "Anita Bicknell".
    const { db, queriesIssued } = fakeDb([
      strayNameRow('Anita1', 'Bicknell1'),
      partRow(FIRST, 'Anita'),
      partRow(LAST, 'Bicknell'),
    ])

    const result = await getValue(context(db), { recordId: CONTACT, fieldId: NAME }, NAME_FIELD)

    expect(result).toMatchObject({ value: { firstName: 'Anita', lastName: 'Bicknell' } })
    // One query — the parts. The NAME field's own row is never even selected.
    expect(queriesIssued()).toBe(1)
  })

  it('composes with the other part empty when only one is set', async () => {
    const { db } = fakeDb([partRow(FIRST, 'Anita')])

    const result = await getValue(context(db), { recordId: CONTACT, fieldId: NAME }, NAME_FIELD)

    expect(result).toMatchObject({ value: { firstName: 'Anita', lastName: '' } })
  })

  it('answers null when neither part is set — the normal "no value" result', async () => {
    const { db } = fakeDb([])

    expect(await getValue(context(db), { recordId: CONTACT, fieldId: NAME }, NAME_FIELD)).toBeNull()
  })

  it('answers null when both parts are set to the empty string', async () => {
    const { db } = fakeDb([partRow(FIRST, ''), partRow(LAST, '')])

    expect(await getValue(context(db), { recordId: CONTACT, fieldId: NAME }, NAME_FIELD)).toBeNull()
  })

  it('keeps pre-decomposition behavior for an UNLINKED NAME field, and never throws', async () => {
    // No part ids to compose from, so the stored composite is all there is.
    const { db, queriesIssued } = fakeDb([strayNameRow('Chicago', 'Person')])

    const result = await getValue(
      context(db),
      { recordId: CONTACT, fieldId: NAME },
      UNLINKED_NAME_FIELD
    )

    expect(result).toMatchObject({
      type: 'json',
      value: { firstName: 'Chicago', lastName: 'Person' },
    })
    // Net zero either way: composing SWAPS the SELECT, it does not add one.
    expect(queriesIssued()).toBe(1)
  })

  it('takes the lowest-sortKey row when a part carries more than one', async () => {
    // A misconfigured multi-value part is not a list to join. Rows arrive
    // ordered by sortKey, so the first wins.
    const { db } = fakeDb([partRow(FIRST, 'Anita'), partRow(FIRST, 'Anne'), partRow(LAST, 'B')])

    const result = await getValue(context(db), { recordId: CONTACT, fieldId: NAME }, NAME_FIELD)

    expect(result).toMatchObject({ value: { firstName: 'Anita', lastName: 'B' } })
  })
})

describe('getValues — NAME composes from its parts, in ONE query', () => {
  /**
   * The point of this block is the QUERY COUNT. `getValues` resolves the part
   * ids from the org cache BEFORE it queries and widens its own `IN` list with
   * them, so composition never costs a second SELECT — not when `fieldIds` is
   * omitted (the parts were already in the result set), and not when it is
   * given (they ride the query that was being made anyway).
   */

  it('composes from the rows the join already returned — fieldIds omitted', async () => {
    const { db, queriesIssued } = fakeDb([
      joined(strayNameRow('Anita1', 'Bicknell1'), 'NAME'),
      joinedPart(FIRST, 'Anita'),
      joinedPart(LAST, 'Bicknell'),
    ])

    const values = await getValues(context(db), { recordId: CONTACT })

    expect(values.get(NAME)).toMatchObject({
      type: 'json',
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })
    expect(queriesIssued()).toBe(1)
  })

  it('keeps the parts in the result when the caller asked for everything', async () => {
    // `fieldIds` omitted means "every field", so the parts were requested and
    // must appear in their own right alongside the composed NAME.
    const { db } = fakeDb([joinedPart(FIRST, 'Anita'), joinedPart(LAST, 'Bicknell')])

    const values = await getValues(context(db), { recordId: CONTACT })

    expect(values.get(FIRST)).toMatchObject({ type: 'text', value: 'Anita' })
    expect(values.get(LAST)).toMatchObject({ type: 'text', value: 'Bicknell' })
  })

  it('widens the query for an explicit NAME request — still one query', async () => {
    // The caller named only `full_name`; the part rows come back because the
    // `IN` list was widened, not because a second SELECT was issued.
    const { db, queriesIssued } = fakeDb([joinedPart(FIRST, 'Anita'), joinedPart(LAST, 'Bicknell')])

    const values = await getValues(context(db), { recordId: CONTACT, fieldIds: [NAME] })

    expect(values.get(NAME)).toMatchObject({ value: { firstName: 'Anita', lastName: 'Bicknell' } })
    expect(queriesIssued()).toBe(1)
  })

  it('does NOT leak the widened part ids into the result', async () => {
    const { db } = fakeDb([joinedPart(FIRST, 'Anita'), joinedPart(LAST, 'Bicknell')])

    const values = await getValues(context(db), { recordId: CONTACT, fieldIds: [NAME] })

    expect([...values.keys()]).toEqual([NAME])
  })

  it('emits a part normally when the caller asked for it TOO, fetching it once', async () => {
    const { db, queriesIssued } = fakeDb([joinedPart(FIRST, 'Anita'), joinedPart(LAST, 'Bicknell')])

    const values = await getValues(context(db), { recordId: CONTACT, fieldIds: [NAME, FIRST] })

    expect(values.get(NAME)).toMatchObject({ value: { firstName: 'Anita', lastName: 'Bicknell' } })
    expect(values.get(FIRST)).toMatchObject({ type: 'text', value: 'Anita' })
    // `last_name` was pulled in for composition only and stays out.
    expect([...values.keys()].sort()).toEqual([FIRST, NAME].sort())
    expect(queriesIssued()).toBe(1)
  })

  it('composes TWO NAME fields on one record in the same single query', async () => {
    findCachedResource.mockResolvedValue(TWO_NAME_RESOURCE)
    const { db, queriesIssued } = fakeDb([
      joinedPart(FIRST, 'Anita'),
      joinedPart(LAST, 'Bicknell'),
      joinedPart(FIRST2, 'Ada'),
      joinedPart(LAST2, 'Lovelace'),
    ])

    const values = await getValues(context(db), { recordId: CONTACT, fieldIds: [NAME, NAME2] })

    expect(values.get(NAME)).toMatchObject({ value: { firstName: 'Anita', lastName: 'Bicknell' } })
    expect(values.get(NAME2)).toMatchObject({ value: { firstName: 'Ada', lastName: 'Lovelace' } })
    expect([...values.keys()].sort()).toEqual([NAME, NAME2].sort())
    expect(queriesIssued()).toBe(1)
  })

  it('drops the stray row entirely when neither part is set', async () => {
    const { db, queriesIssued } = fakeDb([joined(strayNameRow('Anita1', 'Bicknell1'), 'NAME')])

    const values = await getValues(context(db), { recordId: CONTACT })

    expect(values.has(NAME)).toBe(false)
    expect(queriesIssued()).toBe(1)
  })

  it('leaves every other field on the record untouched', async () => {
    const { db } = fakeDb([joinedPart(EMAIL, 'a@b.c'), joinedPart(FIRST, 'Anita')])

    const values = await getValues(context(db), { recordId: CONTACT })

    expect(values.get(EMAIL)).toMatchObject({ type: 'text', value: 'a@b.c' })
    expect(values.get(NAME)).toMatchObject({ value: { firstName: 'Anita', lastName: '' } })
  })

  it('issues one query when the definition has no NAME field', async () => {
    findCachedResource.mockResolvedValue({ id: 'contact', fields: [CONTACT_RESOURCE.fields[3]] })
    const { db, queriesIssued } = fakeDb([joinedPart(EMAIL, 'a@b.c')])

    await getValues(context(db), { recordId: CONTACT })

    expect(queriesIssued()).toBe(1)
  })

  it('does not widen for a NAME field the caller did not ask for', async () => {
    const { db, queriesIssued } = fakeDb([joinedPart(EMAIL, 'a@b.c')])

    const values = await getValues(context(db), { recordId: CONTACT, fieldIds: [EMAIL] })

    expect(values.has(NAME)).toBe(false)
    expect([...values.keys()]).toEqual([EMAIL])
    expect(queriesIssued()).toBe(1)
  })
})
