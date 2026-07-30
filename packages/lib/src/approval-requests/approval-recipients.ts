// packages/lib/src/approval-requests/approval-recipients.ts

import { type Database, database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { resolveGroupHolders } from '../resource-access/grantee-resolution'
import { getUserSetting } from '../settings'

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
 *
 * **Cache-only — zero queries.** Both halves were SQL: an `EntityGroupMember`
 * query for the group expansion and a `User ⋈ OrganizationMember` join to keep
 * only humans who are still members. Both facts are already org-cache keys
 * (`groupMembers`, `memberRoleMap`), and this runs on FIVE paths — creation,
 * reminders, timeouts, resolution and run cleanup — so it was the most-repeated
 * avoidable pair of queries in the approval spine.
 *
 * `memberRoleMap` is exactly equivalent to the join it replaces: it is keyed by
 * the org's `OrganizationMember` rows (so a non-member is absent, as the inner
 * join required) and carries `userType` per member (so the `'USER'` filter is the
 * same predicate). An assignee who has since left the org is dropped either way.
 */
export async function getApprovalAssigneeUserIds(audience: ApprovalAudience): Promise<string[]> {
  const userIds = new Set(audience.assigneeUsers ?? [])

  for (const userId of await resolveGroupHolders(
    audience.organizationId,
    audience.assigneeGroups ?? []
  )) {
    userIds.add(userId)
  }

  if (userIds.size === 0) return []

  const roleMap = await getOrgCache().get(audience.organizationId, 'memberRoleMap')
  return Array.from(userIds).filter((userId) => roleMap[userId]?.userType === 'USER')
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

/**
 * {@link approvalEmailEnabled} for a whole recipient list, in ONE query.
 *
 * The email fan-out is a loop over recipients, and calling the single-user form
 * inside it cost up to two queries EACH (`UserSetting`, then
 * `OrganizationSetting` when the user has no override). This reads every
 * recipient's override in one pass and applies the same "only an explicit `false`
 * skips" rule, so an untouched preference still sends.
 *
 * `notification.approval.email` is a `user`-access setting whose catalog default
 * is `true`, so there is no org-level row to consult for it — the default IS the
 * unset answer, which is why this needs no second query.
 */
export async function approvalEmailEnabledFor(
  db: Database,
  organizationId: string,
  userIds: string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await db
    .select({ userId: schema.UserSetting.userId, value: schema.UserSetting.value })
    .from(schema.UserSetting)
    .where(
      and(
        eq(schema.UserSetting.organizationId, organizationId),
        eq(schema.UserSetting.key, 'notification.approval.email'),
        inArray(schema.UserSetting.userId, userIds)
      )
    )
  const optedOut = new Set(rows.filter((r) => r.value === false).map((r) => r.userId))
  return new Set(userIds.filter((userId) => !optedOut.has(userId)))
}
