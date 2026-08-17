// packages/lib/src/participants/__tests__/list-contact-identifiers.test.ts
//
// The chip menu's point lookup: every address ONE contact is reachable at, for
// ONE channel. What is worth pinning here is not the SQL (two equality probes)
// but the four decisions around it: the model→field switch is bound so a phone
// composer never reads the email field, the record arm's ordering is the
// primary-value contract, the arms dedupe with record values winning, and a
// model with nothing addressable answers empty rather than unfiltered.
//
// ⚠️ `src/test/setup.ts` mocks `@auxx/database` wholesale, so `schema.Foo` is a
// memoized `{}` and its COLUMNS are `undefined`. Table identity therefore works
// (`.from(schema.FieldValue)` is comparable by reference, which is how the db
// double routes the two arms) but no assertion can name a column — so "ordered
// by sortKey" is pinned only as "this arm applies an ORDER BY at all". The
// column identity is asserted by review of `list-contact-identifiers.ts`.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../errors'

// Partial mock: other modules in this graph import other helpers from the same
// file, and a full replacement of a shared module dies at COLLECTION rather than
// in the test that needed it.
const getCachedEntityDefId = vi.fn()
const getCachedCustomFields = vi.fn()
vi.mock('../../cache/org-cache-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedEntityDefId: (...args: unknown[]) => getCachedEntityDefId(...args),
  getCachedCustomFields: (...args: unknown[]) => getCachedCustomFields(...args),
}))

const { listContactIdentifiers, mergeIdentifiers } = await import('../list-contact-identifiers')

const ORG = 'org_1'
const RECORD = 'ei_jane'

const EMAIL_FIELD = { id: 'fld_email', systemAttribute: 'primary_email' }
const PHONE_FIELD = { id: 'fld_phone', systemAttribute: 'phone' }

interface DbCalls {
  /** Tables `.from()` was called with, in order. */
  tables: string[]
  /** How many times each arm applied an ORDER BY. */
  orderBy: { fieldValue: number; participant: number }
}

/**
 * Minimal `Database` stand-in. Routes on the table reference — the setup mock
 * memoizes `schema.X`, so `schema.FieldValue === schema.FieldValue` holds.
 */
function makeDb(rows: {
  fieldValues?: Array<{ identifier: string | null }>
  participants?: Array<{ identifier: string; identifierType: string }>
}): { db: Database; calls: DbCalls } {
  const calls: DbCalls = { tables: [], orderBy: { fieldValue: 0, participant: 0 } }
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const isFieldValue = table === schema.FieldValue
        calls.tables.push(isFieldValue ? 'FieldValue' : 'Participant')
        const result = isFieldValue ? (rows.fieldValues ?? []) : (rows.participants ?? [])
        const chain = {
          where: () => chain,
          orderBy: () => {
            if (isFieldValue) calls.orderBy.fieldValue++
            else calls.orderBy.participant++
            return chain
          },
          limit: async () => result,
        }
        return chain
      },
    }),
  }
  return { db: db as unknown as Database, calls }
}

/** Unwrap an expected-ok result, failing loudly instead of on `undefined`. */
function unwrap<T>(result: { isErr(): boolean; value?: T; error?: Error }): T {
  if (result.isErr()) throw result.error
  return result.value as T
}

beforeEach(() => {
  vi.clearAllMocks()
  getCachedEntityDefId.mockResolvedValue('def_contact')
  getCachedCustomFields.mockResolvedValue([EMAIL_FIELD, PHONE_FIELD])
})

describe('listContactIdentifiers — record values arm', () => {
  it('ranks the record values in the order the query returned them, 0 = primary', async () => {
    const { db } = makeDb({
      fieldValues: [{ identifier: 'jane@corp.com' }, { identifier: 'j.smith@corp.com' }],
    })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'email' })
    )

    expect(rows).toEqual([
      { identifier: 'jane@corp.com', identifierType: 'EMAIL', onRecord: true, rank: 0 },
      { identifier: 'j.smith@corp.com', identifierType: 'EMAIL', onRecord: true, rank: 1 },
    ])
  })

  it('applies an ORDER BY on the record arm — the sortKey contract (#1613)', async () => {
    const { db, calls } = makeDb({ fieldValues: [{ identifier: 'jane@corp.com' }] })

    await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'email' })

    expect(calls.orderBy.fieldValue).toBe(1)
  })

  it('stamps the identifierType from the model, not from the FieldValue row', async () => {
    const { db } = makeDb({ fieldValues: [{ identifier: '+14155551234' }] })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'phone' })
    )

    expect(rows[0]?.identifierType).toBe('PHONE')
  })

  it('drops a row whose valueText came back null', async () => {
    const { db } = makeDb({ fieldValues: [{ identifier: null }, { identifier: 'jane@corp.com' }] })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'email' })
    )

    expect(rows.map((r) => r.identifier)).toEqual(['jane@corp.com'])
  })

  it('skips the arm — no FieldValue query — when the org has no field for this model', async () => {
    // An org carrying only `primary_email`, composing on a phone channel. This is
    // `recipient-search.md` §1.2's dead-row bug: reading the email field here
    // would offer addresses the channel cannot send to.
    getCachedCustomFields.mockResolvedValue([EMAIL_FIELD])
    const { db, calls } = makeDb({
      fieldValues: [{ identifier: 'jane@corp.com' }],
      participants: [{ identifier: '+14155551234', identifierType: 'PHONE' }],
    })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'phone' })
    )

    expect(calls.tables).toEqual(['Participant'])
    expect(rows.map((r) => r.identifier)).toEqual(['+14155551234'])
  })

  it('skips the arm when the org has no contact definition', async () => {
    getCachedEntityDefId.mockResolvedValue(undefined)
    const { db, calls } = makeDb({ fieldValues: [{ identifier: 'jane@corp.com' }] })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'email' })
    )

    expect(calls.tables).toEqual(['Participant'])
    expect(rows).toEqual([])
  })
})

describe('listContactIdentifiers — corresponded-with arm', () => {
  it('marks a participant-only address as not on the record, with no rank', async () => {
    const { db } = makeDb({
      fieldValues: [{ identifier: 'jane@corp.com' }],
      participants: [{ identifier: 'jane@personal.com', identifierType: 'EMAIL' }],
    })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'email' })
    )

    expect(rows).toEqual([
      { identifier: 'jane@corp.com', identifierType: 'EMAIL', onRecord: true, rank: 0 },
      { identifier: 'jane@personal.com', identifierType: 'EMAIL', onRecord: false, rank: null },
    ])
  })

  it('carries the identifierType off the Participant row', async () => {
    const { db } = makeDb({
      participants: [{ identifier: 'psid_1', identifierType: 'FACEBOOK_PSID' }],
    })

    // `thread_only` has no contact field at all, so this is the participant arm
    // answering alone — the shape a Facebook/Instagram chip would see.
    const rows = unwrap(
      await listContactIdentifiers(db, {
        organizationId: ORG,
        recordId: RECORD,
        model: 'thread_only',
      })
    )

    expect(rows).toEqual([
      { identifier: 'psid_1', identifierType: 'FACEBOOK_PSID', onRecord: false, rank: null },
    ])
  })
})

describe('listContactIdentifiers — the union', () => {
  it('dedupes an address present on both sides, keeping the record row', async () => {
    const { db } = makeDb({
      fieldValues: [{ identifier: 'jane@corp.com' }],
      participants: [{ identifier: 'jane@corp.com', identifierType: 'EMAIL' }],
    })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'email' })
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.onRecord).toBe(true)
  })

  it('dedupes case-insensitively', async () => {
    const { db } = makeDb({
      fieldValues: [{ identifier: 'jane@corp.com' }],
      participants: [{ identifier: 'Jane@Corp.com', identifierType: 'EMAIL' }],
    })

    const rows = unwrap(
      await listContactIdentifiers(db, { organizationId: ORG, recordId: RECORD, model: 'email' })
    )

    expect(rows).toHaveLength(1)
  })

  it('truncates the union at the limit', async () => {
    const { db } = makeDb({
      fieldValues: [{ identifier: 'a@x.com' }, { identifier: 'b@x.com' }],
      participants: [{ identifier: 'c@x.com', identifierType: 'EMAIL' }],
    })

    const rows = unwrap(
      await listContactIdentifiers(db, {
        organizationId: ORG,
        recordId: RECORD,
        model: 'email',
        limit: 2,
      })
    )

    expect(rows.map((r) => r.identifier)).toEqual(['a@x.com', 'b@x.com'])
  })

  it('rejects a limit below 1 instead of querying', async () => {
    const { db, calls } = makeDb({})

    const result = await listContactIdentifiers(db, {
      organizationId: ORG,
      recordId: RECORD,
      model: 'email',
      limit: 0,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(calls.tables).toEqual([])
  })

  // `identifierTypesForModel('platform_user')` is `[]`, which means "nothing is
  // addressable", NOT "no filter". A caller that read it as no-filter would hand
  // back every participant on the record of every type.
  it('answers a model with no addressable type with an empty list and no query', async () => {
    const { db, calls } = makeDb({
      participants: [{ identifier: 'jane@corp.com', identifierType: 'EMAIL' }],
    })

    const rows = unwrap(
      await listContactIdentifiers(db, {
        organizationId: ORG,
        recordId: RECORD,
        model: 'platform_user',
      })
    )

    expect(rows).toEqual([])
    expect(calls.tables).toEqual([])
  })
})

describe('mergeIdentifiers', () => {
  const onRecord = {
    identifier: 'a@x.com',
    identifierType: 'EMAIL' as const,
    onRecord: true,
    rank: 0,
  }
  const corresponded = {
    identifier: 'b@x.com',
    identifierType: 'EMAIL' as const,
    onRecord: false,
    rank: null,
  }

  it('keeps record values first and appends the rest', () => {
    expect(mergeIdentifiers([onRecord], [corresponded], 10)).toEqual([onRecord, corresponded])
  })

  it('does not reorder by rank — nulls would sort', () => {
    const second = { ...onRecord, identifier: 'c@x.com', rank: 1 }
    expect(
      mergeIdentifiers([onRecord, second], [corresponded], 10).map((r) => r.identifier)
    ).toEqual(['a@x.com', 'c@x.com', 'b@x.com'])
  })

  it('stops at the limit', () => {
    expect(mergeIdentifiers([onRecord], [corresponded], 1)).toEqual([onRecord])
  })
})
