// packages/lib/src/field-values/__tests__/single-host-mail-lens.test.ts

/**
 * `getValue` / `getValues` — the single-entity siblings of `batchGetValues` —
 * apply the SAME mail lens gate (`mail-lens-gate.ts`), so the two shapes cannot
 * drift. The batch gate's own unit tests live in `mail-lens-gate.test.ts`; this
 * file proves the wiring: a viewer below `identity` cannot read a thread's
 * subject through either function, a `metadata` viewer keeps the metadata-tier
 * fields, and non-mail / no-capability callers pay nothing and change nothing.
 */

import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'

const { findCachedResource, getCachedUserInstanceGrants, getThreadLensBatch } = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  getCachedUserInstanceGrants: vi.fn(),
  getThreadLensBatch: vi.fn(),
}))

// Partial-mock the cache barrel: it is DB/Redis-backed, and a wholesale
// replacement would drop the entries `field-value-helpers` reaches. Only these
// two are on the code path under test.
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource,
  getCachedUserInstanceGrants,
}))
vi.mock('../../permissions/visibility/thread-lens', () => ({ getThreadLensBatch }))

import type { Lens } from '../../permissions/visibility/lens'
import type { CachedField, FieldValueContext } from '../field-value-helpers'
import { getValue, getValues } from '../field-value-queries'

const ORG = 'org_1'
const USER = 'user_1'
const THREAD_ID = 'thr_a'
const THREAD = toRecordId('thread', THREAD_ID)
const CONTACT = toRecordId('contact', 'con_1')

/** Field ids as the FieldValue rows store them, and their resource keys. */
const SUBJECT = 'fld_subject'
const TAGS = 'fld_tags'

const THREAD_RESOURCE = {
  id: 'thread',
  fields: [
    { id: SUBJECT, key: 'subject' },
    { id: TAGS, key: 'tags' },
  ],
}

/** Rows are whatever `orderBy` resolves to — the builder shape is not asserted. */
function fakeDb(rows: unknown[]): FieldValueContext['db'] {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where']) {
    chain[method] = () => chain
  }
  chain.orderBy = () => Promise.resolve(rows)
  return chain as unknown as FieldValueContext['db']
}

function context(overrides: Partial<FieldValueContext> = {}): FieldValueContext {
  return {
    db: fakeDb([]),
    organizationId: ORG,
    userId: USER,
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: {} as FieldValueContext['validator'],
    bypassFieldGuards: new Set(),
    capabilities: {} as FieldValueContext['capabilities'],
    ...overrides,
  }
}

/** A stored TEXT value — what a `thread:subject` read would hand back. */
function textRow(fieldId: string, value: string) {
  return {
    id: `fv_${fieldId}`,
    entityId: THREAD_ID,
    fieldId,
    sortKey: 0,
    valueText: value,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

const TEXT_FIELD = { id: SUBJECT, type: 'TEXT', options: {} } as unknown as CachedField

function lensIs(lens: Lens | null) {
  getThreadLensBatch.mockResolvedValue(
    lens === null ? new Map<string, Lens>() : new Map<string, Lens>([[THREAD_ID, lens]])
  )
}

beforeEach(() => {
  findCachedResource.mockReset().mockImplementation(async (_org: string, key: string) => {
    return key === 'thread' ? THREAD_RESOURCE : null
  })
  getCachedUserInstanceGrants.mockReset().mockResolvedValue({ userId: USER })
  getThreadLensBatch.mockReset().mockResolvedValue(new Map<string, Lens>())
})

describe('getValue — mail lens gate', () => {
  it('withholds a thread subject from a metadata-lens viewer', async () => {
    lensIs('metadata')
    const ctx = context({ db: fakeDb([textRow(SUBJECT, 'Refund for order 1042')]) })

    // `subject` is unlisted in the metadata allowlist ⇒ `identity`.
    expect(await getValue(ctx, { recordId: THREAD, fieldId: SUBJECT }, TEXT_FIELD)).toBeNull()
  })

  it('withholds it from a viewer with no lens on the thread at all', async () => {
    lensIs(null)
    const ctx = context({ db: fakeDb([textRow(SUBJECT, 'Refund for order 1042')]) })

    expect(await getValue(ctx, { recordId: THREAD, fieldId: SUBJECT }, TEXT_FIELD)).toBeNull()
  })

  it('serves the subject at identity', async () => {
    lensIs('identity')
    const ctx = context({ db: fakeDb([textRow(SUBJECT, 'Refund for order 1042')]) })

    const result = await getValue(ctx, { recordId: THREAD, fieldId: SUBJECT }, TEXT_FIELD)
    expect(result).toMatchObject({ type: 'text', value: 'Refund for order 1042' })
  })

  it('keeps a metadata-tier field for a metadata viewer', async () => {
    lensIs('metadata')
    const ctx = context({ db: fakeDb([textRow(TAGS, 'billing')]) })

    const result = await getValue(ctx, { recordId: THREAD, fieldId: TAGS }, {
      ...TEXT_FIELD,
      id: TAGS,
    } as CachedField)
    expect(result).toMatchObject({ type: 'text', value: 'billing' })
  })

  it('withholds a message host outright, without reading a lens', async () => {
    const ctx = context({ db: fakeDb([textRow('fld_textPlain', 'the raw email body')]) })

    const message = toRecordId('message', 'msg_1') as RecordId
    expect(
      await getValue(ctx, { recordId: message, fieldId: 'fld_textPlain' }, TEXT_FIELD)
    ).toBeNull()
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('leaves a non-mail host untouched and pays no I/O', async () => {
    const ctx = context({ db: fakeDb([textRow('fld_email', 'ada@acme.io')]) })

    const result = await getValue(ctx, { recordId: CONTACT, fieldId: 'fld_email' }, TEXT_FIELD)
    expect(result).toMatchObject({ type: 'text', value: 'ada@acme.io' })
    expect(getThreadLensBatch).not.toHaveBeenCalled()
    expect(findCachedResource).not.toHaveBeenCalled()
  })

  it('does not gate an internal caller — no capabilities, no lens read', async () => {
    lensIs('metadata')
    const ctx = context({
      capabilities: undefined,
      db: fakeDb([textRow(SUBJECT, 'Refund for order 1042')]),
    })

    const result = await getValue(ctx, { recordId: THREAD, fieldId: SUBJECT }, TEXT_FIELD)
    expect(result).toMatchObject({ type: 'text', value: 'Refund for order 1042' })
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('fails closed when enforcement is on but no viewer is resolvable', async () => {
    const ctx = context({
      userId: undefined,
      db: fakeDb([textRow(SUBJECT, 'Refund for order 1042')]),
    })

    expect(await getValue(ctx, { recordId: THREAD, fieldId: SUBJECT }, TEXT_FIELD)).toBeNull()
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })
})

describe('getValues — mail lens gate', () => {
  /** `getValues` joins CustomField, so its rows are `{ FieldValue, CustomField }`. */
  function joined(fieldId: string, value: string) {
    return {
      FieldValue: textRow(fieldId, value),
      CustomField: { id: fieldId, type: 'TEXT', options: {} },
    }
  }

  it('drops the subject but keeps the tags for a metadata viewer', async () => {
    lensIs('metadata')
    const ctx = context({
      db: fakeDb([joined(SUBJECT, 'Refund for order 1042'), joined(TAGS, 'billing')]),
    })

    const values = await getValues(ctx, { recordId: THREAD })

    expect(values.has(SUBJECT)).toBe(false)
    expect(values.get(TAGS)).toMatchObject({ type: 'text', value: 'billing' })
  })

  it('returns nothing at all for an invisible thread', async () => {
    lensIs(null)
    const ctx = context({ db: fakeDb([joined(TAGS, 'billing')]) })

    expect(await getValues(ctx, { recordId: THREAD })).toEqual(new Map())
  })

  it('serves both fields at identity', async () => {
    lensIs('identity')
    const ctx = context({
      db: fakeDb([joined(SUBJECT, 'Refund for order 1042'), joined(TAGS, 'billing')]),
    })

    const values = await getValues(ctx, { recordId: THREAD })
    expect([...values.keys()].sort()).toEqual([TAGS, SUBJECT].sort())
  })

  it('leaves a non-mail host untouched and pays no I/O', async () => {
    const ctx = context({ db: fakeDb([joined('fld_email', 'ada@acme.io')]) })

    const values = await getValues(ctx, { recordId: CONTACT })
    expect(values.get('fld_email')).toMatchObject({ type: 'text', value: 'ada@acme.io' })
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('does not gate an internal caller', async () => {
    lensIs('metadata')
    const ctx = context({
      capabilities: undefined,
      db: fakeDb([joined(SUBJECT, 'Refund for order 1042')]),
    })

    const values = await getValues(ctx, { recordId: THREAD })
    expect(values.get(SUBJECT)).toMatchObject({ type: 'text', value: 'Refund for order 1042' })
  })
})
