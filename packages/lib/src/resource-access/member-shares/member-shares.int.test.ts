// packages/lib/src/resource-access/member-shares/member-shares.int.test.ts
//
// Plan 46 §9 — the assertions that are pure SQL behaviour, against a real
// Postgres.
//
// WHY INTEGRATION. Two of this lane's claims are properties of a WHERE clause and
// nothing else:
//
//   1. **Owner rows are excluded in every revoke scope** (§4.1). 96% of a
//      member's `granteeType: 'user'` rows are self-granted — their own snippets,
//      dashboards, signature and personal mailbox. A stub that records the
//      predicate opaquely can only prove a `where(...)` was passed; it cannot
//      prove the member still has their snippets afterwards, which is the only
//      form of the claim that matters.
//   2. **Keyset paging survives a delete underneath the read** (§3.1). The whole
//      reason the cursor is `(createdAt, id)` and not `OFFSET` is that a sweep
//      shifts every later row up by one. That is a statement about two real
//      statements run against the same rows.
//
// The mocked-db lane covers the rest (`__tests__/queries.test.ts`,
// `__tests__/mutations.test.ts`): the group-by fold, the cursor codec, label
// fallbacks, the mail redaction rule, and emit ordering.
//
// The three cache emitters are mocked. They are the invalidation fan-out, not the
// write, and reaching them here would drag Redis and the realtime stack into a
// test about which rows survive a DELETE. Their ordering is asserted in the unit
// lane, on a shared journal.

import { type Database, schema } from '@auxx/database'
import { ResourceGranteeType } from '@auxx/database/enums'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./../resource-access-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../resource-access-service')>()),
  emitResourceAccessChanged: vi.fn(async () => {}),
  emitResourceAccessInstanceChanged: vi.fn(async () => {}),
  emitResourceAccessTypeChanged: vi.fn(async () => {}),
}))

import { revokeMemberShares } from './mutations'
import { getMemberShareSummary, listMemberShares } from './queries'

const db = () => getTestDb() as never as Database

interface Fixture {
  orgId: string
  /** The member whose Shared tab this is. */
  member: string
  /** The admin doing the sharing and the sweeping. */
  admin: string
  ticketDefId: string
  ticketInstanceId: string
  /** Snippets the member OWNS (self-granted). */
  ownedSnippets: string[]
  /** Snippets somebody SHARED with the member. */
  sharedSnippets: string[]
  /** A dashboard row with a NULL granter — owned by the §3.2 fallback. */
  nullGranterDashboard: string
  /** A `personal_inbox` row granted by the admin — owned unconditionally. */
  personalInboxInstance: string
}

let f: Fixture

const grant = async (over: {
  entityDefinitionId: string
  entityInstanceId: string | null
  grantedById?: string | null
  granteeId?: string
  createdAt?: Date
}) => {
  const [row] = await db()
    .insert(schema.ResourceAccess)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: over.entityDefinitionId,
      entityInstanceId: over.entityInstanceId,
      granteeType: ResourceGranteeType.user,
      granteeId: over.granteeId ?? f.member,
      rung: 'read',
      grantedById: over.grantedById === undefined ? f.admin : over.grantedById,
      ...(over.createdAt ? { createdAt: over.createdAt, updatedAt: over.createdAt } : {}),
    })
    .returning()
  return row!.id
}

const snippet = async (title: string) => {
  const [row] = await db()
    .insert(schema.Snippet)
    .values({
      organizationId: f.orgId,
      title,
      content: title,
      createdById: f.admin,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

const remainingRows = async () =>
  db()
    .select({
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      entityInstanceId: schema.ResourceAccess.entityInstanceId,
      grantedById: schema.ResourceAccess.grantedById,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, f.orgId),
        eq(schema.ResourceAccess.granteeId, f.member)
      )
    )

const ctx = () => ({ db: db(), organizationId: f.orgId, userId: f.admin })

beforeEach(async () => {
  const org = await createTestOrganization()
  const member = await createTestUser({ name: 'Marki Member' })
  const admin = await createTestUser({ name: 'Ada Admin' })

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'ticket',
      apiSlug: 'tickets',
      singular: 'Ticket',
      plural: 'Tickets',
      updatedAt: new Date(),
    })
    .returning()

  const [ticket] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'TKT-0001',
      updatedAt: new Date(),
    })
    .returning()

  const [mailbox] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: "Marki's mailbox",
      updatedAt: new Date(),
    })
    .returning()

  f = {
    orgId: org.id,
    member: member.id,
    admin: admin.id,
    ticketDefId: def!.id,
    ticketInstanceId: ticket!.id,
    ownedSnippets: [],
    sharedSnippets: [],
    nullGranterDashboard: 'dash_null_granter',
    personalInboxInstance: mailbox!.id,
  }

  f.ownedSnippets = [await snippet('My scratch note'), await snippet('My other note')]
  f.sharedSnippets = [await snippet('Refund policy'), await snippet('Shipping delays')]

  // Owned: self-granted.
  for (const id of f.ownedSnippets) {
    await grant({ entityDefinitionId: 'snippet', entityInstanceId: id, grantedById: f.member })
  }
  // Owned: NULL granter on a self-granting def (§3.2's deliberate correction).
  await grant({
    entityDefinitionId: 'dashboard',
    entityInstanceId: f.nullGranterDashboard,
    grantedById: null,
  })
  // Owned: personal_inbox, unconditionally, even granted by an admin.
  await grant({
    entityDefinitionId: 'personal_inbox',
    entityInstanceId: f.personalInboxInstance,
  })
  // Shared: granted by the admin.
  for (const id of f.sharedSnippets) {
    await grant({ entityDefinitionId: 'snippet', entityInstanceId: id })
  }
  await grant({ entityDefinitionId: f.ticketDefId, entityInstanceId: f.ticketInstanceId })
  // A TYPE-level row — the largest grant a member can hold, and never swept.
  await grant({ entityDefinitionId: f.ticketDefId, entityInstanceId: null })
  // Another member's row, to prove the grantee filter.
  await grant({
    entityDefinitionId: 'snippet',
    entityInstanceId: f.sharedSnippets[0]!,
    granteeId: f.admin,
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('getMemberShareSummary against real rows', () => {
  it('counts shared and owned separately, and only this member', async () => {
    const value = (
      await getMemberShareSummary(db(), { organizationId: f.orgId, userId: f.member })
    )._unsafeUnwrap()

    expect(value.groups).toEqual([
      { groupKey: 'record', entityDefinitionId: f.ticketDefId, count: 1, kind: 'type' },
      { groupKey: 'snippet', entityDefinitionId: 'snippet', count: 2, kind: 'instance' },
      { groupKey: 'record', entityDefinitionId: f.ticketDefId, count: 1, kind: 'instance' },
    ])
    expect(value.owned).toEqual([
      { groupKey: 'snippet', count: 2 },
      { groupKey: 'dashboard', count: 1 },
      { groupKey: 'personal_inbox', count: 1 },
    ])
  })
})

describe('listMemberShares against real rows', () => {
  it('lists only the SHARED instance rows, with resolved labels', async () => {
    const page = (
      await listMemberShares(ctx(), {
        organizationId: f.orgId,
        userId: f.member,
        entityDefinitionId: 'snippet',
      })
    )._unsafeUnwrap()

    expect(page.total).toBe(2)
    expect(page.items.map((i) => i.label).sort()).toEqual(['Refund policy', 'Shipping delays'])
  })

  it('resolves a record label from EntityInstance.displayName and an orphan to its id', async () => {
    await grant({ entityDefinitionId: f.ticketDefId, entityInstanceId: 'gone_forever' })
    const page = (
      await listMemberShares(ctx(), {
        organizationId: f.orgId,
        userId: f.member,
        entityDefinitionId: f.ticketDefId,
      })
    )._unsafeUnwrap()

    expect(page.items.map((i) => i.label).sort()).toEqual(['TKT-0001', 'gone_forever'])
    expect(page.items.every((i) => i.blockedReason === null)).toBe(true)
  })

  it('counts matches honestly when a search truncates', async () => {
    for (const title of ['Refund A', 'Refund B', 'Refund C']) {
      await grant({ entityDefinitionId: 'snippet', entityInstanceId: await snippet(title) })
    }
    const page = (
      await listMemberShares(ctx(), {
        organizationId: f.orgId,
        userId: f.member,
        entityDefinitionId: 'snippet',
        q: 'refund',
        limit: 2,
      })
    )._unsafeUnwrap()

    // "Refund policy" + the three new ones.
    expect(page.total).toBe(4)
    expect(page.items).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// KEYSET PAGING (§3.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('keyset paging survives a delete underneath the read', () => {
  const titles = ['s0', 's1', 's2', 's3', 's4', 's5']

  beforeEach(async () => {
    // A clean, deterministically ordered group of its own.
    for (const [i, title] of titles.entries()) {
      await grant({
        entityDefinitionId: 'dataset',
        entityInstanceId: await snippet(title),
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)),
      })
    }
  })

  const page = async (cursor?: string | null) =>
    (
      await listMemberShares(ctx(), {
        organizationId: f.orgId,
        userId: f.member,
        entityDefinitionId: 'dataset',
        cursor,
        limit: 2,
      })
    )._unsafeUnwrap()

  it('walks every row exactly once with no cursor churn', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 5; i += 1) {
      const p: Awaited<ReturnType<typeof page>> = await page(cursor)
      seen.push(...p.items.map((item) => item.recordId))
      cursor = p.nextCursor
      if (!cursor) break
    }
    expect(seen).toHaveLength(6)
    expect(new Set(seen).size).toBe(6)
  })

  it('does not SKIP a row when rows above the cursor are deleted mid-walk', async () => {
    const first = await page()
    expect(first.items).toHaveLength(2)

    // Delete BOTH rows the caller already saw. With OFFSET 2 the next read would
    // start at what is now index 2 and silently skip two rows; a keyset cursor
    // is anchored to a value, not a position.
    await revokeMemberShares(ctx(), {
      userId: f.member,
      scope: { kind: 'ids', recordIds: first.items.map((i) => i.recordId) },
      enforceMailAuthority: false,
    })

    const seen = [...first.items.map((i) => i.recordId)]
    let cursor: string | null = first.nextCursor
    while (cursor) {
      const next: Awaited<ReturnType<typeof page>> = await page(cursor)
      seen.push(...next.items.map((item) => item.recordId))
      cursor = next.nextCursor
    }

    expect(seen).toHaveLength(6)
    expect(new Set(seen).size).toBe(6)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE OWNER EXCLUSION (§4.1 / §9)
// ─────────────────────────────────────────────────────────────────────────────

describe('owner rows survive every revoke scope', () => {
  const scopes: Array<[string, () => Parameters<typeof revokeMemberShares>[1]['scope']]> = [
    ['all', () => ({ kind: 'all' })],
    ['type', () => ({ kind: 'type', entityDefinitionId: 'snippet' })],
    [
      'ids',
      () => ({
        kind: 'ids',
        // Deliberately NAMES the member's own snippets alongside a shared one.
        // The UI would not offer them; the SQL is what has to refuse.
        recordIds: [
          ...f.ownedSnippets.map((id) => `snippet:${id}` as RecordId),
          `snippet:${f.sharedSnippets[0]}` as RecordId,
          `personal_inbox:${f.personalInboxInstance}` as RecordId,
          `dashboard:${f.nullGranterDashboard}` as RecordId,
        ],
      }),
    ],
  ]

  it.each(scopes)('the %s scope keeps every owned row', async (_name, scope) => {
    const result = await revokeMemberShares(ctx(), {
      userId: f.member,
      scope: scope(),
      enforceMailAuthority: false,
    })
    expect(result.isOk()).toBe(true)

    const rows = await remainingRows()
    // Self-granted snippets.
    for (const id of f.ownedSnippets) {
      expect(rows.some((r) => r.entityInstanceId === id)).toBe(true)
    }
    // NULL granter on a self-granting def.
    expect(rows.some((r) => r.entityInstanceId === f.nullGranterDashboard)).toBe(true)
    // personal_inbox, admin-granted, unconditionally owned.
    expect(rows.some((r) => r.entityDefinitionId === 'personal_inbox')).toBe(true)
  })

  it('the all scope removes every SHARED instance row and nothing else', async () => {
    const result = await revokeMemberShares(ctx(), {
      userId: f.member,
      scope: { kind: 'all' },
      enforceMailAuthority: false,
    })
    expect(result._unsafeUnwrap().revoked).toBe(3)

    const rows = await remainingRows()
    for (const id of f.sharedSnippets) {
      expect(rows.some((r) => r.entityInstanceId === id)).toBe(false)
    }
    expect(rows.some((r) => r.entityInstanceId === f.ticketInstanceId)).toBe(false)
    // 2 owned snippets + null-granter dashboard + personal_inbox + the type row.
    expect(rows).toHaveLength(5)
  })

  it('never sweeps a TYPE-level row, in any scope (decision 8)', async () => {
    for (const [, scope] of scopes) {
      await revokeMemberShares(ctx(), {
        userId: f.member,
        scope: scope(),
        enforceMailAuthority: false,
      })
    }
    const rows = await remainingRows()
    expect(rows.filter((r) => r.entityInstanceId === null)).toHaveLength(1)
  })

  it('touches no other grantee', async () => {
    await revokeMemberShares(ctx(), {
      userId: f.member,
      scope: { kind: 'all' },
      enforceMailAuthority: false,
    })
    const adminRows = await db()
      .select({ id: schema.ResourceAccess.id })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, f.orgId),
          eq(schema.ResourceAccess.granteeId, f.admin)
        )
      )
    expect(adminRows).toHaveLength(1)
  })

  it('the type scope narrows to one definition', async () => {
    const result = await revokeMemberShares(ctx(), {
      userId: f.member,
      scope: { kind: 'type', entityDefinitionId: 'snippet' },
      enforceMailAuthority: false,
    })
    expect(result._unsafeUnwrap().revoked).toBe(2)
    const rows = await remainingRows()
    expect(rows.some((r) => r.entityInstanceId === f.ticketInstanceId)).toBe(true)
  })
})
