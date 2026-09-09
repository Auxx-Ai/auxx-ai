// packages/lib/src/resource-access/member-shares/__tests__/mutations.test.ts

import { schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Journal, makeDb, makeJournal } from '../../../files/__tests__/support'
import type { Lens } from '../../../permissions/visibility'

/**
 * Plan 46 §4 — the bulk revoke's ORDERING and FAN-OUT.
 *
 * The emit rules are the ones this file exists for: one `resource-access.changed`
 * for the grantee, one instance emit per DISTINCT def, and both strictly AFTER the
 * `DELETE` — never per row and never before the write. Sharing one monotonic
 * journal between the db stub and the emitters is what makes "after" assertable
 * rather than inferred.
 *
 * **Not here:** the owner exclusion and the type-row exclusion. Those are WHERE
 * clause properties and the stub does not interpret a WHERE (by design), so they
 * live in `member-shares.int.test.ts` against a real database, where deleting the
 * predicate actually deletes the member's own rows.
 */

const ORG = 'org_1'
const VIEWER = 'u_viewer'
const MEMBER = 'u_member'

const lensByThread = new Map<string, Lens>()
const viewerIsAdmin = { value: false }
const inboxAdmin = new Set<string>()

/** Shared between the db stub and the emitters, so ordering is a real fact. */
let journal: Journal

vi.mock('../../../cache', () => ({
  getCachedUserInstanceGrants: vi.fn(async () => ({
    userId: VIEWER,
    role: 'USER',
    isAdmin: viewerIsAdmin.value,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    grants: {},
    defEntityTypes: {},
  })),
  getOrgCache: () => ({
    get: async () => [
      { id: 'inbox_support', name: 'Support', entityDefinitionKey: 'inbox' },
      { id: 'inbox_sales', name: 'Sales', entityDefinitionKey: 'inbox' },
    ],
  }),
}))

vi.mock('../../../permissions/visibility', () => ({
  getThreadLensBatch: vi.fn(async (_db, _org, _viewer, ids: string[]) => {
    const out = new Map<string, Lens>()
    for (const id of ids) out.set(id, lensByThread.get(id) ?? 'none')
    return out
  }),
}))

vi.mock('../../resource-access-service', () => ({
  hasPermission: vi.fn(async (_ctx: unknown, recordId: string) => inboxAdmin.has(recordId)),
  emitResourceAccessChanged: vi.fn(async () => {
    journal.record('cache', 'emit:changed')
  }),
  emitResourceAccessInstanceChanged: vi.fn(async (_org: string, _g: unknown, def: string) => {
    journal.record('cache', `emit:instance:${def}`)
  }),
  emitResourceAccessTypeChanged: vi.fn(async () => {
    journal.record('cache', 'emit:type')
  }),
}))

import type { RevokeMemberSharesScope } from '../mutations'
import { MAX_REVOKE_RECORD_IDS, revokeMemberShares } from '../mutations'

const TABLES = { ResourceAccess: schema.ResourceAccess, Thread: schema.Thread }

const run = (
  opts: {
    select?: unknown[][]
    delete?: unknown[][]
    scope?: RevokeMemberSharesScope
    enforceMailAuthority?: boolean
  } = {}
) => {
  const fake = makeDb({
    journal,
    tables: TABLES,
    select: opts.select ?? [],
    delete: opts.delete ?? [[]],
  })
  const ctx = { db: fake.db, organizationId: ORG, userId: VIEWER }
  return {
    fake,
    result: revokeMemberShares(ctx, {
      userId: MEMBER,
      scope: opts.scope ?? { kind: 'all' },
      enforceMailAuthority: opts.enforceMailAuthority ?? false,
    }),
  }
}

beforeEach(() => {
  journal = makeJournal()
  lensByThread.clear()
  inboxAdmin.clear()
  viewerIsAdmin.value = false
})

// ─────────────────────────────────────────────────────────────────────────────

describe('one statement, one result', () => {
  it('deletes once and reports the count', async () => {
    const { fake, result } = run({
      delete: [
        [
          { id: 'ra_1', entityDefinitionId: 'snippet' },
          { id: 'ra_2', entityDefinitionId: 'snippet' },
        ],
      ],
    })
    const value = (await result)._unsafeUnwrap()
    expect(value).toMatchObject({ revoked: 2, refused: [], refusedIds: [] })
    expect(fake.deletes).toEqual([{ table: 'ResourceAccess' }])
  })

  it('refuses an empty id list', async () => {
    const { result } = run({ scope: { kind: 'ids', recordIds: [] } })
    expect((await result)._unsafeUnwrapErr()).toMatchObject({ statusCode: 400 })
  })

  it('refuses more ids than the cap — that is what a scope is for', async () => {
    const recordIds = Array.from(
      { length: MAX_REVOKE_RECORD_IDS + 1 },
      (_, i) => `snippet:sn_${i}` as RecordId
    )
    const { result } = run({ scope: { kind: 'ids', recordIds } })
    expect((await result)._unsafeUnwrapErr()).toMatchObject({ statusCode: 400 })
  })

  it('refuses a malformed record id', async () => {
    const { result } = run({ scope: { kind: 'ids', recordIds: ['snippet' as RecordId] } })
    expect((await result)._unsafeUnwrapErr()).toMatchObject({ statusCode: 400 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('emits fire once per distinct def, AFTER the delete', () => {
  it('collapses many rows on one def into one instance emit', async () => {
    const { result } = run({
      delete: [
        Array.from({ length: 40 }, (_, i) => ({ id: `ra_${i}`, entityDefinitionId: 'thread' })),
      ],
    })
    await result
    expect(journal.ops()).toEqual(['delete', 'emit:changed', 'emit:instance:thread'])
  })

  it('fires one instance emit per DISTINCT def, and none before the write', async () => {
    const { result } = run({
      delete: [
        [
          { id: 'ra_1', entityDefinitionId: 'thread' },
          { id: 'ra_2', entityDefinitionId: 'dashboard' },
          { id: 'ra_3', entityDefinitionId: 'thread' },
        ],
      ],
    })
    await result
    expect(journal.ops()).toEqual([
      'delete',
      'emit:changed',
      'emit:instance:thread',
      'emit:instance:dashboard',
    ])
  })

  it('emits nothing when nothing was deleted', async () => {
    const { result } = run({ delete: [[]] })
    await result
    expect(journal.ops('cache')).toEqual([])
  })

  it('never fires the TYPE emit — type rows are out of scope by decision 8', async () => {
    const { result } = run({ delete: [[{ id: 'ra_1', entityDefinitionId: 'snippet' }]] })
    await result
    expect(journal.ops('cache')).not.toContain('emit:type')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('mail rows are refused per inbox, never silently dropped', () => {
  /** Pre-select of mail rows in scope, then the thread read behind the lens batch. */
  const mailSelects = [
    [
      { id: 'ra_1', entityDefinitionId: 'thread', entityInstanceId: 'th_1' },
      { id: 'ra_2', entityDefinitionId: 'thread', entityInstanceId: 'th_2' },
      { id: 'ra_3', entityDefinitionId: 'thread', entityInstanceId: 'th_3' },
    ],
    [
      { id: 'th_1', subject: 'A', inboxId: 'inbox_support' },
      { id: 'th_2', subject: 'B', inboxId: 'inbox_sales' },
      { id: 'th_3', subject: 'C', inboxId: 'inbox_sales' },
    ],
  ]

  it('counts refusals by inbox and itemizes the rows it kept', async () => {
    lensByThread.set('th_1', 'read')
    lensByThread.set('th_2', 'read')
    lensByThread.set('th_3', 'read')
    inboxAdmin.add('inbox:inbox_support')

    const { result } = run({
      select: mailSelects,
      delete: [[{ id: 'ra_1', entityDefinitionId: 'thread' }]],
      enforceMailAuthority: true,
    })
    const value = (await result)._unsafeUnwrap()

    expect(value.revoked).toBe(1)
    expect(value.refused).toEqual([{ reason: 'mail-authority', count: 2, label: 'Sales' }])
    expect([...value.refusedIds].sort()).toEqual(['thread:th_2', 'thread:th_3'])
  })

  it('checks the inbox once per DISTINCT inbox, not once per row', async () => {
    const { hasPermission } = await import('../../resource-access-service')
    lensByThread.set('th_1', 'read')
    lensByThread.set('th_2', 'read')
    lensByThread.set('th_3', 'read')
    vi.mocked(hasPermission).mockClear()
    const { result } = run({ select: mailSelects, enforceMailAuthority: true })
    await result
    // Two distinct inboxes behind three thread rows.
    expect(vi.mocked(hasPermission)).toHaveBeenCalledTimes(2)
  })

  it('refuses every contact row for a non-admin (§5.3)', async () => {
    const { result } = run({
      select: [[{ id: 'ra_1', entityDefinitionId: 'contact', entityInstanceId: 'c_1' }]],
      enforceMailAuthority: true,
    })
    const value = (await result)._unsafeUnwrap()
    expect(value.refused).toEqual([{ reason: 'mail-authority', count: 1, label: 'Contacts' }])
    expect(value.refusedIds).toEqual(['contact:c_1'])
  })

  it('skips the mail pre-select entirely for the offboarding sweep (§7)', async () => {
    const { fake, result } = run({ select: mailSelects, enforceMailAuthority: false })
    const value = (await result)._unsafeUnwrap()
    expect(value.refused).toEqual([])
    expect(value.refusedIds).toEqual([])
    expect(fake.journal.ops('db')).toEqual(['delete'])
  })
})
