// packages/lib/src/permissions/visibility/compute-user-mail-visibility.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { OrganizationRole } from '@auxx/database/types'
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import type { UserMailVisibility } from './context'
import { type Lens, maxLens } from './lens'

/** The ResourceAccess columns the visibility composition needs. */
export interface VisibilityGrantRow {
  entityDefinitionId: string
  entityInstanceId: string
  permission: string
  lens: Lens | null
}

/**
 * Built-in ResourceAccess resource types that can never be a thread's primary
 * entity — excluded from the `entityGrants` bucket so snippet/folder shares
 * don't bloat the cached context.
 */
const NON_MAIL_BUILTIN_TYPES = new Set(['snippet', 'folder', 'workflow', 'document'])

/** Lens conferred by a single grant row: `edit`/`admin` imply `full` (§2.1). */
function grantLens(row: Pick<VisibilityGrantRow, 'permission' | 'lens'>): Lens {
  return row.permission === 'view' ? (row.lens ?? 'full') : 'full'
}

/**
 * Pure composition of a user's mail-visibility context (§3) from cached
 * inputs + the user's grantee-expanded instance-level ResourceAccess rows.
 * IO lives in {@link computeUserMailVisibility}; this is the tested core.
 */
export function composeUserMailVisibility(input: {
  userId: string
  /** From the cached memberRoleMap; undefined when not a member (→ no access). */
  role: OrganizationRole | undefined
  /** Cached inboxes shape — id + defaultLens floor. */
  inboxes: Array<{ id: string; defaultLens: Lens }>
  grants: VisibilityGrantRow[]
}): UserMailVisibility {
  const { userId, role, inboxes, grants } = input
  const isAdmin = role === 'OWNER' || role === 'ADMIN'

  // Bucket the grant rows: inbox grants raise that inbox's floor; thread/
  // contact grants derive to threads; everything else that looks like an
  // entity definition becomes a primary-entity grant.
  const inboxGrants: Record<string, Lens> = {}
  const threadGrants: Record<string, Lens> = {}
  const contactGrants: Record<string, Lens> = {}
  const entityGrants: Record<string, Lens> = {}

  const raise = (map: Record<string, Lens>, key: string, lens: Lens) => {
    map[key] = maxLens(map[key] ?? 'none', lens)
  }

  for (const row of grants) {
    const lens = grantLens(row)
    if (row.entityDefinitionId === 'inbox') raise(inboxGrants, row.entityInstanceId, lens)
    else if (row.entityDefinitionId === 'thread') raise(threadGrants, row.entityInstanceId, lens)
    else if (row.entityDefinitionId === 'contact') raise(contactGrants, row.entityInstanceId, lens)
    else if (!NON_MAIL_BUILTIN_TYPES.has(row.entityDefinitionId))
      raise(entityGrants, row.entityInstanceId, lens)
  }

  // Per-inbox effective floor: max(defaultLens, grants). Only entries > none.
  // Non-members get no floor at all — grants alone would be a data bug, but
  // the empty maps fail closed regardless.
  const inboxLens: Record<string, Lens> = {}
  if (role) {
    for (const inbox of inboxes) {
      const lens = maxLens(inbox.defaultLens, inboxGrants[inbox.id] ?? 'none')
      if (lens !== 'none') inboxLens[inbox.id] = lens
    }
  }

  return {
    userId,
    role: role ?? 'USER',
    isAdmin: role ? isAdmin : false,
    inboxLens,
    // Personal inboxes arrive in Phase 8 — until then the set is empty and the
    // admin short-circuit is unconditional.
    personalInboxIds: {},
    threadGrants,
    contactGrants,
    entityGrants,
  }
}

/**
 * Compute a user's mail-visibility context for one org: cached memberRoleMap
 * + cached inboxes (with defaultLens) + cached group memberships + ONE
 * grantee-expanded, instance-level ResourceAccess query.
 *
 * Called by the `userMailVisibility` user-cache provider — read it via
 * `getUserCache().get(userId, 'userMailVisibility', orgId)`, not directly.
 */
export async function computeUserMailVisibility(
  userId: string,
  organizationId: string,
  db: Database
): Promise<UserMailVisibility> {
  // Lazy import to avoid a hard module cycle (cache providers import this file).
  const { getOrgCache, getCachedUserGroupIds } = await import('../../cache')

  const [roleMap, inboxes, groupIds] = await Promise.all([
    getOrgCache().get(organizationId, 'memberRoleMap'),
    getOrgCache().get(organizationId, 'inboxes'),
    getCachedUserGroupIds(organizationId, userId),
  ])

  const granteeConditions = [
    and(eq(schema.ResourceAccess.granteeType, 'user'), eq(schema.ResourceAccess.granteeId, userId)),
    and(
      eq(schema.ResourceAccess.granteeType, 'role'),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]
  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        inArray(schema.ResourceAccess.granteeType, ['group', 'team']),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  const rows = await db
    .select({
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      entityInstanceId: schema.ResourceAccess.entityInstanceId,
      permission: schema.ResourceAccess.permission,
      lens: schema.ResourceAccess.lens,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        // Instance-level only: type-level grants must NOT derive to threads
        // (April decision — "view all contacts" doesn't expose every thread).
        isNotNull(schema.ResourceAccess.entityInstanceId),
        or(...granteeConditions)
      )
    )

  return composeUserMailVisibility({
    userId,
    role: roleMap[userId],
    inboxes: inboxes.map((i) => ({ id: i.id, defaultLens: i.defaultLens })),
    grants: rows as VisibilityGrantRow[],
  })
}
