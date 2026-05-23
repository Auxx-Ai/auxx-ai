// packages/lib/src/chat-duty/chat-duty-service.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getCachedMembers, onCacheEvent } from '../cache'
import { NotFoundError } from '../errors'

export interface SetChatDutyResult {
  userId: string
  onChatDuty: boolean
  chatDutyUpdatedAt: Date
  chatDutyUpdatedById: string
}

/**
 * Flip a member's `onChatDuty` flag. Records the actor in
 * `chatDutyUpdatedById` so we can distinguish self-toggle vs. admin override.
 * Invalidates the `members` org cache.
 */
export async function setMemberChatDuty(params: {
  organizationId: string
  /** User whose duty flag is being set. */
  userId: string
  /** User performing the action. */
  actorUserId: string
  onDuty: boolean
  db?: Database
}): Promise<SetChatDutyResult> {
  const { organizationId, userId, actorUserId, onDuty, db = defaultDb } = params

  const now = new Date()
  const [row] = await db
    .update(schema.OrganizationMember)
    .set({
      onChatDuty: onDuty,
      chatDutyUpdatedAt: now,
      chatDutyUpdatedById: actorUserId,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.userId, userId)
      )
    )
    .returning({
      userId: schema.OrganizationMember.userId,
      onChatDuty: schema.OrganizationMember.onChatDuty,
      chatDutyUpdatedAt: schema.OrganizationMember.chatDutyUpdatedAt,
      chatDutyUpdatedById: schema.OrganizationMember.chatDutyUpdatedById,
    })

  if (!row) {
    throw new NotFoundError('Membership not found for this organization')
  }

  await onCacheEvent('member.chat-duty.changed', { orgId: organizationId })

  return {
    userId: row.userId,
    onChatDuty: row.onChatDuty,
    // `returning` always echoes the value we just wrote.
    chatDutyUpdatedAt: row.chatDutyUpdatedAt ?? now,
    chatDutyUpdatedById: row.chatDutyUpdatedById ?? actorUserId,
  }
}

/**
 * Returns the userIds of org members currently on chat duty. Cached via the
 * `members` org cache — invalidated on every `member.chat-duty.changed`.
 */
export async function listOnDutyUserIds(organizationId: string): Promise<string[]> {
  const members = await getCachedMembers(organizationId, { status: 'ACTIVE' })
  return members.filter((m) => m.onChatDuty).map((m) => m.userId)
}
