// packages/lib/src/resources/lookup/__tests__/lookup-entities-by-field-value.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../../errors'

// Mock the cache barrel WHOLESALE (partial-mocking it via importOriginal walks
// its real import graph before the mock exists and modules capture the real
// functions — see the field-values test suite note).
vi.mock('../../../cache', () => ({
  getCachedFieldMap: vi.fn(),
}))

const { getCachedFieldMap } = await import('../../../cache')
const { lookupEntitiesByFieldValue } = await import('../lookup-entities-by-field-value')

const getCachedFieldMapMock = vi.mocked(getCachedFieldMap)

const EMAIL_FIELD = {
  id: 'field-email-1',
  type: 'EMAIL',
  systemAttribute: 'primary_email',
} as never

/**
 * Fake db capturing FieldValue-lane queries. `selectDistinctOn` (the
 * FieldValue query) resolves `rows`; `select` (the RecordIdentity lane)
 * resolves `identityRows`.
 */
function buildFakeDb(
  rows: Array<{
    entityId: string
    displayName: string | null
    secondaryDisplayValue: string | null
    avatarUrl: string | null
  }>,
  identityRows: Array<{
    entityId: string
    displayName: string | null
    secondaryDisplayValue: string | null
    avatarUrl: string | null
  }> = []
) {
  const state = { distinctCalls: 0, selectCalls: 0 }
  const makeChain = (result: unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => Promise.resolve(result)
    return chain
  }
  const db = {
    selectDistinctOn: () => {
      state.distinctCalls++
      return makeChain(rows)
    },
    select: () => {
      state.selectCalls++
      return makeChain(identityRows)
    },
  }
  return { db: db as never, state }
}

const baseParams = {
  organizationId: 'org-1',
  entityDefinitionId: 'def-contact',
  limit: 5,
}

beforeEach(() => {
  getCachedFieldMapMock.mockReset()
  getCachedFieldMapMock.mockResolvedValue(new Map([['field-email-1', EMAIL_FIELD]]))
})

describe('lookupEntitiesByFieldValue', () => {
  it('matches by systemAttribute and echoes matchedBy', async () => {
    const { db } = buildFakeDb([
      {
        entityId: 'inst-1',
        displayName: 'Jane',
        secondaryDisplayValue: 'jane@x.com',
        avatarUrl: null,
      },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'primary_email', value: 'Jane@X.com' }],
    })
    expect(result.isOk()).toBe(true)
    const { items, hasMore } = result._unsafeUnwrap()
    expect(hasMore).toBe(false)
    expect(items).toHaveLength(1)
    expect(items[0]!.recordId).toBe('def-contact:inst-1')
    expect(items[0]!.matchedBy).toEqual({ systemAttribute: 'primary_email', value: 'Jane@X.com' })
    expect(items[0]!.displayName).toBe('Jane')
  })

  it('resolves { fieldId } candidates through the field map', async () => {
    const { db, state } = buildFakeDb([
      { entityId: 'inst-2', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ fieldId: 'field-email-1' as never, value: 'a@x.com' }],
    })
    expect(result._unsafeUnwrap().items[0]!.recordId).toBe('def-contact:inst-2')
    expect(state.distinctCalls).toBe(1)
  })

  it('skips an uncoercible candidate without querying, errs when ALL are invalid', async () => {
    const { db, state } = buildFakeDb([])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'primary_email', value: 'not-an-email' }],
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(state.distinctCalls).toBe(0)
  })

  it('skips invalid candidates but still runs valid ones (best-effort chain)', async () => {
    const { db, state } = buildFakeDb([
      { entityId: 'inst-3', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'primary_email', value: 'garbage' },
        { systemAttribute: 'primary_email', value: 'ok@x.com' },
      ],
    })
    expect(result._unsafeUnwrap().items).toHaveLength(1)
    expect(state.distinctCalls).toBe(1)
  })

  it('skips a candidate whose field does not exist', async () => {
    const { db, state } = buildFakeDb([])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'no_such_field', value: 'x' },
        { systemAttribute: 'primary_email', value: 'ok@x.com' },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(state.distinctCalls).toBe(1)
  })

  it('dedupes across candidates by recordId (earliest candidate wins attribution)', async () => {
    const { db } = buildFakeDb([
      { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'primary_email', value: 'a@x.com' },
        { systemAttribute: 'primary_email', value: 'b@x.com' },
      ],
    })
    const { items } = result._unsafeUnwrap()
    expect(items).toHaveLength(1)
    expect(items[0]!.matchedBy.value).toBe('a@x.com')
  })

  it('sets hasMore when matches exceed limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      entityId: `inst-${i}`,
      displayName: null,
      secondaryDisplayValue: null,
      avatarUrl: null,
    }))
    const { db } = buildFakeDb(rows)
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      limit: 2,
      candidates: [{ systemAttribute: 'primary_email', value: 'a@x.com' }],
    })
    const { items, hasMore } = result._unsafeUnwrap()
    expect(items).toHaveLength(2)
    expect(hasMore).toBe(true)
  })

  it('routes external_id candidates through the RecordIdentity lane', async () => {
    const { db, state } = buildFakeDb(
      [],
      [{ entityId: 'inst-9', displayName: 'Ext', secondaryDisplayValue: null, avatarUrl: null }]
    )
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'external_id', value: 'gmail:jane@x.com' }],
    })
    const { items } = result._unsafeUnwrap()
    expect(items[0]!.recordId).toBe('def-contact:inst-9')
    expect(state.selectCalls).toBe(1)
    expect(state.distinctCalls).toBe(0)
  })

  it('accepts the excludeArchived option (import-planning path)', async () => {
    const { db } = buildFakeDb([
      { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      excludeArchived: true,
      candidates: [{ systemAttribute: 'primary_email', value: 'a@x.com' }],
    })
    expect(result.isOk()).toBe(true)
  })
})
