// packages/lib/src/field-values/resolvers/system-relationship-inbox-defs.test.ts

import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../resources/registry/field-types'
import type { FieldValueContext } from '../field-value-helpers'

/**
 * Plan 40a §8.3 — the thread `inbox` relation must be DUAL-DEF.
 *
 * `batchFetchSystemRelationships` used to take the target definition from the
 * field's `inverseResourceFieldId` ONCE for the whole batch. `Thread.inboxId`
 * is a bare FK, so that constant renders every thread in a `personal_inbox`
 * mailbox with a RecordId whose definition no longer owns the instance.
 *
 * The mixed-batch case is the one that matters: any implementation that keeps a
 * batch-level constant passes the all-shared and all-personal cases by
 * accident and only fails here.
 */

const h = vi.hoisted(() => ({
  cachedInboxes: [] as Array<{ id: string; entityDefinitionKey?: string; isPersonal?: boolean }>,
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.cachedInboxes }),
}))

vi.mock('@auxx/database', () => ({
  schema: {
    Thread: {
      id: 'Thread.id',
      organizationId: 'Thread.organizationId',
      inboxId: {},
      primaryEntityInstanceId: {},
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  inArray: (...c: unknown[]) => c,
}))

vi.mock('../../resources/registry/field-registry', () => ({
  RESOURCE_TABLE_MAP: { thread: { dbName: 'Thread' } },
}))

vi.mock('../../resources/registry/display-config', () => ({
  RESOURCE_DISPLAY_CONFIG: { thread: { orgScopingStrategy: 'direct' } },
}))

import { batchFetchSystemRelationships } from './system-relationship-resolver'

/** The thread `inbox` field as the registry declares it (thread-fields.ts). */
const INBOX_FIELD = {
  key: 'inbox',
  dbColumn: 'inboxId',
  relationship: {
    inverseResourceFieldId: 'inbox:inbox_threads' as ResourceFieldId,
    relationshipType: 'belongs_to',
    isInverse: false,
  },
} as unknown as ResourceField

/** A non-inbox `dbColumn` relation — must keep the ref-derived constant. */
const TICKET_FIELD = {
  key: 'ticket',
  dbColumn: 'primaryEntityInstanceId',
  relationship: {
    inverseResourceFieldId: 'ticket:threads' as ResourceFieldId,
    relationshipType: 'belongs_to',
    isInverse: false,
  },
} as unknown as ResourceField

function ctxWith(rows: Array<{ id: string; fkValue: string | null }>): FieldValueContext {
  return {
    db: { select: () => ({ from: () => ({ where: async () => rows }) }) },
    organizationId: 'org_1',
  } as unknown as FieldValueContext
}

const threadRid = (id: string) => `thread:${id}` as RecordId

beforeEach(() => {
  h.cachedInboxes = []
})

describe('batchFetchSystemRelationships — inbox targets (plan 40a §8.3)', () => {
  it('resolves EACH ROW to its own definition in a mixed batch', async () => {
    h.cachedInboxes = [
      { id: 'i_shared', entityDefinitionKey: 'inbox' },
      { id: 'i_personal', entityDefinitionKey: 'personal_inbox' },
    ]

    const result = await batchFetchSystemRelationships(
      ctxWith([
        { id: 't_1', fkValue: 'i_shared' },
        { id: 't_2', fkValue: 'i_personal' },
        { id: 't_3', fkValue: 'i_shared' },
      ]),
      [threadRid('t_1'), threadRid('t_2'), threadRid('t_3')],
      INBOX_FIELD,
      'thread'
    )

    expect(result.get(threadRid('t_1'))).toEqual(['inbox:i_shared'])
    expect(result.get(threadRid('t_2'))).toEqual(['personal_inbox:i_personal'])
    expect(result.get(threadRid('t_3'))).toEqual(['inbox:i_shared'])
  })

  it('keeps `inbox:` for a shared-only batch (negative control)', async () => {
    h.cachedInboxes = [{ id: 'i_shared', entityDefinitionKey: 'inbox' }]

    const result = await batchFetchSystemRelationships(
      ctxWith([{ id: 't_1', fkValue: 'i_shared' }]),
      [threadRid('t_1')],
      INBOX_FIELD,
      'thread'
    )

    expect(result.get(threadRid('t_1'))).toEqual(['inbox:i_shared'])
  })

  it('follows the definition, not the `isPersonal` marker (059 → 060 window)', async () => {
    h.cachedInboxes = [{ id: 'i_legacy', entityDefinitionKey: 'inbox', isPersonal: true }]

    const result = await batchFetchSystemRelationships(
      ctxWith([{ id: 't_1', fkValue: 'i_legacy' }]),
      [threadRid('t_1')],
      INBOX_FIELD,
      'thread'
    )

    expect(result.get(threadRid('t_1'))).toEqual(['inbox:i_legacy'])
  })

  it('falls back to the shared def for an inbox missing from the cache', async () => {
    h.cachedInboxes = []

    const result = await batchFetchSystemRelationships(
      ctxWith([{ id: 't_1', fkValue: 'i_gone' }]),
      [threadRid('t_1')],
      INBOX_FIELD,
      'thread'
    )

    expect(result.get(threadRid('t_1'))).toEqual(['inbox:i_gone'])
  })

  it('leaves NON-inbox relations on the ref-derived constant', async () => {
    // A `personal_inbox` entry with the same id must not leak across: the
    // dual-def branch is gated on the TARGET definition, not on the fk value.
    h.cachedInboxes = [{ id: 'tk_1', entityDefinitionKey: 'personal_inbox' }]

    const result = await batchFetchSystemRelationships(
      ctxWith([{ id: 't_1', fkValue: 'tk_1' }]),
      [threadRid('t_1')],
      TICKET_FIELD,
      'thread'
    )

    expect(result.get(threadRid('t_1'))).toEqual(['ticket:tk_1'])
  })
})
