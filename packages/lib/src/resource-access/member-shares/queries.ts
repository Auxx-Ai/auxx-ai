// packages/lib/src/resource-access/member-shares/queries.ts

import { type Database, schema } from '@auxx/database'
import { ResourceGranteeType, type Rung } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { and, desc, eq, inArray, isNotNull, isNull, not, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedUserInstanceGrants, getOrgCache } from '../../cache'
import { AuxxError, BadRequestError } from '../../errors'
import { satisfiesRung } from '../../permissions/capabilities/rung'
import type { Lens } from '../../permissions/visibility'
import { getThreadLensBatch } from '../../permissions/visibility'
import { isInboxDef, isMailSharingDef } from '../mail-sharing-defs'
import { hasPermission } from '../resource-access-service'
import {
  groupKeyForDef,
  type MemberShareGroupKey,
  NEVER_OWNED_DEFS,
  SELF_GRANTING_DEFS,
} from './classify'

const logger = createScopedLogger('member-shares')

const RA = schema.ResourceAccess

/** Default page size for {@link listMemberShares} (plan 46 §6.5). */
export const MEMBER_SHARES_PAGE_SIZE = 50

/**
 * How many of a group's rows a SEARCH may scan before it truncates (§3.4).
 *
 * Search matches on the RESOLVED, ALREADY-REDACTED label rather than on a SQL
 * `ILIKE` against the source table, and that is deliberate: a `Thread.subject`
 * predicate would match on a subject the viewer may not read and leak it through
 * the result count, which §3.4 forbids. Matching the redacted label cannot leak
 * — below `identity` the label IS `Conversation in <inbox>`, so that is all the
 * search can see. The cost is that the scan is bounded by the member's own row
 * count for the group, not by an index, hence this cap.
 */
export const MEMBER_SHARES_SEARCH_SCAN_CAP = 500

/**
 * The ambient trio for every member-shares read.
 *
 * `userId` is the **VIEWER**, never the subject: mail label resolution runs the
 * thread lens against whoever is looking at the tab (§5.1). The member whose
 * shares are being listed is always the `userId` in the params object.
 */
export interface MemberShareCtx {
  db: Database
  organizationId: string
  userId: string
}

/** One listed share row. */
export interface MemberShareItem {
  /** `${entityDefinitionId}:${entityInstanceId}` — what revoke takes. */
  recordId: RecordId
  /** Resolved label; per-viewer for mail (§5.1). Falls back to the raw id for an orphan. */
  label: string
  /**
   * The target row no longer exists — the grant outlived what it granted (§3.3).
   *
   * Answered by whether the label query FOUND the row, never by whether it
   * produced a label: `EntityInstance.displayName` is nullable, so "no label"
   * and "no row" are different facts and conflating them would tombstone a live
   * record that simply has no display name. The row stays revocable; clearing
   * exactly these is one of the few things this tab can do that nothing else can.
   */
  targetMissing: boolean
  rung: Rung
  grantedById: string | null
  createdAt: Date
  /** null = revocable by this viewer; otherwise why not (§5.2). */
  blockedReason: string | null
}

/** Collapsed first paint: one `GROUP BY`, no labels resolved (§3.1). */
export interface MemberShareSummary {
  groups: Array<{
    groupKey: MemberShareGroupKey
    entityDefinitionId: string
    count: number
    kind: 'instance' | 'type'
  }>
  owned: Array<{ groupKey: MemberShareGroupKey; count: number }>
}

/** Page of one group. */
export interface MemberSharePage {
  items: MemberShareItem[]
  nextCursor: string | null
  total: number
}

/**
 * The SQL form of {@link import('./classify').isOwnerRow} — "this row is the
 * member's OWN property".
 *
 * Built from the same {@link SELF_GRANTING_DEFS} constant the JS classifier
 * reads, so the two cannot drift, and kept as a function (not a module constant)
 * because a Drizzle `SQL` object carries its own parameter placeholders and must
 * not be shared between two positions in one statement — see the `groupBy` note
 * in {@link getMemberShareSummary} for what that costs.
 */
export function ownerRowPredicate(): SQL {
  return sql`(
    ${RA.entityDefinitionId} = 'personal_inbox'
    OR (
      NOT ${inArray(RA.entityDefinitionId, [...NEVER_OWNED_DEFS])}
      AND (
        (${RA.grantedById} IS NULL AND ${inArray(RA.entityDefinitionId, [...SELF_GRANTING_DEFS])})
        OR (${RA.grantedById} IS NOT NULL AND ${RA.grantedById} = ${RA.granteeId})
      )
    )
  )`
}

/**
 * The negation of {@link ownerRowPredicate} — rows genuinely shared WITH the
 * member, and the ONE place the exclusion is expressed for reads and writes both.
 *
 * `mutations.ts` applies it inside its `DELETE`, in every scope. The UI filtering
 * owned rows out of a list is a convenience; this predicate is the contract
 * (§4.1).
 */
export function sharedRowPredicate(): SQL {
  return not(ownerRowPredicate())
}

/** Every row addressed directly to one member, whatever its keyspace. */
export function memberGranteePredicate(organizationId: string, userId: string): SQL {
  return and(
    eq(RA.organizationId, organizationId),
    eq(RA.granteeType, ResourceGranteeType.user),
    eq(RA.granteeId, userId)
  ) as SQL
}

function assertSameOrg(ctxOrganizationId: string, paramOrganizationId: string): void {
  if (ctxOrganizationId !== paramOrganizationId) {
    throw new BadRequestError('Organization scope mismatch')
  }
}

async function guard<T>(fn: () => Promise<T>, message: string): Promise<Result<T, AuxxError>> {
  try {
    return ok(await fn())
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error(message, { error })
    return err(new AuxxError('Internal error'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The collapsed first paint (§3.1): ONE `GROUP BY` over the member's direct
 * rows, ~6-10 rows back, no labels resolved and no per-instance work.
 *
 * Deliberately NOT an extension of `getGranteeAccess` — that read is org-wide and
 * unbounded (§1.2), and hanging a paginated tab off it would make an existing
 * scale problem worse.
 *
 * `groups` carries `kind`, because a TYPE-level row is the largest grant a member
 * can hold and hiding it would make the tab lie about what they have (decision
 * 8). Type rows are shown and individually revocable through `resourceAccess
 * .revokeType`, but never swept — so {@link listMemberShares} and
 * `revokeMemberShares` both work on instance rows only.
 */
export async function getMemberShareSummary(
  db: Database,
  params: { organizationId: string; userId: string }
): Promise<Result<MemberShareSummary, Error>> {
  const { organizationId, userId } = params
  return guard(async () => {
    const rows = await db
      .select({
        entityDefinitionId: RA.entityDefinitionId,
        isType: sql<boolean>`${RA.entityInstanceId} IS NULL`,
        owned: ownerRowPredicate(),
        count: sql<number>`count(*)::int`,
      })
      .from(RA)
      .where(memberGranteePredicate(organizationId, userId))
      // ORDINAL references, NOT the expressions again. Handing the same `SQL`
      // object to `select` and `groupBy` renders it TWICE, with a fresh set of
      // parameter placeholders each time — so `... in ($1,$2,$3)` in the select
      // list and `... in ($9,$10,$11)` in the group-by are not the same
      // expression to Postgres, and it rejects the statement with
      // "grantedById must appear in the GROUP BY clause". Caught by
      // `member-shares.int.test.ts`; a stub db cannot see it.
      .groupBy(sql`1`, sql`2`, sql`3`)

    const groups: MemberShareSummary['groups'] = []
    const ownedByGroup = new Map<MemberShareGroupKey, number>()

    for (const row of rows) {
      const groupKey = groupKeyForDef(row.entityDefinitionId)
      const count = Number(row.count) || 0
      if (row.owned) {
        ownedByGroup.set(groupKey, (ownedByGroup.get(groupKey) ?? 0) + count)
        continue
      }
      groups.push({
        groupKey,
        entityDefinitionId: row.entityDefinitionId,
        count,
        kind: row.isType ? 'type' : 'instance',
      })
    }

    // Type rows pinned first (decision 8), then by count descending (§3.3).
    groups.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'type' ? -1 : 1
      if (b.count !== a.count) return b.count - a.count
      return a.groupKey.localeCompare(b.groupKey)
    })

    const owned = [...ownedByGroup.entries()]
      .map(([groupKey, count]) => ({ groupKey, count }))
      .sort((a, b) => b.count - a.count || a.groupKey.localeCompare(b.groupKey))

    return { groups, owned }
  }, 'Failed to summarize member shares')
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

interface ShareCursor {
  createdAt: string
  id: string
}

/**
 * Keyset cursor on `(createdAt, id)` — **not** `OFFSET` (§3.1).
 *
 * A sweep can delete rows underneath a paging read, and every deleted row above
 * the current offset shifts the whole tail up by one, silently skipping rows the
 * caller never sees. That failure is invisible on a tab whose entire purpose is
 * "show me everything this member holds".
 */
export function encodeShareCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

/** Inverse of {@link encodeShareCursor}. Returns null for anything malformed. */
export function decodeShareCursor(cursor: string): ShareCursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const sep = raw.indexOf('|')
    if (sep === -1) return null
    const createdAt = raw.slice(0, sep)
    const id = raw.slice(sep + 1)
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

/**
 * One page of one group, fired by the group row's expand (§3.1).
 *
 * INSTANCE rows only. A type-level row has no `entityInstanceId` and therefore no
 * `RecordId`, is edited on the Permissions tab, and is never swept — the summary
 * already reports it with `kind: 'type'`, which is everything the tab needs to
 * render it.
 *
 * With `q` set this switches to a bounded label scan rather than a cursor page —
 * see {@link MEMBER_SHARES_SEARCH_SCAN_CAP} for why matching happens on the
 * resolved label and not in SQL.
 */
export async function listMemberShares(
  ctx: MemberShareCtx,
  params: {
    organizationId: string
    userId: string
    entityDefinitionId: string
    cursor?: string | null
    limit?: number
    q?: string
  }
): Promise<Result<MemberSharePage, Error>> {
  const { organizationId, userId, entityDefinitionId } = params
  const limit = params.limit ?? MEMBER_SHARES_PAGE_SIZE

  return guard(async () => {
    assertSameOrg(ctx.organizationId, organizationId)

    const base = and(
      memberGranteePredicate(organizationId, userId),
      eq(RA.entityDefinitionId, entityDefinitionId),
      isNotNull(RA.entityInstanceId),
      sharedRowPredicate()
    ) as SQL

    const q = params.q?.trim()
    if (q) return searchGroup(ctx, entityDefinitionId, base, q, limit)

    const cursor = params.cursor ? decodeShareCursor(params.cursor) : null
    const where = cursor
      ? (and(
          base,
          sql`(${RA.createdAt}, ${RA.id}) < (${cursor.createdAt}::timestamp(3), ${cursor.id})`
        ) as SQL)
      : base

    const [rows, [totals]] = await Promise.all([
      ctx.db
        .select({
          id: RA.id,
          entityDefinitionId: RA.entityDefinitionId,
          entityInstanceId: RA.entityInstanceId,
          rung: RA.rung,
          grantedById: RA.grantedById,
          createdAt: RA.createdAt,
        })
        .from(RA)
        .where(where)
        .orderBy(desc(RA.createdAt), desc(RA.id))
        .limit(limit + 1),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(RA).where(base),
    ])

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const items = await decorateRows(ctx, entityDefinitionId, page)
    const last = page.at(-1)

    return {
      items,
      nextCursor: hasMore && last ? encodeShareCursor(last) : null,
      total: Number(totals?.count ?? 0),
    }
  }, 'Failed to list member shares')
}

/**
 * The `q` lane: scan the group's rows (capped), resolve their labels once, and
 * match on the RESOLVED label.
 *
 * `total` is the number of matches found within the scan, so a truncating group
 * can report "showing 10 of 34 matches" honestly. `nextCursor` is always null —
 * search is not a paged view.
 */
async function searchGroup(
  ctx: MemberShareCtx,
  entityDefinitionId: string,
  base: SQL,
  q: string,
  limit: number
): Promise<MemberSharePage> {
  const rows = await ctx.db
    .select({
      id: RA.id,
      entityDefinitionId: RA.entityDefinitionId,
      entityInstanceId: RA.entityInstanceId,
      rung: RA.rung,
      grantedById: RA.grantedById,
      createdAt: RA.createdAt,
    })
    .from(RA)
    .where(base)
    .orderBy(desc(RA.createdAt), desc(RA.id))
    .limit(MEMBER_SHARES_SEARCH_SCAN_CAP)

  const decorated = await decorateRows(ctx, entityDefinitionId, rows)
  const needle = q.toLowerCase()
  const matches = decorated.filter((item) => item.label.toLowerCase().includes(needle))

  return { items: matches.slice(0, limit), nextCursor: null, total: matches.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// LABELS + BLOCKED REASONS
// ─────────────────────────────────────────────────────────────────────────────

interface RawShareRow {
  id: string
  entityDefinitionId: string
  entityInstanceId: string | null
  rung: Rung
  grantedById: string | null
  createdAt: Date
}

async function decorateRows(
  ctx: MemberShareCtx,
  entityDefinitionId: string,
  rows: RawShareRow[]
): Promise<MemberShareItem[]> {
  const ids = rows.map((r) => r.entityInstanceId).filter((id): id is string => !!id)
  if (ids.length === 0) return []

  // Threads resolve labels and refusals from the SAME lens batch and the same
  // thread read — they are two projections of one answer, and resolving them
  // separately would double both queries for every page.
  if (entityDefinitionId === 'thread') {
    const facts = await loadThreadFacts(ctx, ids)
    const refusals = await resolveThreadRefusals(ctx, facts)
    // `inboxIdByThread` carries one entry per thread the SELECT returned, so its
    // keys are the presence set. `labels` would work here too (both lens
    // branches set one) but it is presence-by-coincidence; this is presence.
    return buildItems(
      rows,
      { labels: facts.labels, present: new Set(facts.inboxIdByThread.keys()) },
      refusals
    )
  }

  const [resolved, refusals] = await Promise.all([
    resolveLabels(ctx, entityDefinitionId, ids),
    resolveMailRefusals(ctx, entityDefinitionId, ids),
  ])
  return buildItems(rows, resolved, refusals)
}

function buildItems(
  rows: RawShareRow[],
  resolved: ResolvedLabels,
  refusals: Map<string, MailRefusal>
): MemberShareItem[] {
  return rows.flatMap((row) => {
    const instanceId = row.entityInstanceId
    if (!instanceId) return []
    return [
      {
        recordId: toRecordId(row.entityDefinitionId, instanceId),
        // An orphan row (target deleted) renders with its raw id and stays
        // revocable — clearing exactly those is what this tab is for (§3.3).
        label: resolved.labels.get(instanceId) ?? instanceId,
        targetMissing: !resolved.present.has(instanceId),
        rung: row.rung,
        grantedById: row.grantedById,
        createdAt: row.createdAt,
        blockedReason: refusals.get(instanceId)?.message ?? null,
      },
    ]
  })
}

/**
 * Simple `id -> name` label sources, one batched query per group (§3.3).
 *
 * Resolved lazily rather than at module scope so a test that pins `schema` does
 * not have to have every table in place at import time.
 */
function simpleLabelSource(entityDefinitionId: string): {
  table: unknown
  id: unknown
  label: unknown
  organizationId: unknown
} | null {
  switch (entityDefinitionId) {
    case 'snippet':
      return {
        table: schema.Snippet,
        id: schema.Snippet.id,
        label: schema.Snippet.title,
        organizationId: schema.Snippet.organizationId,
      }
    case 'sequence':
      return {
        table: schema.Sequence,
        id: schema.Sequence.id,
        label: schema.Sequence.name,
        organizationId: schema.Sequence.organizationId,
      }
    case 'dashboard':
      return {
        table: schema.Dashboard,
        id: schema.Dashboard.id,
        label: schema.Dashboard.name,
        organizationId: schema.Dashboard.organizationId,
      }
    case 'dataset':
      return {
        table: schema.Dataset,
        id: schema.Dataset.id,
        label: schema.Dataset.name,
        organizationId: schema.Dataset.organizationId,
      }
    case 'kb':
      return {
        table: schema.KnowledgeBase,
        id: schema.KnowledgeBase.id,
        label: schema.KnowledgeBase.name,
        organizationId: schema.KnowledgeBase.organizationId,
      }
    case 'workflow':
      return {
        table: schema.WorkflowApp,
        id: schema.WorkflowApp.id,
        label: schema.WorkflowApp.name,
        organizationId: schema.WorkflowApp.organizationId,
      }
    default:
      return null
  }
}

/** Resolve display labels for one group, in ONE batched query (§3.3). */
export async function resolveLabels(
  ctx: MemberShareCtx,
  entityDefinitionId: string,
  ids: string[]
): Promise<ResolvedLabels> {
  if (ids.length === 0) return { labels: new Map(), present: new Set() }
  if (entityDefinitionId === 'thread') {
    const facts = await loadThreadFacts(ctx, ids)
    return { labels: facts.labels, present: new Set(facts.inboxIdByThread.keys()) }
  }

  // `Agent` carries a slug and no name — the display name is User-owned
  // (`schema/agent.ts:128`), reached through `Agent.userId`.
  if (entityDefinitionId === 'agent') {
    const rows = await ctx.db
      .select({ id: schema.Agent.id, label: schema.User.name })
      .from(schema.Agent)
      .innerJoin(schema.User, eq(schema.Agent.userId, schema.User.id))
      .where(
        and(inArray(schema.Agent.id, ids), eq(schema.Agent.organizationId, ctx.organizationId))
      )
    return toLabelMap(rows)
  }

  const simple = simpleLabelSource(entityDefinitionId)
  if (simple) {
    const rows = await ctx.db
      .select({ id: simple.id as never, label: simple.label as never })
      .from(simple.table as never)
      .where(
        and(
          inArray(simple.id as never, ids),
          eq(simple.organizationId as never, ctx.organizationId)
        )
      )
    return toLabelMap(rows as Array<{ id: string; label: string | null }>)
  }

  // Everything else — the inbox defs, `contact`, `signature` (the `Signature`
  // table was retired, `schema/index.ts:172`) and every record-definition CUID —
  // is an `EntityInstance`.
  const rows = await ctx.db
    .select({ id: schema.EntityInstance.id, label: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, ids),
        eq(schema.EntityInstance.organizationId, ctx.organizationId)
      )
    )
  return toLabelMap(rows)
}

/**
 * Labels plus the set of ids the query actually FOUND.
 *
 * Two facts, deliberately separate: a row can exist with a null
 * `EntityInstance.displayName`, so `labels.has(id)` answers "did it produce a
 * name", which is not the same question as "is it still there". Only `present`
 * may drive {@link MemberShareItem.targetMissing}.
 */
interface ResolvedLabels {
  labels: Map<string, string>
  present: Set<string>
}

function toLabelMap(rows: Array<{ id: string; label: string | null }>): ResolvedLabels {
  const labels = new Map<string, string>()
  const present = new Set<string>()
  for (const row of rows) {
    present.add(row.id)
    if (row.label) labels.set(row.id, row.label)
  }
  return { labels, present }
}

interface ThreadFacts {
  /** Per-viewer label — the subject only at `identity` or above (§5.1). */
  labels: Map<string, string>
  inboxIdByThread: Map<string, string | null>
  lenses: Map<string, Lens>
  inboxNameById: Map<string, string>
  viewer: Awaited<ReturnType<typeof getCachedUserInstanceGrants>>
  inboxes: Awaited<ReturnType<typeof loadInboxes>>
}

function loadInboxes(organizationId: string) {
  return getOrgCache().get(organizationId, 'inboxes')
}

/**
 * Thread labels and inbox facts, resolved against the **VIEWER** (§5.1).
 *
 * Printing "Re: Invoice 4471" on a permissions screen is a MAIL READ, and mail
 * visibility is derived per viewer and never gated on admin rank
 * (`docs/channels-mail-architecture-guide.md` §13). So the lens comes from
 * {@link getThreadLensBatch}, one batched call per page:
 *
 *  - `identity` or `read` → the subject
 *  - `metadata` or below  → `Conversation in <inbox name>`, never the subject
 *
 * The row is rendered and counted either way. A row's EXISTENCE is not mail
 * content, and a hidden row is a row that silently survives revoke-all.
 */
async function loadThreadFacts(ctx: MemberShareCtx, ids: string[]): Promise<ThreadFacts> {
  const [threads, viewer, inboxes] = await Promise.all([
    ctx.db
      .select({
        id: schema.Thread.id,
        subject: schema.Thread.subject,
        inboxId: schema.Thread.inboxId,
      })
      .from(schema.Thread)
      .where(
        and(inArray(schema.Thread.id, ids), eq(schema.Thread.organizationId, ctx.organizationId))
      ),
    getCachedUserInstanceGrants(ctx.userId, ctx.organizationId),
    loadInboxes(ctx.organizationId),
  ])

  const lenses = await getThreadLensBatch(
    ctx.db,
    ctx.organizationId,
    viewer,
    threads.map((t) => t.id)
  )
  const inboxNameById = new Map(inboxes.map((i) => [i.id, i.name]))

  const labels = new Map<string, string>()
  const inboxIdByThread = new Map<string, string | null>()
  for (const thread of threads) {
    const inboxId = thread.inboxId ?? null
    inboxIdByThread.set(thread.id, inboxId)
    const lens: Lens = lenses.get(thread.id) ?? 'none'
    if (satisfiesRung(lens, 'identity')) {
      labels.set(thread.id, thread.subject)
      continue
    }
    const inboxName = (inboxId && inboxNameById.get(inboxId)) || 'a mailbox'
    labels.set(thread.id, `Conversation in ${inboxName}`)
  }
  return { labels, inboxIdByThread, lenses, inboxNameById, viewer, inboxes }
}

/** Why a mail row cannot be revoked by this viewer, in both forms (§5.2/§4.1). */
export interface MailRefusal {
  reason: 'mail-authority'
  /** Grouping key for the summary toast — the inbox name, or "Contacts". */
  label: string
  /** Tooltip on the disabled row. */
  message: string
}

/**
 * Why this viewer may not revoke a given MAIL row (§5.2), checked **per distinct
 * inbox** rather than per row — threads group by `inboxId`, so a 200-thread page
 * is a handful of checks.
 *
 * Non-mail rows never appear in the returned map: their gate is `members.manage`
 * + `canManageTarget` in the router (§4.2), deliberately not a per-instance
 * check, because an admin does not necessarily hold `admin` rung on each
 * individual dashboard and a per-row check would make a sweep silently skip rows.
 */
export async function resolveMailRefusals(
  ctx: MemberShareCtx,
  entityDefinitionId: string,
  ids: string[]
): Promise<Map<string, MailRefusal>> {
  const refusals = new Map<string, MailRefusal>()
  if (ids.length === 0 || !isMailSharingDef(entityDefinitionId)) return refusals

  // A contact grant derives to every thread the contact appears on (§5.3) — the
  // widest grant in the model, so v1 keeps it admin-only, matching
  // `assertCanManageMailSharing`.
  if (entityDefinitionId === 'contact') {
    const viewer = await getCachedUserInstanceGrants(ctx.userId, ctx.organizationId)
    if (viewer.isAdmin) return refusals
    for (const id of ids) {
      refusals.set(id, {
        reason: 'mail-authority',
        label: 'Contacts',
        message: 'Only admins can revoke a contact share',
      })
    }
    return refusals
  }

  // An inbox row IS the inbox, so "per distinct inbox" is per row. Rank does not
  // short-circuit here (plan 40 §4.2) — inbox authority is rows only.
  if (isInboxDef(entityDefinitionId)) {
    const inboxes = await loadInboxes(ctx.organizationId)
    const nameById = new Map(inboxes.map((i) => [i.id, i.name]))
    await Promise.all(
      ids.map(async (id) => {
        if (await hasPermission(ctx, toRecordId(entityDefinitionId, id), 'admin')) return
        const name = nameById.get(id) ?? 'this mailbox'
        refusals.set(id, {
          reason: 'mail-authority',
          label: name,
          message: 'Only inbox managers can change inbox access',
        })
      })
    )
    return refusals
  }

  if (entityDefinitionId !== 'thread') return refusals
  return resolveThreadRefusals(ctx, await loadThreadFacts(ctx, ids))
}

/**
 * The thread arm of {@link resolveMailRefusals}, taking facts already loaded.
 *
 * Mirrors `assertCanManageMailSharing`'s `thread` branch: org admins pass, and
 * everyone else needs `read` on the thread AND `admin` rung on the thread's
 * inbox. The inbox check runs once per DISTINCT inbox.
 */
async function resolveThreadRefusals(
  ctx: MemberShareCtx,
  facts: ThreadFacts
): Promise<Map<string, MailRefusal>> {
  const refusals = new Map<string, MailRefusal>()
  if (facts.viewer.isAdmin) return refusals

  const distinctInboxIds = [
    ...new Set([...facts.inboxIdByThread.values()].filter((id): id is string => !!id)),
  ]
  const manageable = new Set<string>()
  await Promise.all(
    distinctInboxIds.map(async (inboxId) => {
      const inbox = facts.inboxes.find((i) => i.id === inboxId)
      const recordId = toRecordId(inbox?.entityDefinitionKey ?? 'inbox', inboxId)
      if (await hasPermission(ctx, recordId, 'admin')) manageable.add(inboxId)
    })
  )

  for (const [threadId, inboxId] of facts.inboxIdByThread) {
    const lens = facts.lenses.get(threadId) ?? 'none'
    if (inboxId && manageable.has(inboxId) && satisfiesRung(lens, 'read')) continue
    const name = (inboxId && facts.inboxNameById.get(inboxId)) || 'this mailbox'
    refusals.set(threadId, {
      reason: 'mail-authority',
      label: name,
      message: `Needs access to ${name}`,
    })
  }
  return refusals
}

/**
 * Type-level rows this member holds — the pinned group (decision 8).
 *
 * Read straight off the same table with no pagination: the unique constraint
 * makes it one row per `(def, grantee)`, so the whole set is bounded by the
 * number of definitions in the org. Kept out of {@link listMemberShares} because
 * a type row has no instance and therefore no `RecordId`, and because it is
 * revoked through `resourceAccess.revokeType`, never swept.
 */
export async function listMemberTypeGrants(
  db: Database,
  params: { organizationId: string; userId: string }
): Promise<Result<Array<{ entityDefinitionId: string; rung: Rung; createdAt: Date }>, Error>> {
  return guard(async () => {
    return db
      .select({
        entityDefinitionId: RA.entityDefinitionId,
        rung: RA.rung,
        createdAt: RA.createdAt,
      })
      .from(RA)
      .where(
        and(
          memberGranteePredicate(params.organizationId, params.userId),
          isNull(RA.entityInstanceId),
          sharedRowPredicate()
        )
      )
      .orderBy(desc(RA.createdAt))
  }, 'Failed to list member type grants')
}
