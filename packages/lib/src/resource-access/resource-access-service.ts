// packages/lib/src/resource-access/resource-access-service.ts

import { schema } from '@auxx/database'
import { MemberType, ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { getCachedUserGroupIds, onCacheEvent } from '../cache'
import { NotificationService } from '../notifications'
import { isInstanceAccessKey } from '../permissions/capabilities/instance-access'
import { satisfiesPermission } from './constants'
import type {
  AccessCheckResult,
  CheckAccessInput,
  CheckTypeAccessInput,
  GrantInstanceAccessInput,
  GrantLens,
  GrantTypeAccessInput,
  InstanceAccess,
  ResourceAccessContext,
  ResourceAccessInfo,
  RevokeInstanceAccessInput,
  RevokeTypeAccessInput,
} from './types'

const logger = createScopedLogger('resource-access-service')
const SHARE_NOTIFICATION_RECIPIENT_CAP = 50

async function resolveShareRecipients(
  ctx: ResourceAccessContext,
  input: GrantInstanceAccessInput
): Promise<string[]> {
  if (input.granteeType === ResourceGranteeType.role) return []
  if (input.granteeType === ResourceGranteeType.user) return [input.granteeId]

  const members = await ctx.db.query.EntityGroupMember.findMany({
    where: and(
      eq(schema.EntityGroupMember.groupInstanceId, input.granteeId),
      eq(schema.EntityGroupMember.memberType, MemberType.user)
    ),
    columns: { memberRefId: true },
    limit: SHARE_NOTIFICATION_RECIPIENT_CAP + 1,
  })
  if (members.length > SHARE_NOTIFICATION_RECIPIENT_CAP) {
    logger.warn('Share notification fan-out capped', {
      organizationId: ctx.organizationId,
      granteeType: input.granteeType,
      granteeId: input.granteeId,
      cap: SHARE_NOTIFICATION_RECIPIENT_CAP,
    })
  }
  return members
    .slice(0, SHARE_NOTIFICATION_RECIPIENT_CAP)
    .map((member: { memberRefId: string }) => member.memberRefId)
}

async function notifyNewInstanceShare(
  ctx: ResourceAccessContext,
  input: GrantInstanceAccessInput,
  entityDefinitionId: string,
  entityInstanceId: string
): Promise<void> {
  if (input.permission === ResourcePermission.none) return
  if (entityDefinitionId !== 'thread' && !isInstanceAccessKey(entityDefinitionId)) return

  const recipientIds = (await resolveShareRecipients(ctx, input)).filter(
    (recipientId) => recipientId !== ctx.userId
  )
  if (recipientIds.length === 0) return

  const actor = await ctx.db.query.User.findFirst({
    where: eq(schema.User.id, ctx.userId),
    columns: { name: true },
  })
  const actorName = actor?.name ?? 'A teammate'
  const service = new NotificationService(ctx.db)

  if (entityDefinitionId === 'thread') {
    const thread = await ctx.db.query.Thread.findFirst({
      where: and(
        eq(schema.Thread.id, entityInstanceId),
        eq(schema.Thread.organizationId, ctx.organizationId)
      ),
      columns: { subject: true },
    })
    if (!thread) return
    const lens = input.permission === ResourcePermission.view ? (input.lens ?? 'full') : 'full'
    const visibleSubject = lens === 'metadata' ? null : thread.subject
    await Promise.all(
      recipientIds.map((userId) =>
        service.sendNotification({
          type: 'MESSAGE_SHARED',
          userId,
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          targetType: 'THREAD',
          targetIds: { threadId: entityInstanceId },
          message: `${actorName} shared a conversation with you${
            visibleSubject ? `: ${visibleSubject}` : ''
          }`,
          metadata: { kind: 'MESSAGE_SHARED', subject: visibleSubject, lens },
        })
      )
    )
    return
  }

  const resourceConfig = {
    dataset: { table: schema.Dataset, noun: 'dataset', targetType: 'DATASET' as const },
    kb: {
      table: schema.KnowledgeBase,
      noun: 'knowledge base',
      targetType: 'KNOWLEDGE_BASE' as const,
    },
    dashboard: {
      table: schema.Dashboard,
      noun: 'dashboard',
      targetType: 'DASHBOARD' as const,
    },
  }[entityDefinitionId]
  if (!resourceConfig) return

  const [resource] = await ctx.db
    .select({ name: resourceConfig.table.name })
    .from(resourceConfig.table)
    .where(
      and(
        eq(resourceConfig.table.id, entityInstanceId),
        eq(resourceConfig.table.organizationId, ctx.organizationId)
      )
    )
    .limit(1)
  if (!resource) return

  const level =
    input.permission === ResourcePermission.admin
      ? 'full'
      : input.permission === ResourcePermission.edit
        ? 'write'
        : 'read'
  const targetIds =
    entityDefinitionId === 'dataset'
      ? { datasetId: entityInstanceId }
      : entityDefinitionId === 'kb'
        ? { knowledgeBaseId: entityInstanceId }
        : { dashboardId: entityInstanceId }

  await Promise.all(
    recipientIds.map((userId) =>
      service.sendNotification({
        type: 'RESOURCE_SHARED',
        userId,
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        targetType: resourceConfig.targetType,
        targetIds: targetIds as never,
        message: `${actorName} shared the ${resourceConfig.noun} ${resource.name} with you`,
        metadata: {
          kind: 'RESOURCE_SHARED',
          resourceName: resource.name,
          noun: resourceConfig.noun,
          resourceKey: entityDefinitionId,
          level,
        },
      })
    )
  )
}

/**
 * Emit the cache event that busts visibility caches after a ResourceAccess
 * mutation. User grants invalidate just that user's keys; group/role/team
 * grants use the org-wide fan-out (the affected user set can't be enumerated
 * cheaply here). Call AFTER the DB write commits.
 *
 * Phase 0 of the mail-permissions plan wires the emission; Phase 1 attaches
 * the keys (`userMailVisibility`, `mailGrantIndex`) to the invalidation graph.
 */
async function emitResourceAccessChanged(
  organizationId: string,
  grantees: Array<{ granteeType: ResourceGranteeType; granteeId: string }>
): Promise<void> {
  const userIds = new Set<string>()
  let broadcast = false
  for (const g of grantees) {
    if (g.granteeType === ResourceGranteeType.user) userIds.add(g.granteeId)
    else broadcast = true
  }

  // A single org-wide fan-out already covers every member — no need to also
  // enumerate the user grants when broadcasting.
  if (broadcast) {
    await onCacheEvent('resource-access.changed', {
      orgId: organizationId,
      broadcastUserKeys: true,
    })
    return
  }

  await Promise.all(
    Array.from(userIds).map((userId) =>
      onCacheEvent('resource-access.changed', { orgId: organizationId, userId })
    )
  )
}

/**
 * Emit the narrow type-level cache event that busts the `userCapabilities`
 * `defAccess` map after a TYPE-level ResourceAccess mutation (§9.0). Same
 * user/broadcast fan-out shape as {@link emitResourceAccessChanged}; kept
 * separate so the noisy instance-level event isn't piggybacked onto capability
 * invalidation. Call AFTER the DB write commits, in addition to the
 * instance-level emit.
 *
 * Also publishes `publishCapabilitiesChanged` so OTHER members' live client
 * sessions re-compose def-access on a grant change (phase 4 §10) — the server
 * cache bust alone leaves clients stale until a natural refetch / TTL. Mirrors
 * {@link emitGrantChanged} in grant-service.ts.
 */
async function emitResourceAccessTypeChanged(
  organizationId: string,
  grantees: Array<{ granteeType: ResourceGranteeType; granteeId: string }>
): Promise<void> {
  const userIds = new Set<string>()
  let broadcast = false
  for (const g of grantees) {
    if (g.granteeType === ResourceGranteeType.user) userIds.add(g.granteeId)
    else broadcast = true
  }

  // Lazy import — the cache invalidation path lazily imports realtime, so this
  // module must not statically import the realtime barrel back (import cycle).
  const { getRealtimeService, publishCapabilitiesChanged } = await import('../realtime')

  if (broadcast) {
    await onCacheEvent('resource-access.type.changed', {
      orgId: organizationId,
      broadcastUserKeys: true,
    })
    await publishCapabilitiesChanged(getRealtimeService(), { orgId: organizationId })
    return
  }

  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      await onCacheEvent('resource-access.type.changed', { orgId: organizationId, userId })
      await publishCapabilitiesChanged(getRealtimeService(), { userId })
    })
  )
}

/**
 * Emit the narrow instance-level cache event that busts the `userCapabilities`
 * `instanceAccess` map + the org-wide `restrictedInstanceIds` set after an
 * INSTANCE-level ResourceAccess mutation whose target is an instance-access
 * resource (datasets etc., §1.5). Same user/broadcast fan-out shape as
 * {@link emitResourceAccessTypeChanged}; kept separate so generic mail-share
 * instance traffic (which only fires {@link emitResourceAccessChanged}) never
 * churns these caches. Also publishes `publishCapabilitiesChanged` so other
 * members' live sessions re-compose (phase 4 §10). Call AFTER the write commits.
 *
 * Exported (not module-private) — instance-access resources that write their own
 * `ResourceAccess` rows outside `grantInstanceAccess` (e.g. dashboards' create-time
 * baseline + owner grant, doc 13 §2) still need to fire this same invalidation.
 */
export async function emitResourceAccessInstanceChanged(
  organizationId: string,
  grantees: Array<{ granteeType: ResourceGranteeType; granteeId: string }>
): Promise<void> {
  const userIds = new Set<string>()
  let broadcast = false
  for (const g of grantees) {
    if (g.granteeType === ResourceGranteeType.user) userIds.add(g.granteeId)
    else broadcast = true
  }

  // Lazy import — the cache invalidation path lazily imports realtime, so this
  // module must not statically import the realtime barrel back (import cycle).
  const { getRealtimeService, publishCapabilitiesChanged } = await import('../realtime')

  if (broadcast) {
    await onCacheEvent('resource-access.instance.changed', {
      orgId: organizationId,
      broadcastUserKeys: true,
    })
    await publishCapabilitiesChanged(getRealtimeService(), { orgId: organizationId })
    return
  }

  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      await onCacheEvent('resource-access.instance.changed', { orgId: organizationId, userId })
      await publishCapabilitiesChanged(getRealtimeService(), { userId })
    })
  )
}

/**
 * Grant access to a specific entity instance.
 */
export async function grantInstanceAccess(
  ctx: ResourceAccessContext,
  input: GrantInstanceAccessInput
): Promise<void> {
  const { db, organizationId, userId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId)
  const existing = await db.query.ResourceAccess.findFirst({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
      eq(schema.ResourceAccess.granteeType, input.granteeType),
      eq(schema.ResourceAccess.granteeId, input.granteeId)
    ),
    columns: { id: true },
  })

  await db
    .insert(schema.ResourceAccess)
    .values({
      organizationId,
      entityDefinitionId,
      entityInstanceId,
      granteeType: input.granteeType,
      granteeId: input.granteeId,
      permission: input.permission,
      lens: input.lens ?? null,
      grantedById: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.ResourceAccess.organizationId,
        schema.ResourceAccess.entityDefinitionId,
        schema.ResourceAccess.entityInstanceId,
        schema.ResourceAccess.granteeType,
        schema.ResourceAccess.granteeId,
      ],
      set: {
        permission: input.permission,
        lens: input.lens ?? null,
        grantedById: userId,
        updatedAt: new Date(),
      },
    })

  const grantees = [{ granteeType: input.granteeType, granteeId: input.granteeId }]
  await emitResourceAccessChanged(organizationId, grantees)
  if (isInstanceAccessKey(entityDefinitionId)) {
    await emitResourceAccessInstanceChanged(organizationId, grantees)
  }

  if (!existing) {
    void notifyNewInstanceShare(ctx, input, entityDefinitionId, entityInstanceId).catch((error) => {
      logger.warn('Failed to send instance share notification', {
        organizationId,
        recordId: input.recordId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

/**
 * Grant type-level access (access to ALL instances of an entity type).
 */
export async function grantTypeAccess(
  ctx: ResourceAccessContext,
  input: GrantTypeAccessInput
): Promise<void> {
  const { db, organizationId, userId } = ctx

  await db
    .insert(schema.ResourceAccess)
    .values({
      organizationId,
      entityDefinitionId: input.entityDefinitionId,
      entityInstanceId: null,
      granteeType: input.granteeType,
      granteeId: input.granteeId,
      permission: input.permission,
      grantedById: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.ResourceAccess.organizationId,
        schema.ResourceAccess.entityDefinitionId,
        schema.ResourceAccess.entityInstanceId,
        schema.ResourceAccess.granteeType,
        schema.ResourceAccess.granteeId,
      ],
      set: {
        permission: input.permission,
        grantedById: userId,
        updatedAt: new Date(),
      },
    })

  const grantees = [{ granteeType: input.granteeType, granteeId: input.granteeId }]
  await emitResourceAccessChanged(organizationId, grantees)
  await emitResourceAccessTypeChanged(organizationId, grantees)
}

/**
 * Revoke access to a specific entity instance.
 */
export async function revokeInstanceAccess(
  ctx: ResourceAccessContext,
  input: RevokeInstanceAccessInput
): Promise<boolean> {
  const { db, organizationId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId)

  const result = await db
    .delete(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
        eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
        eq(schema.ResourceAccess.granteeType, input.granteeType),
        eq(schema.ResourceAccess.granteeId, input.granteeId)
      )
    )
    .returning()

  if (result.length > 0) {
    const grantees = [{ granteeType: input.granteeType, granteeId: input.granteeId }]
    await emitResourceAccessChanged(organizationId, grantees)
    if (isInstanceAccessKey(entityDefinitionId)) {
      await emitResourceAccessInstanceChanged(organizationId, grantees)
    }

    if (entityDefinitionId === 'thread' || isInstanceAccessKey(entityDefinitionId)) {
      const recipients = await resolveShareRecipients(ctx, {
        ...input,
        permission: ResourcePermission.view,
      })
      const targetType =
        entityDefinitionId === 'thread'
          ? 'THREAD'
          : entityDefinitionId === 'dataset'
            ? 'DATASET'
            : entityDefinitionId === 'kb'
              ? 'KNOWLEDGE_BASE'
              : 'DASHBOARD'
      const targetIds =
        entityDefinitionId === 'thread'
          ? { threadId: entityInstanceId }
          : entityDefinitionId === 'dataset'
            ? { datasetId: entityInstanceId }
            : entityDefinitionId === 'kb'
              ? { knowledgeBaseId: entityInstanceId }
              : { dashboardId: entityInstanceId }
      await new NotificationService(db).deleteNotificationsByTarget(
        targetType,
        targetIds as never,
        organizationId,
        {
          userIds: recipients,
          types: [entityDefinitionId === 'thread' ? 'MESSAGE_SHARED' : 'RESOURCE_SHARED'],
        }
      )
    }
  }

  return result.length > 0
}

/**
 * Revoke type-level access.
 */
export async function revokeTypeAccess(
  ctx: ResourceAccessContext,
  input: RevokeTypeAccessInput
): Promise<boolean> {
  const { db, organizationId } = ctx

  const result = await db
    .delete(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        eq(schema.ResourceAccess.entityDefinitionId, input.entityDefinitionId),
        isNull(schema.ResourceAccess.entityInstanceId),
        eq(schema.ResourceAccess.granteeType, input.granteeType),
        eq(schema.ResourceAccess.granteeId, input.granteeId)
      )
    )
    .returning()

  if (result.length > 0) {
    const grantees = [{ granteeType: input.granteeType, granteeId: input.granteeId }]
    await emitResourceAccessChanged(organizationId, grantees)
    await emitResourceAccessTypeChanged(organizationId, grantees)
  }

  return result.length > 0
}

/**
 * Set instance-level access grants (replace all existing grants for a grantee type on this instance).
 */
export async function setInstanceAccess(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  granteeType: ResourceGranteeType,
  grants: Array<{ granteeId: string; permission: ResourcePermission; lens?: GrantLens | null }>
): Promise<void> {
  const { db, organizationId, userId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const removed = await db.transaction(async (tx: typeof db) => {
    // Remove existing grants of this type for this instance
    const deleted = await tx
      .delete(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
          eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
          eq(schema.ResourceAccess.granteeType, granteeType)
        )
      )
      .returning({ granteeId: schema.ResourceAccess.granteeId })

    // Insert new grants
    if (grants.length > 0) {
      await tx.insert(schema.ResourceAccess).values(
        grants.map((g) => ({
          organizationId,
          entityDefinitionId,
          entityInstanceId,
          granteeType,
          granteeId: g.granteeId,
          permission: g.permission,
          lens: g.lens ?? null,
          grantedById: userId,
        }))
      )
    }

    return deleted
  })

  // Affected grantees = removed ∪ added (a removed grantee also loses access).
  const affected = new Set([...removed.map((r) => r.granteeId), ...grants.map((g) => g.granteeId)])
  const grantees = Array.from(affected, (granteeId) => ({ granteeType, granteeId }))
  await emitResourceAccessChanged(organizationId, grantees)
  if (isInstanceAccessKey(entityDefinitionId)) {
    await emitResourceAccessInstanceChanged(organizationId, grantees)
  }
}

/**
 * Set type-level access grants (replace all existing grants for a grantee type on this entity type).
 */
export async function setTypeAccess(
  ctx: ResourceAccessContext,
  entityDefinitionId: string,
  granteeType: ResourceGranteeType,
  grants: Array<{ granteeId: string; permission: ResourcePermission }>
): Promise<void> {
  const { db, organizationId, userId } = ctx

  const removed = await db.transaction(async (tx: typeof db) => {
    // Remove existing type-level grants of this type
    const deleted = await tx
      .delete(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
          isNull(schema.ResourceAccess.entityInstanceId),
          eq(schema.ResourceAccess.granteeType, granteeType)
        )
      )
      .returning({ granteeId: schema.ResourceAccess.granteeId })

    // Insert new grants
    if (grants.length > 0) {
      await tx.insert(schema.ResourceAccess).values(
        grants.map((g) => ({
          organizationId,
          entityDefinitionId,
          entityInstanceId: null,
          granteeType,
          granteeId: g.granteeId,
          permission: g.permission,
          grantedById: userId,
        }))
      )
    }

    return deleted
  })

  // Affected grantees = removed ∪ added (a removed grantee also loses access).
  const affected = new Set([...removed.map((r) => r.granteeId), ...grants.map((g) => g.granteeId)])
  const grantees = Array.from(affected, (granteeId) => ({ granteeType, granteeId }))
  await emitResourceAccessChanged(organizationId, grantees)
  await emitResourceAccessTypeChanged(organizationId, grantees)
}

/**
 * Check if a user has access to a specific entity instance.
 * Checks both instance-level and type-level grants.
 */
export async function checkAccess(
  ctx: ResourceAccessContext,
  input: CheckAccessInput
): Promise<AccessCheckResult> {
  const { db, organizationId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId)
  const targetUserId = input.userId

  // 1. Check if user is org admin (has access to everything)
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, targetUserId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  if (member && ['OWNER', 'ADMIN'].includes(member.role)) {
    return {
      hasAccess: true,
      permission: ResourcePermission.admin,
      grantedVia: 'role',
      accessLevel: 'type',
    }
  }

  // 2. Get user's groups (for group-based access)
  const groupIds = await getCachedUserGroupIds(organizationId, targetUserId)

  // 3. Build grantee conditions
  const granteeConditions = [
    // Direct user grant
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.user),
      eq(schema.ResourceAccess.granteeId, targetUserId)
    ),
    // Role grant (org_member)
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]

  // Group grants (if user belongs to any groups)
  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  // 4. Find matching access grants (both instance-level and type-level)
  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      // Match either this specific instance OR type-level (null instance)
      or(
        eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
        isNull(schema.ResourceAccess.entityInstanceId)
      ),
      or(...granteeConditions)
    ),
  })

  if (grants.length === 0) {
    return { hasAccess: false, permission: null, grantedVia: null, accessLevel: null }
  }

  // 5. Find highest permission level (instance-specific grants take precedence)
  let highestPermission: ResourcePermission = grants[0]!.permission as ResourcePermission
  let grantedVia: 'direct' | 'group' | 'team' | 'role' = 'direct'
  let accessLevel: 'type' | 'instance' = grants[0]!.entityInstanceId ? 'instance' : 'type'

  for (const grant of grants) {
    const perm = grant.permission as ResourcePermission
    const isInstanceLevel = !!grant.entityInstanceId

    // Instance-level grants have priority, then compare permission level
    if (isInstanceLevel && accessLevel === 'type') {
      highestPermission = perm
      accessLevel = 'instance'
    } else if (isInstanceLevel === (accessLevel === 'instance')) {
      if (satisfiesPermission(perm, highestPermission)) {
        highestPermission = perm
      }
    }

    // Track how access was granted
    if (grant.granteeType === ResourceGranteeType.user) {
      grantedVia = 'direct'
    } else if (grant.granteeType === ResourceGranteeType.group) {
      grantedVia = 'group'
    } else if (grant.granteeType === ResourceGranteeType.team) {
      grantedVia = 'team'
    } else if (grant.granteeType === ResourceGranteeType.role) {
      grantedVia = 'role'
    }
  }

  return {
    hasAccess: true,
    permission: highestPermission,
    grantedVia,
    accessLevel,
  }
}

/**
 * Check if user has type-level access (access to ALL instances of an entity type).
 */
export async function checkTypeAccess(
  ctx: ResourceAccessContext,
  input: CheckTypeAccessInput
): Promise<AccessCheckResult> {
  const { db, organizationId } = ctx
  const { entityDefinitionId } = input
  const targetUserId = input.userId

  // Check for org admin
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, targetUserId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  if (member && ['OWNER', 'ADMIN'].includes(member.role)) {
    return {
      hasAccess: true,
      permission: ResourcePermission.admin,
      grantedVia: 'role',
      accessLevel: 'type',
    }
  }

  // Get user's groups
  const groupIds = await getCachedUserGroupIds(organizationId, targetUserId)

  // Build grantee conditions
  const granteeConditions = [
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.user),
      eq(schema.ResourceAccess.granteeId, targetUserId)
    ),
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]

  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  // Find type-level grants only (entityInstanceId is null)
  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      isNull(schema.ResourceAccess.entityInstanceId),
      or(...granteeConditions)
    ),
  })

  if (grants.length === 0) {
    return { hasAccess: false, permission: null, grantedVia: null, accessLevel: null }
  }

  // Find highest permission
  let highestPermission: ResourcePermission = grants[0]!.permission as ResourcePermission
  let grantedVia: 'direct' | 'group' | 'team' | 'role' = 'direct'

  for (const grant of grants) {
    const perm = grant.permission as ResourcePermission
    if (satisfiesPermission(perm, highestPermission)) {
      highestPermission = perm
      if (grant.granteeType === ResourceGranteeType.user) grantedVia = 'direct'
      else if (grant.granteeType === ResourceGranteeType.group) grantedVia = 'group'
      else if (grant.granteeType === ResourceGranteeType.team) grantedVia = 'team'
      else if (grant.granteeType === ResourceGranteeType.role) grantedVia = 'role'
    }
  }

  return {
    hasAccess: true,
    permission: highestPermission,
    grantedVia,
    accessLevel: 'type',
  }
}

/**
 * Check if user has at least the required permission level for a specific instance.
 */
export async function hasPermission(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  required: ResourcePermission
): Promise<boolean> {
  const result = await checkAccess(ctx, {
    recordId,
    userId: ctx.userId,
  })

  if (!result.hasAccess || !result.permission) return false
  return satisfiesPermission(result.permission, required)
}

/**
 * Get all access grants for a specific instance.
 */
export async function getInstanceAccess(
  ctx: ResourceAccessContext,
  recordId: RecordId
): Promise<ResourceAccessInfo[]> {
  const { db, organizationId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      eq(schema.ResourceAccess.entityInstanceId, entityInstanceId)
    ),
    orderBy: desc(schema.ResourceAccess.createdAt),
  })

  return grants.map((g: any) => ({
    id: g.id,
    entityDefinitionId: g.entityDefinitionId,
    entityInstanceId: g.entityInstanceId,
    granteeType: g.granteeType as ResourceGranteeType,
    granteeId: g.granteeId,
    permission: g.permission as ResourcePermission,
    lens: (g.lens ?? null) as GrantLens | null,
    createdAt: g.createdAt,
  }))
}

/**
 * Get all type-level access grants for an entity type.
 */
export async function getTypeAccess(
  ctx: ResourceAccessContext,
  entityDefinitionId: string
): Promise<ResourceAccessInfo[]> {
  const { db, organizationId } = ctx

  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      isNull(schema.ResourceAccess.entityInstanceId)
    ),
    orderBy: desc(schema.ResourceAccess.createdAt),
  })

  return grants.map((g: any) => ({
    id: g.id,
    entityDefinitionId: g.entityDefinitionId,
    entityInstanceId: g.entityInstanceId,
    granteeType: g.granteeType as ResourceGranteeType,
    granteeId: g.granteeId,
    permission: g.permission as ResourcePermission,
    createdAt: g.createdAt,
  }))
}

/**
 * All type-level (`entityInstanceId IS NULL`) access rows for the org, across
 * every def — the org-wide access configuration in one read. Powers the
 * grantee-centric Access UI (capability layer v2 grantee-def-access), where each
 * def's baseline (`role:org_member`) and a given grantee's own grant are derived
 * client-side from this single fetch. Type rows are sparse (only configured defs
 * have any), so this stays cheap. Admin-only at the endpoint — it reveals the
 * whole org's restriction map.
 */
export async function getAllTypeAccess(ctx: ResourceAccessContext): Promise<ResourceAccessInfo[]> {
  const { db, organizationId } = ctx

  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      isNull(schema.ResourceAccess.entityInstanceId)
    ),
    orderBy: desc(schema.ResourceAccess.createdAt),
  })

  return grants.map((g: any) => ({
    id: g.id,
    entityDefinitionId: g.entityDefinitionId,
    entityInstanceId: g.entityInstanceId,
    granteeType: g.granteeType as ResourceGranteeType,
    granteeId: g.granteeId,
    permission: g.permission as ResourcePermission,
    createdAt: g.createdAt,
  }))
}

/**
 * Get all entity instances accessible by a user (including via groups).
 * Returns both type-level grants (hasTypeAccess=true) and instance-specific grants.
 */
export async function getUserAccessibleInstances(
  ctx: ResourceAccessContext,
  userId: string,
  entityDefinitionId: string
): Promise<{
  hasTypeAccess: boolean
  typePermission: ResourcePermission | null
  instances: InstanceAccess[]
}> {
  const { db, organizationId } = ctx

  // Get user's groups
  const groupIds = await getCachedUserGroupIds(organizationId, userId)

  // Build grantee conditions
  const granteeConditions = [
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.user),
      eq(schema.ResourceAccess.granteeId, userId)
    ),
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]

  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      or(...granteeConditions)
    ),
  })

  // Separate type-level and instance-level grants
  let hasTypeAccess = false
  let typePermission: ResourcePermission | null = null
  const instanceMap = new Map<string, ResourcePermission>()

  for (const grant of grants) {
    if (!grant.entityInstanceId) {
      // Type-level grant
      hasTypeAccess = true
      const perm = grant.permission as ResourcePermission
      if (!typePermission || satisfiesPermission(perm, typePermission)) {
        typePermission = perm
      }
    } else {
      // Instance-level grant
      const existing = instanceMap.get(grant.entityInstanceId)
      const current = grant.permission as ResourcePermission
      if (!existing || satisfiesPermission(current, existing)) {
        instanceMap.set(grant.entityInstanceId, current)
      }
    }
  }

  return {
    hasTypeAccess,
    typePermission,
    instances: Array.from(instanceMap.entries()).map(([instanceId, permission]) => ({
      recordId: toRecordId(entityDefinitionId, instanceId),
      permission,
    })),
  }
}
