// packages/lib/src/cache/providers/mail-grant-index-provider.ts

import { schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { maxRung, satisfiesRung } from '../../permissions/capabilities/rung'
import type { Lens } from '../../permissions/visibility/lens'
import { resolveProfileIdByUser } from '../../resource-access/grantee-resolution'
import { isInboxDef } from '../../resource-access/mail-sharing-defs'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('mail-grant-index')

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
  rung: Rung
}

/**
 * Expand ONE grant row's grantee to the user ids it reaches. Exhaustive over the
 * `ResourceGranteeType` vocabulary — an unknown kind resolves to nobody and says
 * so, instead of being silently reinterpreted as a group id.
 */
function expandGrantee(
  row: IndexGrantRow,
  ctx: {
    memberUserIds: string[]
    usersByGroup: Map<string, string[]>
    usersByProfile: Map<string, string[]>
  }
): string[] {
  switch (row.granteeType) {
    case 'user':
      return [row.granteeId]
    case 'role':
      // `org_member` is the only role grantee on ResourceAccess — the
      // def/workspace baseline marker (doc 19 §11a deviation 2).
      return row.granteeId === 'org_member' ? ctx.memberUserIds : []
    case 'group':
    case 'team':
      return ctx.usersByGroup.get(row.granteeId) ?? []
    case 'profile':
      return ctx.usersByProfile.get(row.granteeId) ?? []
    default:
      logger.warn('Unhandled ResourceAccess granteeType in mail grant index — row ignored', {
        granteeType: row.granteeType,
        granteeId: row.granteeId,
        entityDefinitionId: row.entityDefinitionId,
        entityInstanceId: row.entityInstanceId,
      })
      return []
  }
}

/**
 * The bucket one grant row belongs in — EXPLICIT over every def the provider
 * query admits, returning `undefined` (and saying so) for anything else.
 *
 * Until plan 40 this was a nested ternary whose else-branch was `index.contacts`,
 * so ANY def that was not `thread`/`inbox` silently became a contact grant. That
 * is the shape of a fail-OPEN bug: data migration 060 re-keys personal mailbox
 * grants from `'inbox'` to `'personal_inbox'`, and the old router would have
 * quietly published those inbox audiences as contact audiences — no throw, no
 * log, wrong fanout. A default branch that guesses is exactly what a def split
 * must not have, so this one refuses instead.
 *
 * Loud-but-not-fatal by design, matching {@link expandGrantee}'s precedent in
 * this file: this runs inside a cache provider, so throwing would take the whole
 * org's realtime fanout and count-delta audiences down over one bad row. Skipping
 * is the fail-CLOSED direction (the row reaches nobody rather than the wrong
 * body), and the log names the def so the next def split is a one-line fix.
 */
function bucketFor(
  index: MailGrantIndex,
  entityDefinitionId: string
): Record<string, MailGrantEntry[]> | undefined {
  if (entityDefinitionId === 'thread') return index.threads
  if (entityDefinitionId === 'contact') return index.contacts
  if (isInboxDef(entityDefinitionId)) return index.inboxes
  logger.error('Unrecognised mail definition in grant index — row ignored', {
    entityDefinitionId,
  })
  return undefined
}

/**
 * Pure composition — grant rows + cached membership shapes in, inverted
 * per-user audience maps out. IO lives in the provider below.
 *
 * This is the REVERSE of `computeUserInstanceGrants`; the two must expand the
 * same grantee kinds or a share is visible in one direction only (19a finding
 * 4). Until doc 19 step 9 the expansion was a ternary whose final branch treated
 * ANY unrecognised `granteeId` as a group instance id — a `profile` grantee
 * resolved to `[]` and was dropped by the `length === 0` guard with no error and
 * no log. The switch below is exhaustive and warns on the default.
 */
export function composeMailGrantIndex(input: {
  rows: IndexGrantRow[]
  /** All org member user ids (for `role/org_member` expansion). */
  memberUserIds: string[]
  /** Cached `groupMembers` shape: userId → groupInstanceIds. */
  groupIdsByUser: Record<string, string[]>
  /**
   * `userId → resolved base permission profile id` (`resolveProfileIdByUser`).
   * Includes the null-bound majority, whose profile resolves in code from
   * `(role, seatType)` — so a grant on a system profile reaches them too.
   */
  profileIdByUser?: Record<string, string>
}): MailGrantIndex {
  const { rows, memberUserIds, groupIdsByUser, profileIdByUser = {} } = input

  // Invert userId → groupIds into groupId → userIds once.
  const usersByGroup = new Map<string, string[]>()
  for (const [userId, groupIds] of Object.entries(groupIdsByUser)) {
    for (const groupId of groupIds) {
      const arr = usersByGroup.get(groupId) ?? []
      arr.push(userId)
      usersByGroup.set(groupId, arr)
    }
  }

  // Invert userId → profileId into profileId → userIds once.
  const usersByProfile = new Map<string, string[]>()
  for (const [userId, profileId] of Object.entries(profileIdByUser)) {
    const arr = usersByProfile.get(profileId) ?? []
    arr.push(userId)
    usersByProfile.set(profileId, arr)
  }

  const index: MailGrantIndex = { threads: {}, contacts: {}, inboxes: {} }

  for (const row of rows) {
    // `none` is the RESTRICTION marker, not a grant — and it is exactly what
    // data migration 060 writes as `role:org_member @ none` on a restricted shared
    // inbox (plan 40 §4.1). The pre-P3b `!== 'view' ⇒ full` shorthand inverted that
    // row into a FULL-lens entry for every org member, which is the widest possible
    // reading of a row whose entire purpose is to close the inbox. One column makes
    // the marker unmissable: it is a value on the ladder, not an absence to infer.
    if (row.rung === 'none') continue
    // `edit`/`admin` on an INBOX mean "manages the mailbox"; the widest a thread
    // can be published at is `read`. Same clamp as `inboxRungAsLens` in
    // `compute-user-instance-grants.ts` — the forward reader of these same rows.
    const lens: Lens = satisfiesRung(row.rung, 'read') ? 'read' : (row.rung as Lens)
    const userIds = expandGrantee(row, { memberUserIds, usersByGroup, usersByProfile })

    if (userIds.length === 0) continue

    const bucket = bucketFor(index, row.entityDefinitionId)
    if (!bucket) continue
    const existing = bucket[row.entityInstanceId] ?? []
    for (const userId of userIds) {
      const entry = existing.find((e) => e.userId === userId)
      if (entry) entry.lens = maxRung(entry.lens, lens)
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
        rung: schema.ResourceAccess.rung,
      })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, orgId),
          isNotNull(schema.ResourceAccess.entityInstanceId),
          // `personal_inbox` rides along from day one (plan 40 §3 / 40a §4): the
          // rows migration 060 re-keys are never even FETCHED without it, so the
          // bucket fix above would have nothing to route. Both halves ship in
          // the same deploy as the re-key or personal grants evaporate.
          inArray(schema.ResourceAccess.entityDefinitionId, [
            'thread',
            'contact',
            'inbox',
            'personal_inbox',
          ])
        )
      )

    if (rows.length === 0) return { threads: {}, contacts: {}, inboxes: {} }

    // Lazy import to avoid a hard module cycle with the cache barrel.
    const { getOrgCache } = await import('../singletons')
    const [members, groupIdsByUser] = await Promise.all([
      getOrgCache().get(orgId, 'members'),
      getOrgCache().get(orgId, 'groupMembers'),
    ])

    // Only resolve the profile map when a profile-grantee row actually exists —
    // it walks every member of the org, and profile-scoped mail shares are rare.
    let profileIdByUser: Record<string, string> = {}
    if (rows.some((r: { granteeType: string }) => r.granteeType === 'profile')) {
      const [roleMap, profiles] = await Promise.all([
        getOrgCache().get(orgId, 'memberRoleMap'),
        getOrgCache().get(orgId, 'profiles'),
      ])
      profileIdByUser = resolveProfileIdByUser({ organizationId: orgId, roleMap, profiles })
    }

    return composeMailGrantIndex({
      rows: rows as IndexGrantRow[],
      memberUserIds: members.map((m) => m.userId),
      groupIdsByUser,
      profileIdByUser,
    })
  },
}
