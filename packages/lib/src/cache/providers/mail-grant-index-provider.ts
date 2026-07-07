// packages/lib/src/cache/providers/mail-grant-index-provider.ts

import { schema } from '@auxx/database'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { type Lens, maxLens } from '../../permissions/visibility/lens'
import type { CacheProvider } from '../org-cache-provider'

/** One resolved grantee of a thread/contact grant. */
export interface MailGrantEntry {
  userId: string
  lens: Lens
}

/**
 * Reverse grant index for the realtime publish fanout (mail-permissions §3.1)
 * and the ingest count-delta audience (§10.1): thread/contact/inbox instance
 * grants inverted to per-user audiences, group and role grantees expanded to
 * member user ids. Ad-hoc-share-sized by design.
 */
export interface MailGrantIndex {
  threads: Record<string, MailGrantEntry[]>
  contacts: Record<string, MailGrantEntry[]>
  inboxes: Record<string, MailGrantEntry[]>
}

interface IndexGrantRow {
  entityDefinitionId: string
  entityInstanceId: string
  granteeType: string
  granteeId: string
  permission: string
  lens: Lens | null
}

/**
 * Pure composition — grant rows + cached membership shapes in, inverted
 * per-user audience maps out. IO lives in the provider below.
 */
export function composeMailGrantIndex(input: {
  rows: IndexGrantRow[]
  /** All org member user ids (for `role/org_member` expansion). */
  memberUserIds: string[]
  /** Cached `groupMembers` shape: userId → groupInstanceIds. */
  groupIdsByUser: Record<string, string[]>
}): MailGrantIndex {
  const { rows, memberUserIds, groupIdsByUser } = input

  // Invert userId → groupIds into groupId → userIds once.
  const usersByGroup = new Map<string, string[]>()
  for (const [userId, groupIds] of Object.entries(groupIdsByUser)) {
    for (const groupId of groupIds) {
      const arr = usersByGroup.get(groupId) ?? []
      arr.push(userId)
      usersByGroup.set(groupId, arr)
    }
  }

  const index: MailGrantIndex = { threads: {}, contacts: {}, inboxes: {} }

  for (const row of rows) {
    const lens: Lens = row.permission === 'view' ? (row.lens ?? 'full') : 'full'
    const userIds =
      row.granteeType === 'user'
        ? [row.granteeId]
        : row.granteeType === 'role' && row.granteeId === 'org_member'
          ? memberUserIds
          : (usersByGroup.get(row.granteeId) ?? [])

    if (userIds.length === 0) continue

    const bucket =
      row.entityDefinitionId === 'thread'
        ? index.threads
        : row.entityDefinitionId === 'inbox'
          ? index.inboxes
          : index.contacts
    const existing = bucket[row.entityInstanceId] ?? []
    for (const userId of userIds) {
      const entry = existing.find((e) => e.userId === userId)
      if (entry) entry.lens = maxLens(entry.lens, lens)
      else existing.push({ userId, lens })
    }
    bucket[row.entityInstanceId] = existing
  }

  return index
}

/** Computes the reverse thread/contact grant index for an organization. */
export const mailGrantIndexProvider: CacheProvider<MailGrantIndex> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
        entityInstanceId: schema.ResourceAccess.entityInstanceId,
        granteeType: schema.ResourceAccess.granteeType,
        granteeId: schema.ResourceAccess.granteeId,
        permission: schema.ResourceAccess.permission,
        lens: schema.ResourceAccess.lens,
      })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, orgId),
          isNotNull(schema.ResourceAccess.entityInstanceId),
          inArray(schema.ResourceAccess.entityDefinitionId, ['thread', 'contact', 'inbox'])
        )
      )

    if (rows.length === 0) return { threads: {}, contacts: {}, inboxes: {} }

    // Lazy import to avoid a hard module cycle with the cache barrel.
    const { getOrgCache } = await import('../singletons')
    const [members, groupIdsByUser] = await Promise.all([
      getOrgCache().get(orgId, 'members'),
      getOrgCache().get(orgId, 'groupMembers'),
    ])

    return composeMailGrantIndex({
      rows: rows as IndexGrantRow[],
      memberUserIds: members.map((m) => m.userId),
      groupIdsByUser,
    })
  },
}
