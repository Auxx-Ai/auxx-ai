// packages/lib/src/workflow-engine/services/approval-recipients.ts

import { type Database, database, schema } from '@auxx/database'
import { MemberType } from '@auxx/database/enums'
import { and, eq, inArray } from 'drizzle-orm'
import { getUserSetting } from '../../settings'

/** The assignee columns of an `ApprovalRequest`, plus the org they live in. */
export interface ApprovalAudience {
  assigneeUsers: string[]
  assigneeGroups: string[]
  organizationId: string
}

/**
 * Resolve an approval's assignees to the human users who should be told about
 * it — the directly named users plus the members of every assigned group.
 *
 * This is the single implementation. It previously existed three times over
 * (the confirmation node, the reminder job, and inline in the timeout job), and
 * all three resolved groups by selecting **every** `OrganizationMember` in the
 * org — so one group-assigned approval notified the entire workspace. Groups
 * resolve through `EntityGroupMember` here, the same table the approvals list
 * already trusts.
 *
 * Agent (synthetic) users are dropped: an approval must never fan out to an
 * agent's sentinel email or user room.
 */
export async function getApprovalAssigneeUserIds(
  db: Database,
  audience: ApprovalAudience
): Promise<string[]> {
  const userIds = new Set(audience.assigneeUsers ?? [])

  if (audience.assigneeGroups?.length) {
    const groupMembers = await db
      .select({ memberRefId: schema.EntityGroupMember.memberRefId })
      .from(schema.EntityGroupMember)
      .where(
        and(
          inArray(schema.EntityGroupMember.groupInstanceId, audience.assigneeGroups),
          eq(schema.EntityGroupMember.memberType, MemberType.user)
        )
      )
    for (const member of groupMembers) userIds.add(member.memberRefId)
  }

  if (userIds.size === 0) return []

  const humans = await db
    .select({ id: schema.User.id })
    .from(schema.User)
    .innerJoin(schema.OrganizationMember, eq(schema.OrganizationMember.userId, schema.User.id))
    .where(
      and(
        inArray(schema.User.id, Array.from(userIds)),
        eq(schema.User.userType, 'USER'),
        eq(schema.OrganizationMember.organizationId, audience.organizationId)
      )
    )
  return humans.map((user) => user.id)
}

/**
 * `notification.approval.email` gate — the recipient's own say over approval
 * request and reminder emails. Default true, so only an explicit `false` skips;
 * an untouched preference still sends.
 *
 * ANDs with the node's `notification_methods.email`: the node switch is the
 * workflow author saying "this is worth emailing about", this is the recipient
 * saying "I want email". Both must be on.
 */
export async function approvalEmailEnabled(
  organizationId: string,
  userId: string,
  db?: Database
): Promise<boolean> {
  const value = await getUserSetting({
    organizationId,
    userId,
    key: 'notification.approval.email',
    db: db ?? database,
  })
  return value !== false
}
