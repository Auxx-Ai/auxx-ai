// packages/lib/src/field-values/personal-inbox-recordid-canonicalization.test.ts

import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 / 40a §1.3 — what `ENTITY_DEFINITION_TYPES` membership BUYS the
 * `personal_inbox` def.
 *
 * Relationship RecordIds are persisted with the def CUID, not the entity-type
 * slug. `canonicalizeRelationshipRecordId` is the converter, and its entire gate
 * is `isEntityDefinitionType(prefix)` — i.e. the `ENTITY_DEFINITION_TYPES` list.
 * A def missing from that list falls straight through: the literal slug is
 * written into `FieldValue`, where nothing downstream resolves it to a def and
 * the reference silently dangles.
 *
 * The `personal_inbox` half only; the general behavior is exercised by the
 * existing relationship tests.
 */

const getCachedEntityDefId = vi.fn(
  async (_org: string, _type: string) => undefined as string | undefined
)

vi.mock('../cache', () => ({
  getCachedEntityDefId: (...a: unknown[]) => getCachedEntityDefId(...(a as [string, string])),
  findCachedResource: vi.fn(async () => undefined),
  getCachedResource: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => undefined) })),
}))

vi.mock('../realtime', () => ({
  getRealtimeService: vi.fn(() => ({ publish: vi.fn(async () => {}) })),
  rooms: { org: (id: string) => `org:${id}` },
}))

import { isEntityDefinitionType } from '@auxx/types/resource'
import {
  canonicalizeRelationshipRecordId,
  canonicalizeRelationshipValue,
  type FieldValueContext,
} from './field-value-helpers'

const ORG = 'org_1'
const PERSONAL_INBOX_DEF_ID = 'pi000defcuid00000000000000'

/** Only the fields `canonicalizeRelationshipRecordId` touches. */
const ctx = () => ({ organizationId: ORG }) as unknown as FieldValueContext

beforeEach(() => {
  getCachedEntityDefId.mockReset()
  getCachedEntityDefId.mockImplementation(async (_org, type) =>
    type === 'personal_inbox' ? PERSONAL_INBOX_DEF_ID : undefined
  )
})

describe('personal_inbox RecordIds canonicalize to the org def id', () => {
  it('is a recognised EntityDefinition type', () => {
    expect(isEntityDefinitionType('personal_inbox')).toBe(true)
  })

  it('resolves the slug prefix to the org EntityDefinition CUID', async () => {
    const out = await canonicalizeRelationshipRecordId(
      ctx(),
      toRecordId('personal_inbox', 'pi_1') as RecordId
    )
    expect(out).toBe(`${PERSONAL_INBOX_DEF_ID}:pi_1`)
    expect(getCachedEntityDefId).toHaveBeenCalledWith(ORG, 'personal_inbox')
  })

  it('leaves an already-canonical CUID prefix untouched, without a cache lookup', async () => {
    const already = `${PERSONAL_INBOX_DEF_ID}:pi_1` as RecordId
    expect(await canonicalizeRelationshipRecordId(ctx(), already)).toBe(already)
    expect(getCachedEntityDefId).not.toHaveBeenCalled()
  })

  it('fails soft when the org has no such def yet (phase 1 is behavior-inert)', async () => {
    getCachedEntityDefId.mockResolvedValue(undefined)
    const input = toRecordId('personal_inbox', 'pi_1') as RecordId
    expect(await canonicalizeRelationshipRecordId(ctx(), input)).toBe(input)
  })

  it('memoizes per-ctx across a batch', async () => {
    const shared = ctx()
    await canonicalizeRelationshipRecordId(shared, toRecordId('personal_inbox', 'a') as RecordId)
    await canonicalizeRelationshipRecordId(shared, toRecordId('personal_inbox', 'b') as RecordId)
    expect(getCachedEntityDefId).toHaveBeenCalledTimes(1)
  })

  it('applies through the typed-value wrapper the write path actually calls', async () => {
    const out = await canonicalizeRelationshipValue(ctx(), {
      type: 'relationship',
      recordId: toRecordId('personal_inbox', 'pi_1'),
    } as never)
    expect(out).toMatchObject({ recordId: `${PERSONAL_INBOX_DEF_ID}:pi_1` })
  })
})
