// packages/lib/src/resource-access/member-shares/__tests__/queries.test.ts

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDb } from '../../../files/__tests__/support'
import type { Lens } from '../../../permissions/visibility'

/**
 * Plan 46 §3 — the parts of the read model that are JS transforms over rows.
 *
 * **What is deliberately NOT here.** The owner exclusion (§4.1) and keyset paging
 * across a delete (§3.1) are properties of a WHERE clause, and the shared db stub
 * does not interpret one on purpose (`files/__tests__/support/db.ts`: "the moment
 * a test needs the fake to interpret SQL, that test wants a pure function or a
 * real database instead"). Both live in `member-shares.int.test.ts` against a real
 * Postgres.
 *
 * What IS here is everything the stub can answer honestly: the group-by fold, the
 * cursor codec, label fallbacks, search matching, and — the load-bearing one —
 * that a viewer below `identity` gets `Conversation in <inbox>` and never a thread
 * subject, in the list path and the search path both (§5.1 / §9).
 */

const ORG = 'org_1'
const VIEWER = 'u_viewer'
const MEMBER = 'u_member'
const ADMIN = 'u_admin'

const lensByThread = new Map<string, Lens>()
const viewerIsAdmin = { value: false }
const inboxAdmin = new Set<string>()

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
  emitResourceAccessChanged: vi.fn(async () => {}),
  emitResourceAccessInstanceChanged: vi.fn(async () => {}),
  emitResourceAccessTypeChanged: vi.fn(async () => {}),
}))

import {
  decodeShareCursor,
  encodeShareCursor,
  getMemberShareSummary,
  listMemberShares,
} from '../queries'

const TABLES = {
  ResourceAccess: schema.ResourceAccess,
  Thread: schema.Thread,
  Snippet: schema.Snippet,
  Agent: schema.Agent,
  EntityInstance: schema.EntityInstance,
  User: schema.User,
}

const at = (iso: string) => new Date(iso)

const shareRow = (over: Record<string, unknown> = {}) => ({
  id: 'ra_1',
  entityDefinitionId: 'snippet',
  entityInstanceId: 'sn_1',
  rung: 'read',
  grantedById: ADMIN,
  createdAt: at('2026-09-01T10:00:00.000Z'),
  ...over,
})

/**
 * `select` results are consumed in call order (the stub's contract), so each
 * helper spells out the sequence the function under test actually fires.
 */
const dbWith = (selects: unknown[][]) => makeDb({ select: selects, tables: TABLES })

const ctxOf = (fake: ReturnType<typeof makeDb>) => ({
  db: fake.db,
  organizationId: ORG,
  userId: VIEWER,
})

beforeEach(() => {
  lensByThread.clear()
  inboxAdmin.clear()
  viewerIsAdmin.value = false
})

// ─────────────────────────────────────────────────────────────────────────────

describe('getMemberShareSummary — the fold', () => {
  it('splits shared from owned, pins type rows, and orders by count', async () => {
    const fake = dbWith([
      [
        { entityDefinitionId: 'thread', isType: false, owned: false, count: 8 },
        { entityDefinitionId: 'snippet', isType: false, owned: true, count: 12 },
        { entityDefinitionId: 'dashboard', isType: false, owned: true, count: 3 },
        { entityDefinitionId: 'contact', isType: false, owned: false, count: 1 },
        { entityDefinitionId: 'clx_ticket_def', isType: true, owned: false, count: 1 },
        { entityDefinitionId: 'personal_inbox', isType: false, owned: true, count: 1 },
      ],
    ])

    const value = (
      await getMemberShareSummary(fake.db, { organizationId: ORG, userId: MEMBER })
    )._unsafeUnwrap()

    expect(value.groups).toEqual([
      { groupKey: 'record', entityDefinitionId: 'clx_ticket_def', count: 1, kind: 'type' },
      { groupKey: 'thread', entityDefinitionId: 'thread', count: 8, kind: 'instance' },
      { groupKey: 'contact', entityDefinitionId: 'contact', count: 1, kind: 'instance' },
    ])
    expect(value.owned).toEqual([
      { groupKey: 'snippet', count: 12 },
      { groupKey: 'dashboard', count: 3 },
      { groupKey: 'personal_inbox', count: 1 },
    ])
  })

  it('is ONE statement — no per-group and no per-row work', async () => {
    const fake = dbWith([[]])
    await getMemberShareSummary(fake.db, { organizationId: ORG, userId: MEMBER })
    expect(fake.journal.ops('db')).toEqual(['select'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('keyset cursor codec', () => {
  it('round-trips (createdAt, id)', () => {
    const decoded = decodeShareCursor(
      encodeShareCursor({ createdAt: at('2026-09-01T10:00:00.000Z'), id: 'ra_9' })
    )
    expect(decoded).toEqual({ createdAt: '2026-09-01T10:00:00.000Z', id: 'ra_9' })
  })

  it.each([
    '',
    'not-base64!!',
    Buffer.from('nopipe').toString('base64url'),
  ])('returns null for the malformed cursor %s', (cursor) => {
    expect(decodeShareCursor(cursor)).toBeNull()
  })

  it('names the LAST row of the page, and only when a further row came back', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      shareRow({
        id: `ra_${i}`,
        entityInstanceId: `sn_${i}`,
        createdAt: at(`2026-09-0${3 - i}T10:00:00.000Z`),
      })
    )
    // limit 2 ⇒ the query asks for 3; three came back, so a page remains.
    const more = ctxOf(dbWith([rows, [{ count: 3 }], []]))
    const page = (
      await listMemberShares(more, {
        organizationId: ORG,
        userId: MEMBER,
        entityDefinitionId: 'snippet',
        limit: 2,
      })
    )._unsafeUnwrap()

    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(3)
    expect(decodeShareCursor(page.nextCursor as string)).toEqual({
      createdAt: '2026-09-02T10:00:00.000Z',
      id: 'ra_1',
    })

    // Same rows, a limit they fit inside ⇒ no cursor.
    const last = ctxOf(dbWith([rows, [{ count: 3 }], []]))
    const tail = await listMemberShares(last, {
      organizationId: ORG,
      userId: MEMBER,
      entityDefinitionId: 'snippet',
      limit: 5,
    })
    expect(tail._unsafeUnwrap().nextCursor).toBeNull()
  })

  it('refuses a cross-organization read', async () => {
    const result = await listMemberShares(ctxOf(dbWith([])), {
      organizationId: 'org_other',
      userId: MEMBER,
      entityDefinitionId: 'snippet',
    })
    expect(result._unsafeUnwrapErr()).toMatchObject({ statusCode: 400 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('label resolution', () => {
  const listOne = async (def: string, instanceId: string, labelRows: unknown[]) => {
    const ctx = ctxOf(
      dbWith([
        [shareRow({ entityDefinitionId: def, entityInstanceId: instanceId })],
        [{ count: 1 }],
        labelRows,
      ])
    )
    return (
      await listMemberShares(ctx, {
        organizationId: ORG,
        userId: MEMBER,
        entityDefinitionId: def,
      })
    )._unsafeUnwrap()
  }

  it('reads a snippet label from Snippet.title', async () => {
    const page = await listOne('snippet', 'sn_1', [{ id: 'sn_1', label: 'Refund policy' }])
    expect(page.items[0]?.label).toBe('Refund policy')
  })

  it("reads an agent's name through the Agent -> User join", async () => {
    const fake = dbWith([
      [shareRow({ entityDefinitionId: 'agent', entityInstanceId: 'ag_1' })],
      [{ count: 1 }],
      [{ id: 'ag_1', label: 'Triage Bot' }],
    ])
    const page = (
      await listMemberShares(ctxOf(fake), {
        organizationId: ORG,
        userId: MEMBER,
        entityDefinitionId: 'agent',
      })
    )._unsafeUnwrap()
    expect(page.items[0]?.label).toBe('Triage Bot')
    // Structural, and one of the few things the stub CAN answer: the label must
    // come from User, because `Agent` has a slug and no name.
    expect(fake.joins).toEqual([{ table: 'User' }])
  })

  it.each([
    'contact',
    'signature',
    'clx_ticket_def',
  ])('reads %s from EntityInstance.displayName', async (def) => {
    viewerIsAdmin.value = true
    const page = await listOne(def, 'ei_1', [{ id: 'ei_1', label: 'Acme Corp' }])
    expect(page.items[0]?.label).toBe('Acme Corp')
  })

  it('renders an ORPHANED row with its raw id and leaves it revocable', async () => {
    const page = await listOne('snippet', 'sn_deleted', [])
    expect(page.items[0]?.label).toBe('sn_deleted')
    expect(page.items[0]?.recordId).toBe('snippet:sn_deleted')
    expect(page.items[0]?.blockedReason).toBeNull()
    expect(page.items[0]?.targetMissing).toBe(true)
  })

  /*
   * The distinction `targetMissing` exists for. `EntityInstance.displayName` is
   * nullable, so a live record can resolve to no label at all — and the earlier
   * shape, which answered "is it gone" with `labels.has(id)`, called that row
   * deleted. It would have tombstoned a real contact in the UI and invited an
   * admin to clear a grant that is still doing work.
   *
   * The two assertions below must disagree: same absent label, opposite verdict.
   */
  it('does NOT tombstone a live row whose displayName is null', async () => {
    viewerIsAdmin.value = true
    const page = await listOne('contact', 'ei_1', [{ id: 'ei_1', label: null }])
    expect(page.items[0]?.label).toBe('ei_1')
    expect(page.items[0]?.targetMissing).toBe(false)
  })

  it('DOES tombstone a row the label query did not find', async () => {
    viewerIsAdmin.value = true
    const page = await listOne('contact', 'ei_1', [])
    expect(page.items[0]?.label).toBe('ei_1')
    expect(page.items[0]?.targetMissing).toBe(true)
  })

  it('resolves the whole page in ONE label query', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      shareRow({ id: `ra_${i}`, entityInstanceId: `sn_${i}` })
    )
    const fake = dbWith([
      rows,
      [{ count: 20 }],
      rows.map((r) => ({ id: r.entityInstanceId, label: 'x' })),
    ])
    await listMemberShares(ctxOf(fake), {
      organizationId: ORG,
      userId: MEMBER,
      entityDefinitionId: 'snippet',
    })
    // page + count + labels, and nothing per row.
    expect(fake.journal.ops('db')).toEqual(['select', 'select', 'select'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('search matches the RESOLVED label', () => {
  const rows = [
    shareRow({ id: 'ra_1', entityInstanceId: 'sn_1' }),
    shareRow({ id: 'ra_2', entityInstanceId: 'sn_2' }),
    shareRow({ id: 'ra_3', entityInstanceId: 'sn_3' }),
  ]
  const labels = [
    { id: 'sn_1', label: 'Refund policy' },
    { id: 'sn_2', label: 'Refund escalation' },
    { id: 'sn_3', label: 'Shipping delays' },
  ]

  const search = async (q: string, limit?: number) =>
    (
      await listMemberShares(ctxOf(dbWith([rows, labels])), {
        organizationId: ORG,
        userId: MEMBER,
        entityDefinitionId: 'snippet',
        q,
        limit,
      })
    )._unsafeUnwrap()

  it('reports the match count even when it truncates the page', async () => {
    const page = await search('refund', 1)
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBeNull()
  })

  it('matches case-insensitively', async () => {
    const page = await search('SHIPPING')
    expect(page.items.map((i) => i.label)).toEqual(['Shipping delays'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE REDACTION ASSERTION (§5.1 / §9)
// ─────────────────────────────────────────────────────────────────────────────

describe('mail labels are per-viewer, never a raw subject', () => {
  const threadRows = [
    shareRow({ id: 'ra_1', entityDefinitionId: 'thread', entityInstanceId: 'th_1' }),
    shareRow({ id: 'ra_2', entityDefinitionId: 'thread', entityInstanceId: 'th_2' }),
  ]
  const threads = [
    { id: 'th_1', subject: 'Re: Invoice 4471', inboxId: 'inbox_support' },
    { id: 'th_2', subject: 'Chargeback dispute', inboxId: 'inbox_sales' },
  ]

  const listThreads = async (q?: string) => {
    // list: page, count, threads. search: scan, threads.
    const selects = q ? [threadRows, threads] : [threadRows, [{ count: 2 }], threads]
    return (
      await listMemberShares(ctxOf(dbWith(selects)), {
        organizationId: ORG,
        userId: MEMBER,
        entityDefinitionId: 'thread',
        q,
      })
    )._unsafeUnwrap()
  }

  it('gives a metadata viewer "Conversation in <inbox>" and never the subject', async () => {
    lensByThread.set('th_1', 'metadata')
    lensByThread.set('th_2', 'metadata')
    const page = await listThreads()
    expect(page.items.map((i) => i.label)).toEqual([
      'Conversation in Support',
      'Conversation in Sales',
    ])
    expect(JSON.stringify(page)).not.toContain('Invoice 4471')
    expect(JSON.stringify(page)).not.toContain('Chargeback')
  })

  it('gives the subject at identity and at read', async () => {
    lensByThread.set('th_1', 'identity')
    lensByThread.set('th_2', 'read')
    const page = await listThreads()
    expect(page.items.map((i) => i.label)).toEqual(['Re: Invoice 4471', 'Chargeback dispute'])
  })

  it('redacts in the SEARCH path too — a subject is not matchable below identity', async () => {
    lensByThread.set('th_1', 'metadata')
    lensByThread.set('th_2', 'metadata')
    const hidden = await listThreads('invoice')
    expect(hidden.items).toHaveLength(0)
    expect(hidden.total).toBe(0)

    const byInbox = await listThreads('support')
    expect(byInbox.items.map((i) => i.label)).toEqual(['Conversation in Support'])
  })

  it('still LISTS and COUNTS a row the viewer cannot read at all', async () => {
    lensByThread.set('th_1', 'none')
    lensByThread.set('th_2', 'none')
    const page = await listThreads()
    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(2)
  })

  it('blocks revoke on a thread whose inbox the viewer does not manage', async () => {
    lensByThread.set('th_1', 'read')
    lensByThread.set('th_2', 'read')
    inboxAdmin.add('inbox:inbox_support')
    const page = await listThreads()
    expect(page.items.map((i) => i.blockedReason)).toEqual([null, 'Needs access to Sales'])
  })

  it('lets an org admin revoke any thread share', async () => {
    viewerIsAdmin.value = true
    lensByThread.set('th_1', 'read')
    lensByThread.set('th_2', 'read')
    const page = await listThreads()
    expect(page.items.every((i) => i.blockedReason === null)).toBe(true)
  })
})
