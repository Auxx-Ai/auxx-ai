// packages/lib/src/approval-requests/approval-request-queries.ts
//
// Reads over the `ApprovalRequest` / `ApprovalResponse` pair, for BOTH kinds.
//
// **No permission checks live here** (module guide §6). `canUserViewApproval` /
// `canUserApprove` are the approval *audience* predicates — membership of the
// snapshotted assignee set — not an authorization layer: the router asserts, and
// the access lane revalidates real mail authority at decision time
// (`access-request-mutations.ts`). The only guards below are identity ones: org
// scope and existence.

import { type Database, schema } from '@auxx/database'
import { ApprovalStatus, MemberType } from '@auxx/database/enums'
import type { ApprovalStatus as ApprovalStatusType } from '@auxx/database/types'
import {
  and,
  arrayContains,
  arrayOverlaps,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedMembersByUserIds, getCachedUserGroupIds, isOrgMember } from '../cache'
import { guard } from './guard'
import type { ApprovalRequestEntity } from './types'

/**
 * The run-status filter, made KIND-AWARE (plan 28 H1).
 *
 * EXPORTED for tests. Not for reuse: it is exported because the predicate is
 * duplicated across the two queries below (list + badge), and a fix applied to
 * only one leaves the badge lying — so the builders themselves are what the
 * regression test pins, rendered to SQL against the real columns.
 *
 * The pending list and the badge count both `leftJoin(WorkflowRun)` and then
 * required `WorkflowRun.status IN ('RUNNING','WAITING')`. An `access`-kind row has
 * `workflowRunId IS NULL`, so the join yields NULL, `NULL IN (…)` is NULL rather
 * than true, and **the row is silently excluded from both surfaces** — the shape
 * of bug that ships an entire feature invisible.
 */
export function runStillActiveOrNotWorkflow(): SQL | undefined {
  return or(
    ne(schema.ApprovalRequest.kind, 'workflow'),
    inArray(schema.WorkflowRun.status, ['RUNNING', 'WAITING'])
  )
}

/**
 * The expiry filter, made NULL-SAFE (plan 42 §11 item 8 — H1's sibling, and a
 * SECOND independent exclusion that fixing the join does not touch).
 *
 * `expiresAt` is nullable and both predicates filtered `gt(expiresAt, now())`.
 * `NULL > now()` is NULL, so a request with no expiry was invisible in the list
 * AND the badge. It was also self-contradictory at HEAD: {@link canUserApprove}
 * documents the same column as "a request with no expiry never expires", so such
 * a request was decidable-but-unlistable. This picks that reading and makes the
 * two agree.
 *
 * The access lane always sets a 14-day expiry, so this is defence in depth rather
 * than the mechanism — but the predicate is duplicated across two queries, and a
 * fix applied to only one leaves the badge lying.
 */
export function notExpired(): SQL | undefined {
  return or(
    isNull(schema.ApprovalRequest.expiresAt),
    gt(schema.ApprovalRequest.expiresAt, new Date())
  )
}

/** The assignee-match predicate for one member (direct or through a group). */
function assignedTo(userId: string, userGroupIds: string[]): SQL | undefined {
  return or(
    arrayContains(schema.ApprovalRequest.assigneeUsers, [userId]),
    // arrayOverlaps, not a hand-written `&&`: the `sql` template flattens a JS
    // array into one parameter per element, so Postgres received a bare string
    // where it wanted an array literal and threw 22P02.
    userGroupIds.length > 0
      ? arrayOverlaps(schema.ApprovalRequest.assigneeGroups, userGroupIds)
      : sql`false`
  )
}

/**
 * "This request can still be decided" — the `pending` view's predicate, and the
 * NEGATION of the `past` view's.
 *
 * Defining the two views as `p` and `NOT p` over one builder is what makes them a
 * PARTITION: every row the member can see is in exactly one of them. Spelling
 * `past` out as a status list instead would silently strand the rows that are
 * dead without being terminal — a `pending` access request whose 14-day
 * `expiresAt` lapsed is never rewritten to `timeout` (only the workflow lane has a
 * cleanup, `cleanupApprovalsForWorkflowRun`), so a status-list `past` would drop
 * it from both surfaces and it would exist nowhere in the UI.
 *
 * `not()` is sound here only because none of the three conjuncts can evaluate to
 * NULL (`NOT NULL` is NULL, which would silently exclude the row — the same shape
 * of bug H1 and its sibling were): `status` is NOT NULL; {@link notExpired} is an
 * `IS NULL` disjunction; and {@link runStillActiveOrNotWorkflow}'s first arm is
 * TRUE for every non-workflow row, while a workflow row always has an FK-backed
 * run to join (`ApprovalRequest_workflow_columns_check`).
 */
function stillActionable(): SQL {
  // Narrowed here rather than at the `not()` call site: `and()` is typed
  // `SQL | undefined` because it returns undefined when EVERY argument is, and
  // `eq()` on a non-null column never is. `not()` is the one caller that cannot
  // take the wider type.
  return and(
    eq(schema.ApprovalRequest.status, ApprovalStatus.pending),
    notExpired(),
    runStillActiveOrNotWorkflow()
  ) as SQL
}

/** Which slice of the member's approvals to list. */
export type ApprovalListView = 'pending' | 'past'

export interface ListApprovalsForUserArgs {
  /** Defaults to `pending`, which is the pre-history behaviour of this query. */
  view?: ApprovalListView
  cursor?: string
  limit?: number
}

function encodeApprovalCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url')
}

function decodeApprovalCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  if (!createdAt || !id) return undefined
  const parsed = new Date(createdAt)
  return Number.isNaN(parsed.getTime()) ? undefined : { createdAt: parsed, id }
}

/**
 * One member's approvals — both kinds, in one list, in either of two views.
 *
 * - `pending` (default) is what still needs a decision FROM THIS MEMBER, so its
 *   audience is the assignee set alone.
 * - `past` is what this member was INVOLVED IN, so the audience additionally
 *   admits the rows they filed themselves. Without that, a requester could never
 *   see the outcome of their own access request: a requester is never in
 *   `assigneeUsers`, and a `denied` row is the one case where they got no access
 *   to hydrate the target from either.
 *
 * The two audiences are deliberately asymmetric. Folding `createdById` into the
 * pending audience too would surface a member's own open request under "needs a
 * decision", which they cannot act on.
 *
 * The access-lane columns are projected alongside the workflow ones because the
 * rows H1 stopped excluding are useless to the Approvals tab without them.
 *
 * `requester` and (for decided rows) `decision.by` are resolved for the whole page
 * in ONE org-member cache read rather than `User` joins or per-row queries (plan
 * 42 §6.2's rule, applied to the approver side): "who asked" is the lead of an
 * access row's collapsed copy and "who decided" is the lead of a past row's, so
 * neither can be deferred to the lazily-fetched detail drawer without the row
 * rendering anonymous.
 *
 * ⚠ **The `past` view has no covering index.** Both audience GINs are partial on
 * `status = 'pending'` (deliberately — see the schema), so this falls back to
 * `ApprovalRequest_organizationId_idx` and rechecks the assignee arrays on the
 * heap. It is bounded by the page limit and by how rarely history is opened; the
 * fix, if it ever bites, is to drop the partial predicate rather than to widen
 * this query's filters.
 */
export async function listApprovalsForUser(
  db: Database,
  organizationId: string,
  userId: string,
  args: ListApprovalsForUserArgs = {}
) {
  const view = args.view ?? 'pending'
  const limit = Math.min(args.limit ?? 25, 100)
  const isPast = view === 'past'
  const userGroups = await getCachedUserGroupIds(organizationId, userId)
  const cursor = decodeApprovalCursor(args.cursor)

  // `past` reads newest-first — a history is scanned backwards from the last
  // decision. `pending` keeps its original oldest-first order; the Approvals tab
  // re-sorts that section by deadline anyway, so this only decides ties among
  // rows with no expiry, where oldest-first is the fairer queue.
  //
  // Ordered by `createdAt`, NOT by when the decision landed: there is no
  // decided-at column, and `ApprovalResponse.respondedAt` exists only for
  // approve/deny. `withdrawn` and `timeout` are bare status writes with no
  // response row, so ordering on the join would strand them at one end.
  const cursorCondition = cursor
    ? isPast
      ? sql`(${schema.ApprovalRequest.createdAt}, ${schema.ApprovalRequest.id}) < (${cursor.createdAt}, ${cursor.id})`
      : sql`(${schema.ApprovalRequest.createdAt}, ${schema.ApprovalRequest.id}) > (${cursor.createdAt}, ${cursor.id})`
    : undefined

  const selected = await db
    .select({
      id: schema.ApprovalRequest.id,
      organizationId: schema.ApprovalRequest.organizationId,
      kind: schema.ApprovalRequest.kind,
      status: schema.ApprovalRequest.status,
      message: schema.ApprovalRequest.message,
      subjectLabel: schema.ApprovalRequest.subjectLabel,
      expiresAt: schema.ApprovalRequest.expiresAt,
      assigneeUsers: schema.ApprovalRequest.assigneeUsers,
      assigneeGroups: schema.ApprovalRequest.assigneeGroups,
      createdAt: schema.ApprovalRequest.createdAt,
      workflowId: schema.ApprovalRequest.workflowId,
      workflowRunId: schema.ApprovalRequest.workflowRunId,
      requesterId: schema.ApprovalRequest.requesterId,
      targetKind: schema.ApprovalRequest.targetKind,
      entityDefinitionId: schema.ApprovalRequest.entityDefinitionId,
      entityInstanceId: schema.ApprovalRequest.entityInstanceId,
      area: schema.ApprovalRequest.area,
      requestedLevel: schema.ApprovalRequest.requestedLevel,
      requestedLens: schema.ApprovalRequest.requestedLens,
      grantedLevel: schema.ApprovalRequest.grantedLevel,
      grantedLens: schema.ApprovalRequest.grantedLens,
      workflow: {
        name: schema.Workflow.name,
        id: schema.Workflow.id,
      },
      workflowRun: {
        status: schema.WorkflowRun.status,
      },
    })
    .from(schema.ApprovalRequest)
    .leftJoin(schema.Workflow, eq(schema.ApprovalRequest.workflowId, schema.Workflow.id))
    .leftJoin(schema.WorkflowRun, eq(schema.ApprovalRequest.workflowRunId, schema.WorkflowRun.id))
    .where(
      and(
        eq(schema.ApprovalRequest.organizationId, organizationId),
        isPast ? not(stillActionable()) : stillActionable(),
        isPast
          ? or(
              assignedTo(userId, userGroups),
              eq(schema.ApprovalRequest.createdById, userId),
              // Redundant with `createdById` for today's self-service flow, and
              // deliberately not folded into it: the schema separates the two for
              // a future admin-filed-on-behalf-of request, and that request's
              // subject must still see its own outcome.
              eq(schema.ApprovalRequest.requesterId, userId)
            )
          : assignedTo(userId, userGroups),
        cursorCondition
      )
    )
    .orderBy(
      ...(isPast
        ? [desc(schema.ApprovalRequest.createdAt), desc(schema.ApprovalRequest.id)]
        : [asc(schema.ApprovalRequest.createdAt), asc(schema.ApprovalRequest.id)])
    )
    .limit(limit + 1)

  const hasMore = selected.length > limit
  const rows = hasMore ? selected.slice(0, limit) : selected
  const last = rows[rows.length - 1]
  const nextCursor = hasMore && last ? encodeApprovalCursor(last.createdAt, last.id) : undefined

  // Only the `past` view can carry decisions, and only approve/deny write a
  // response row at all — a `withdrawn`, `timeout` or lapsed row has none, and
  // renders on its status alone.
  const decidedIds = isPast ? rows.map((row) => row.id) : []
  const responses = decidedIds.length
    ? await db
        .select({
          approvalRequestId: schema.ApprovalResponse.approvalRequestId,
          userId: schema.ApprovalResponse.userId,
          action: schema.ApprovalResponse.action,
          comment: schema.ApprovalResponse.comment,
          respondedAt: schema.ApprovalResponse.respondedAt,
        })
        .from(schema.ApprovalResponse)
        .where(inArray(schema.ApprovalResponse.approvalRequestId, decidedIds))
    : []
  // Fetched as a second query rather than a join: the unique index is on
  // `(approvalRequestId, userId)`, so a join is a fan-out risk that would
  // duplicate list rows, and the page's decider ids fold into the same member
  // cache read the requesters already pay for.
  const byRequestId = new Map(responses.map((response) => [response.approvalRequestId, response]))

  const memberIds = [
    ...new Set([
      ...rows.flatMap((row) => (row.requesterId ? [row.requesterId] : [])),
      ...responses.map((response) => response.userId),
    ]),
  ]
  const members = memberIds.length ? await getCachedMembersByUserIds(organizationId, memberIds) : []
  const byUserId = new Map(members.map((member) => [member.userId, member]))
  const toPerson = (id: string | null | undefined) => {
    const member = id ? byUserId.get(id) : undefined
    return member
      ? {
          userId: member.userId,
          name: member.user?.name ?? null,
          image: member.user?.image ?? null,
        }
      : null
  }

  const items = rows.map((row) => {
    const response = byRequestId.get(row.id)
    return {
      ...row,
      requester: toPerson(row.requesterId),
      decision: response
        ? {
            action: response.action,
            comment: response.comment,
            respondedAt: response.respondedAt,
            by: toPerson(response.userId),
          }
        : null,
    }
  })

  return { items, nextCursor }
}

/**
 * Badge count for the Approvals tab. The predicate is DELIBERATELY identical to
 * {@link listApprovalsForUser}'s `pending` view — they are duplicated in SQL, so
 * both H1 and the null-expiry reading have to be applied twice or the badge
 * disagrees with the list. {@link stillActionable} is what they now share.
 *
 * Stays pending-only, and takes no `view`: this is the number on the bell, and
 * history is not a thing anyone needs to be counted at.
 */
export async function getPendingCount(
  db: Database,
  organizationId: string,
  userId: string
): Promise<number> {
  const userGroups = await getCachedUserGroupIds(organizationId, userId)
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.ApprovalRequest)
    .leftJoin(schema.WorkflowRun, eq(schema.ApprovalRequest.workflowRunId, schema.WorkflowRun.id))
    .where(
      and(
        eq(schema.ApprovalRequest.organizationId, organizationId),
        stillActionable(),
        assignedTo(userId, userGroups)
      )
    )
  // `count(*)` is int8, which pg hands back as a string. The caller adds this to
  // the suggestion count for the tab badge, so leaving it would concatenate.
  return Number(row?.count ?? 0)
}

/**
 * The audience columns both predicates below read, fetched ONCE.
 *
 * `canUserApprove` used to read the row for `status`/`expiresAt` and then call
 * `canUserViewApproval`, which read the SAME row again for the assignee columns —
 * and the router then calls `resolveApprovalRequest`, which reads it a third time
 * inside the decision transaction. Projecting all four columns in one read
 * collapses the first two; the third is the transactional one and has to stay
 * (its read is what the atomic claim is built on).
 */
async function loadApprovalAudienceRow(db: Database, approvalRequestId: string) {
  return db.query.ApprovalRequest.findFirst({
    where: eq(schema.ApprovalRequest.id, approvalRequestId),
    columns: {
      organizationId: true,
      status: true,
      expiresAt: true,
      assigneeUsers: true,
      assigneeGroups: true,
    },
  })
}

/**
 * Whether a user is in the approval audience of an ALREADY-LOADED request row.
 *
 * Membership is the cached {@link isOrgMember}, not a direct `OrganizationMember`
 * query: this runs on every drawer open and every decision, and org membership is
 * one of the hottest cache keys there is.
 */
async function isInApprovalAudience(
  userId: string,
  request: {
    organizationId: string
    assigneeUsers: string[] | null
    assigneeGroups: string[] | null
  }
): Promise<boolean> {
  if (!(await isOrgMember(request.organizationId, userId))) return false

  const userGroupIds = await getCachedUserGroupIds(request.organizationId, userId)
  // `?? []` — both columns are nullable `text().array()` and a NULL THROWS here
  // (plan 28 H3). The access lane always writes both arrays (possibly empty, never
  // NULL); this is the read-side half of the same invariant.
  return (
    (request.assigneeUsers ?? []).includes(userId) ||
    (request.assigneeGroups ?? []).some((groupId) => userGroupIds.includes(groupId))
  )
}

/**
 * Whether a user is in a request's approval AUDIENCE — an org member named
 * directly or through one of their groups.
 *
 * Deliberately separate from {@link canUserApprove}: it says nothing about whether
 * the request is still actionable. Reading a request you already decided, or one
 * that expired, is legitimate; only acting on it is not.
 */
export async function canUserViewApproval(
  db: Database,
  userId: string,
  approvalRequestId: string
): Promise<boolean> {
  const request = await loadApprovalAudienceRow(db, approvalRequestId)
  if (!request) return false
  return isInApprovalAudience(userId, request)
}

/**
 * Whether a user may ACT on a request — an approver (see
 * {@link canUserViewApproval}) on a request that is still pending and unexpired.
 *
 * This is the audience gate only. For an `access` row it is NOT sufficient
 * authorization to write a grant: the snapshot is 14 days old by the end of a
 * request's life, so `applyAccessDecision` revalidates the acting approver's real
 * mail authority inside the winning claim (plan 42 §3).
 */
export async function canUserApprove(
  db: Database,
  userId: string,
  approvalRequestId: string
): Promise<boolean> {
  const request = await loadApprovalAudienceRow(db, approvalRequestId)
  if (!request || request.status !== ApprovalStatus.pending) return false
  // Nullable in the schema — a request with no expiry never expires. The explicit
  // truthiness guard is load-bearing (plan 28 H2): `null < new Date()` coerces
  // null→0 in JS and evaluates TRUE, so a bare comparison makes a null-expiry
  // request permanently UN-approvable. {@link notExpired} is the SQL side of the
  // same reading — the two agree now; at HEAD they did not.
  if (request.expiresAt && request.expiresAt < new Date()) return false
  return isInApprovalAudience(userId, request)
}

/** One request with full workflow-run / response context, for the decision drawer. */
export async function getApprovalRequestWithContext(db: Database, approvalRequestId: string) {
  const [approvalRequest] = await db
    .select({
      id: schema.ApprovalRequest.id,
      organizationId: schema.ApprovalRequest.organizationId,
      kind: schema.ApprovalRequest.kind,
      workflowId: schema.ApprovalRequest.workflowId,
      workflowRunId: schema.ApprovalRequest.workflowRunId,
      nodeId: schema.ApprovalRequest.nodeId,
      nodeName: schema.ApprovalRequest.nodeName,
      subjectLabel: schema.ApprovalRequest.subjectLabel,
      status: schema.ApprovalRequest.status,
      message: schema.ApprovalRequest.message,
      assigneeUsers: schema.ApprovalRequest.assigneeUsers,
      assigneeGroups: schema.ApprovalRequest.assigneeGroups,
      expiresAt: schema.ApprovalRequest.expiresAt,
      createdAt: schema.ApprovalRequest.createdAt,
      requesterId: schema.ApprovalRequest.requesterId,
      targetKind: schema.ApprovalRequest.targetKind,
      entityDefinitionId: schema.ApprovalRequest.entityDefinitionId,
      entityInstanceId: schema.ApprovalRequest.entityInstanceId,
      area: schema.ApprovalRequest.area,
      requestedLevel: schema.ApprovalRequest.requestedLevel,
      grantedLevel: schema.ApprovalRequest.grantedLevel,
      requestedLens: schema.ApprovalRequest.requestedLens,
      grantedLens: schema.ApprovalRequest.grantedLens,
      metadata: schema.ApprovalRequest.metadata,
      workflow: schema.Workflow,
      workflowRun: {
        id: schema.WorkflowRun.id,
        status: schema.WorkflowRun.status,
        createdAt: schema.WorkflowRun.createdAt,
        userId: schema.WorkflowRun.createdBy,
      },
      user: {
        id: schema.User.id,
        name: schema.User.name,
        email: schema.User.email,
        image: schema.User.image,
      },
    })
    .from(schema.ApprovalRequest)
    .leftJoin(schema.Workflow, eq(schema.ApprovalRequest.workflowId, schema.Workflow.id))
    .leftJoin(schema.WorkflowRun, eq(schema.ApprovalRequest.workflowRunId, schema.WorkflowRun.id))
    .leftJoin(schema.User, eq(schema.WorkflowRun.createdBy, schema.User.id))
    .where(eq(schema.ApprovalRequest.id, approvalRequestId))
    .limit(1)
  if (!approvalRequest) return null

  // `workflowRunId` is nullable now (an `access` row has none), so skip the query
  // rather than matching on NULL.
  const nodeExecutions = approvalRequest.workflowRunId
    ? await db
        .select()
        .from(schema.WorkflowNodeExecution)
        .where(
          and(
            eq(schema.WorkflowNodeExecution.workflowRunId, approvalRequest.workflowRunId),
            eq(schema.WorkflowNodeExecution.status, 'succeeded')
          )
        )
        .orderBy(desc(schema.WorkflowNodeExecution.createdAt))
        .limit(10)
    : []

  const responses = await db
    .select({
      id: schema.ApprovalResponse.id,
      action: schema.ApprovalResponse.action,
      respondedAt: schema.ApprovalResponse.respondedAt,
      user: {
        id: schema.User.id,
        name: schema.User.name,
        email: schema.User.email,
        image: schema.User.image,
      },
    })
    .from(schema.ApprovalResponse)
    .leftJoin(schema.User, eq(schema.ApprovalResponse.userId, schema.User.id))
    .where(eq(schema.ApprovalResponse.approvalRequestId, approvalRequestId))

  return {
    ...approvalRequest,
    workflowRun: {
      ...approvalRequest.workflowRun,
      user: approvalRequest.user,
      nodeExecutions,
    },
    responses,
  }
}

/** One request row by id, unshaped. Used by the resolve path and the jobs. */
export async function getApprovalRequestById(
  db: Database,
  approvalRequestId: string
): Promise<Result<ApprovalRequestEntity, Error>> {
  return guard(
    async () => {
      const request = await db.query.ApprovalRequest.findFirst({
        where: eq(schema.ApprovalRequest.id, approvalRequestId),
      })
      if (!request) {
        const { NotFoundError } = await import('../errors')
        throw new NotFoundError('Approval request not found')
      }
      return request as ApprovalRequestEntity
    },
    'Failed to load approval request',
    { approvalRequestId }
  )
}

/** Approval history for one workflow. Workflow-only by construction (`workflowId`). */
export async function getWorkflowApprovalHistory(db: Database, workflowId: string, limit = 50) {
  return db.query.ApprovalRequest.findMany({
    where: eq(schema.ApprovalRequest.workflowId, workflowId),
    with: {
      responses: {
        with: {
          user: { columns: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: [desc(schema.ApprovalRequest.createdAt)],
    limit,
  })
}

/** Every request in one org at one status. */
export async function getApprovalsByStatus(
  db: Database,
  organizationId: string,
  status: ApprovalStatusType,
  limit = 100
) {
  return db.query.ApprovalRequest.findMany({
    where: and(
      eq(schema.ApprovalRequest.organizationId, organizationId),
      eq(schema.ApprovalRequest.status, status)
    ),
    columns: {
      id: true,
      organizationId: true,
      kind: true,
      workflowId: true,
      workflowRunId: true,
      nodeId: true,
      nodeName: true,
      status: true,
      message: true,
      assigneeUsers: true,
      assigneeGroups: true,
      subjectLabel: true,
      createdById: true,
      createdAt: true,
      expiresAt: true,
      metadata: true,
    },
    with: {
      workflow: { columns: { id: true, name: true } },
      responses: {
        with: {
          user: { columns: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: [desc(schema.ApprovalRequest.createdAt)],
    limit,
  })
}

/** Aggregate approval throughput for one org, optionally windowed. */
export async function getApprovalMetrics(
  db: Database,
  organizationId: string,
  range?: { startDate?: Date; endDate?: Date }
) {
  const rangeConds: Array<SQL | undefined> = []
  if (range?.startDate) rangeConds.push(gte(schema.ApprovalRequest.createdAt, range.startDate))
  if (range?.endDate) rangeConds.push(lte(schema.ApprovalRequest.createdAt, range.endDate))

  const baseWhere = and(eq(schema.ApprovalRequest.organizationId, organizationId), ...rangeConds)

  // ONE conditional aggregation, not one query per status. This was seven
  // identical scans of the same rows differing only in a `status` equality —
  // `FILTER (WHERE …)` gets every bucket out of a single pass. Plan 42 widened the
  // set from five statuses to seven (the access lane's `withdrawn`/`superseded`,
  // H9), which is what made the shape worth changing rather than just wider.
  const statusCount = (status: string) =>
    sql<number>`count(*) FILTER (WHERE ${schema.ApprovalRequest.status} = ${status})`

  const [counts] = await db
    .select({
      total: count(),
      pending: statusCount(ApprovalStatus.pending),
      approved: statusCount(ApprovalStatus.approved),
      denied: statusCount(ApprovalStatus.denied),
      timeout: statusCount(ApprovalStatus.timeout),
      withdrawn: statusCount('withdrawn'),
      superseded: statusCount('superseded'),
    })
    .from(schema.ApprovalRequest)
    .where(baseWhere)

  // `count(*)` is int8, which pg hands back as a string — every one of these needs
  // the cast or the rate arithmetic below concatenates.
  const total = Number(counts?.total ?? 0)
  const pending = Number(counts?.pending ?? 0)
  const approved = Number(counts?.approved ?? 0)
  const denied = Number(counts?.denied ?? 0)
  const timeout = Number(counts?.timeout ?? 0)
  const withdrawn = Number(counts?.withdrawn ?? 0)
  const superseded = Number(counts?.superseded ?? 0)

  const [avgRow] = await db
    .select({
      avg: sql<number>`AVG(EXTRACT(EPOCH FROM (${schema.ApprovalResponse.respondedAt}::timestamptz - ${schema.ApprovalRequest.createdAt}::timestamptz)))`,
    })
    .from(schema.ApprovalRequest)
    .innerJoin(
      schema.ApprovalResponse,
      eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
    )
    .where(
      and(
        eq(schema.ApprovalRequest.organizationId, organizationId),
        inArray(schema.ApprovalRequest.status, [
          ApprovalStatus.approved,
          ApprovalStatus.denied,
        ] as ApprovalStatusType[]),
        ...rangeConds
      )
    )
  const avgResponseTimeSeconds = Number(avgRow?.avg ?? 0)

  return {
    total,
    pending,
    approved,
    denied,
    timeout,
    withdrawn,
    superseded,
    approvalRate: total > 0 ? (approved / total) * 100 : 0,
    denialRate: total > 0 ? (denied / total) * 100 : 0,
    timeoutRate: total > 0 ? (timeout / total) * 100 : 0,
    avgResponseTimeHours: avgResponseTimeSeconds / 3600,
  }
}

/** Approvers who have not yet responded to one request. */
export async function getPendingApprovers(
  db: Database,
  approvalRequestId: string
): Promise<string[]> {
  const request = await db.query.ApprovalRequest.findFirst({
    where: eq(schema.ApprovalRequest.id, approvalRequestId),
    columns: {
      id: true,
      organizationId: true,
      assigneeUsers: true,
      assigneeGroups: true,
    },
    with: { responses: { columns: { userId: true } } },
  })
  if (!request) return []

  const respondedUserIds = new Set((request.responses ?? []).map((r) => r.userId))
  const allApprovers = new Set<string>(request.assigneeUsers ?? [])

  if ((request.assigneeGroups?.length ?? 0) > 0) {
    const groupMembers = await db.query.EntityGroupMember.findMany({
      where: and(
        inArray(schema.EntityGroupMember.groupInstanceId, request.assigneeGroups as string[]),
        eq(schema.EntityGroupMember.memberType, MemberType.user)
      ),
      columns: { memberRefId: true },
    })
    for (const member of groupMembers) allApprovers.add(member.memberRefId)
  }

  return Array.from(allApprovers).filter((userId) => !respondedUserIds.has(userId))
}

/** One user's decision throughput in one org. */
export async function getUserApprovalStats(
  db: Database,
  organizationId: string,
  userId: string
): Promise<{
  totalResponded: number
  approvedCount: number
  deniedCount: number
  approvalRate: number
  avgResponseTimeHours: number
}> {
  const countResponses = async (action?: 'approve' | 'deny') => {
    const [row] = await db
      .select({ cnt: count() })
      .from(schema.ApprovalResponse)
      .leftJoin(
        schema.ApprovalRequest,
        eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
      )
      .where(
        and(
          eq(schema.ApprovalResponse.userId, userId),
          eq(schema.ApprovalRequest.organizationId, organizationId),
          ...(action ? [eq(schema.ApprovalResponse.action, action)] : [])
        )
      )
    return Number(row?.cnt ?? 0)
  }

  const [totalResponded, approvedCount, deniedCount, avgRows] = await Promise.all([
    countResponses(),
    countResponses('approve'),
    countResponses('deny'),
    db
      .select({
        avgResponseTime: sql<number>`AVG(EXTRACT(EPOCH FROM (${schema.ApprovalResponse.respondedAt}::timestamptz - ${schema.ApprovalRequest.createdAt}::timestamptz)))`,
      })
      .from(schema.ApprovalRequest)
      .innerJoin(
        schema.ApprovalResponse,
        eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
      )
      .where(
        and(
          eq(schema.ApprovalResponse.userId, userId),
          eq(schema.ApprovalRequest.organizationId, organizationId)
        )
      ),
  ])

  const avgResponseTime = Number(avgRows[0]?.avgResponseTime ?? 0)
  return {
    totalResponded,
    approvedCount,
    deniedCount,
    approvalRate: totalResponded > 0 ? (approvedCount / totalResponded) * 100 : 0,
    avgResponseTimeHours: avgResponseTime / 3600,
  }
}
