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
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedUserGroupIds } from '../cache'
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
 * Every pending approval waiting on one member — both kinds, in one list.
 *
 * The access-lane columns are projected alongside the workflow ones because the
 * rows H1 stopped excluding are useless to the Approvals tab without them.
 */
export async function getPendingApprovalsForUser(
  db: Database,
  organizationId: string,
  userId: string
) {
  const userGroups = await getCachedUserGroupIds(organizationId, userId)
  return await db
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
        eq(schema.ApprovalRequest.status, ApprovalStatus.pending),
        notExpired(),
        assignedTo(userId, userGroups),
        runStillActiveOrNotWorkflow()
      )
    )
    .orderBy(schema.ApprovalRequest.createdAt)
}

/**
 * Badge count for the Approvals tab. The predicate is DELIBERATELY identical to
 * {@link getPendingApprovalsForUser}'s — they are duplicated in SQL, so both H1
 * and the null-expiry reading have to be applied twice or the badge disagrees
 * with the list.
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
        eq(schema.ApprovalRequest.status, ApprovalStatus.pending),
        notExpired(),
        assignedTo(userId, userGroups),
        runStillActiveOrNotWorkflow()
      )
    )
  // `count(*)` is int8, which pg hands back as a string. The caller adds this to
  // the suggestion count for the tab badge, so leaving it would concatenate.
  return Number(row?.count ?? 0)
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
  const request = await db.query.ApprovalRequest.findFirst({
    where: eq(schema.ApprovalRequest.id, approvalRequestId),
    columns: { organizationId: true, assigneeUsers: true, assigneeGroups: true },
  })
  if (!request) return false

  const membership = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, userId),
      eq(schema.OrganizationMember.organizationId, request.organizationId)
    ),
    columns: { id: true },
  })
  if (!membership) return false

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
  const request = await db.query.ApprovalRequest.findFirst({
    where: eq(schema.ApprovalRequest.id, approvalRequestId),
    columns: { status: true, expiresAt: true },
  })
  if (!request || request.status !== ApprovalStatus.pending) return false
  // Nullable in the schema — a request with no expiry never expires. The explicit
  // truthiness guard is load-bearing (plan 28 H2): `null < new Date()` coerces
  // null→0 in JS and evaluates TRUE, so a bare comparison makes a null-expiry
  // request permanently UN-approvable. {@link notExpired} is the SQL side of the
  // same reading — the two agree now; at HEAD they did not.
  if (request.expiresAt && request.expiresAt < new Date()) return false
  return await canUserViewApproval(db, userId, approvalRequestId)
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

  const countFor = async (extra?: SQL | undefined) => {
    const [row] = await db
      .select({ cnt: count() })
      .from(schema.ApprovalRequest)
      .where(extra ? and(baseWhere, extra) : baseWhere)
    return Number(row?.cnt ?? 0)
  }

  const [total, pending, approved, denied, timeout, withdrawn, superseded] = await Promise.all([
    countFor(),
    countFor(eq(schema.ApprovalRequest.status, ApprovalStatus.pending)),
    countFor(eq(schema.ApprovalRequest.status, ApprovalStatus.approved)),
    countFor(eq(schema.ApprovalRequest.status, ApprovalStatus.denied)),
    countFor(eq(schema.ApprovalRequest.status, ApprovalStatus.timeout)),
    // The two access-only terminal states (H9). Counted so the metrics do not
    // silently under-report the access lane's volume once it ships.
    countFor(eq(schema.ApprovalRequest.status, 'withdrawn')),
    countFor(eq(schema.ApprovalRequest.status, 'superseded')),
  ])

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
