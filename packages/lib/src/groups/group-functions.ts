// packages/lib/src/groups/group-functions.ts

import { and, eq, inArray, isNull, sql, asc, or } from 'drizzle-orm'
import { schema } from '@auxx/database'
import type { EntityInstanceEntity } from '@auxx/database'
import { MemberType, GroupVisibility, ResourcePermission, ResourceGranteeType } from '@auxx/database/enums'
import { generateNKeysBetween } from '@auxx/utils'
import type {
  GroupContext,
  CreateGroupInput,
  AddMembersInput,
  AddMembersResult,
  GroupMember,
} from '@auxx/types/groups'
import { requireGroupPermission, hasGroupPermission } from './permissions'
import { NotFoundError } from '../errors'
import { createEntityInstance } from '@auxx/services/entity-instances'

// ============================================================================
// Group Metadata Type
// ============================================================================

/** Metadata stored on EntityInstance for entity_group type */
interface GroupMetadata {
  memberType?: 'any' | string
  visibility?: GroupVisibility
  color?: string
  icon?: string
  memberCount?: number
}

// ============================================================================
// Group CRUD Operations
// ============================================================================

/**
 * Create a new entity group
 */
export async function createGroup(ctx: GroupContext, input: CreateGroupInput): Promise<EntityInstanceEntity> {
  const { db, organizationId, userId } = ctx

  // Get group EntityDefinition
  const groupDef = await db.query.EntityDefinition.findFirst({
    where: and(
      eq(schema.EntityDefinition.entityType, 'entity_group'),
      eq(schema.EntityDefinition.organizationId, organizationId)
    ),
  })

  if (!groupDef) {
    throw new NotFoundError('Entity group definition not found. Please run entity seeder first.')
  }

  // Create group instance with metadata using service
  const metadata: GroupMetadata = {
    memberType: input.memberType,
    visibility: input.visibility,
    color: input.color,
    icon: input.icon,
    memberCount: 0,
  }

  const result = await createEntityInstance(
    {
      entityDefinitionId: groupDef.id,
      organizationId,
      createdById: userId,
      displayName: input.name,
      secondaryDisplayValue: input.description,
      metadata,
    },
    db
  )

  if (result.isErr()) {
    throw new Error(`Failed to create group instance: ${result.error.message}`)
  }

  const groupInstance = result.value

  // Create default permissions
  await createDefaultPermissions(ctx, groupInstance.id, input.visibility)

  return groupInstance
}

/**
 * Delete a group
 */
export async function deleteGroup(ctx: GroupContext, groupId: string): Promise<void> {
  const { db } = ctx

  await requireGroupPermission(ctx, groupId, ResourcePermission.admin)

  // Cascade deletes handle members and permissions
  await db.delete(schema.EntityInstance).where(eq(schema.EntityInstance.id, groupId))
}

/**
 * List groups the current user can access
 */
export async function listAccessibleGroups(
  ctx: GroupContext,
  options?: { search?: string; limit?: number; offset?: number }
): Promise<EntityInstanceEntity[]> {
  const { db, organizationId, userId } = ctx

  // Check if user is org admin (sees all groups)
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, userId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  const isAdmin = member && ['OWNER', 'ADMIN'].includes(member.role)

  // Get group definition for filtering
  const groupDef = await db.query.EntityDefinition.findFirst({
    where: and(
      eq(schema.EntityDefinition.entityType, 'entity_group'),
      eq(schema.EntityDefinition.organizationId, organizationId)
    ),
    columns: { id: true },
  })

  if (!groupDef) return []

  if (isAdmin) {
    // Admin sees all groups
    return db.query.EntityInstance.findMany({
      where: and(
        eq(schema.EntityInstance.entityDefinitionId, groupDef.id),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt)
      ),
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    })
  }

  // Use ResourceAccess to get accessible group IDs
  const { getUserAccessibleInstances } = await import('../resource-access')
  const { parseRecordId } = await import('@auxx/types/resource')

  const result = await getUserAccessibleInstances(
    { db, organizationId, userId },
    userId,
    groupDef.id
  )

  if (result.hasTypeAccess) {
    // User has type-level access to ALL groups
    return db.query.EntityInstance.findMany({
      where: and(
        eq(schema.EntityInstance.entityDefinitionId, groupDef.id),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt)
      ),
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    })
  }

  const accessibleGroupIds = result.instances.map(
    (i) => parseRecordId(i.recordId).entityInstanceId
  )

  if (accessibleGroupIds.length === 0) return []

  return db.query.EntityInstance.findMany({
    where: and(
      inArray(schema.EntityInstance.id, accessibleGroupIds),
      eq(schema.EntityInstance.organizationId, organizationId),
      isNull(schema.EntityInstance.archivedAt)
    ),
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
  })
}

// ============================================================================
// Member Operations
// ============================================================================

/**
 * Add members to a group
 */
export async function addMembers(ctx: GroupContext, input: AddMembersInput): Promise<AddMembersResult> {
  const { db, userId } = ctx
  const { groupId, members } = input

  // Check permission - edit permission allows member management
  await requireGroupPermission(ctx, groupId, ResourcePermission.edit)

  if (members.length === 0) {
    return { added: 0, skipped: 0 }
  }

  // Generate sort keys for new members
  const sortKeys = generateNKeysBetween(null, null, members.length)

  // Insert memberships with conflict handling
  const result = await db
    .insert(schema.EntityGroupMember)
    .values(
      members.map((member, i) => ({
        groupInstanceId: groupId,
        memberType: member.type,
        memberRefId: member.id,
        addedById: userId,
        sortKey: sortKeys[i]!,
      }))
    )
    .onConflictDoNothing()
    .returning()

  // Update member count
  await updateMemberCount(ctx, groupId)

  return {
    added: result.length,
    skipped: members.length - result.length,
  }
}

/**
 * Remove members from a group
 */
export async function removeMembers(
  ctx: GroupContext,
  groupId: string,
  members: Array<{ type: MemberType; id: string }>
): Promise<number> {
  const { db } = ctx

  // Check permission - edit permission allows member management
  await requireGroupPermission(ctx, groupId, ResourcePermission.edit)

  if (members.length === 0) return 0

  // Build OR conditions for each member
  const conditions = members.map((m) =>
    and(eq(schema.EntityGroupMember.memberType, m.type), eq(schema.EntityGroupMember.memberRefId, m.id))
  )

  const result = await db
    .delete(schema.EntityGroupMember)
    .where(and(eq(schema.EntityGroupMember.groupInstanceId, groupId), or(...conditions)))
    .returning()

  await updateMemberCount(ctx, groupId)

  return result.length
}

/**
 * Get members of a group with resolved entity/user data
 */
export async function getMembers(
  ctx: GroupContext,
  groupId: string,
  options?: { limit?: number; offset?: number }
): Promise<GroupMember[]> {
  const { db } = ctx

  await requireGroupPermission(ctx, groupId, ResourcePermission.view)

  const memberships = await db.query.EntityGroupMember.findMany({
    where: eq(schema.EntityGroupMember.groupInstanceId, groupId),
    orderBy: asc(schema.EntityGroupMember.sortKey),
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0,
  })

  // Separate entity and user members
  const entityIds = memberships.filter((m) => m.memberType === MemberType.entity).map((m) => m.memberRefId)
  const userIds = memberships.filter((m) => m.memberType === MemberType.user).map((m) => m.memberRefId)

  // Batch fetch entities and users
  const [entities, users] = await Promise.all([
    entityIds.length > 0
      ? db.query.EntityInstance.findMany({
          where: inArray(schema.EntityInstance.id, entityIds),
        })
      : [],
    userIds.length > 0
      ? db.query.User.findMany({
          where: inArray(schema.User.id, userIds),
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        })
      : [],
  ])

  // Create lookup maps
  const entityMap = new Map(entities.map((e) => [e.id, e]))
  const userMap = new Map(users.map((u) => [u.id, u]))

  // Resolve members
  return memberships.map((m) => ({
    id: m.id,
    memberType: m.memberType as MemberType,
    memberRefId: m.memberRefId,
    sortKey: m.sortKey,
    createdAt: m.createdAt,
    entity: m.memberType === MemberType.entity ? entityMap.get(m.memberRefId) : undefined,
    user: m.memberType === MemberType.user ? userMap.get(m.memberRefId) : undefined,
  }))
}

/**
 * Get groups that a user belongs to
 */
export async function getGroupsForUser(ctx: GroupContext, targetUserId: string): Promise<EntityInstanceEntity[]> {
  const { db } = ctx

  // Fetch memberships with group data using relations
  const memberships = await db.query.EntityGroupMember.findMany({
    where: and(
      eq(schema.EntityGroupMember.memberType, MemberType.user),
      eq(schema.EntityGroupMember.memberRefId, targetUserId)
    ),
    with: {
      groupInstance: true,
    },
  })

  if (memberships.length === 0) return []

  // Filter to groups user can view (check permissions in parallel)
  const permissionChecks = await Promise.all(
    memberships.map(async (m) => ({
      group: m.groupInstance,
      canView: await hasGroupPermission(ctx, m.groupInstanceId, ResourcePermission.view),
    }))
  )

  return permissionChecks.filter((p) => p.canView && p.group).map((p) => p.group!)
}

/**
 * Get groups that an entity belongs to
 */
export async function getGroupsForEntity(ctx: GroupContext, entityId: string): Promise<EntityInstanceEntity[]> {
  const { db } = ctx

  // Fetch memberships with group data using relations
  const memberships = await db.query.EntityGroupMember.findMany({
    where: and(
      eq(schema.EntityGroupMember.memberType, MemberType.entity),
      eq(schema.EntityGroupMember.memberRefId, entityId)
    ),
    with: {
      groupInstance: true,
    },
  })

  if (memberships.length === 0) return []

  // Filter to groups user can view (check permissions in parallel)
  const permissionChecks = await Promise.all(
    memberships.map(async (m) => ({
      group: m.groupInstance,
      canView: await hasGroupPermission(ctx, m.groupInstanceId, ResourcePermission.view),
    }))
  )

  return permissionChecks.filter((p) => p.canView && p.group).map((p) => p.group!)
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Create default permissions for a new group via ResourceAccess
 */
async function createDefaultPermissions(
  ctx: GroupContext,
  groupId: string,
  visibility: GroupVisibility
): Promise<void> {
  const { db, organizationId, userId } = ctx

  // Get entity_group entityDefinitionId (cached for 30 days)
  const { ResourceRegistryService } = await import('../resources/registry')
  const registry = new ResourceRegistryService(organizationId, db)
  const entityDefinitionId = await registry.resolveEntityDefId('entity_group')

  const { grantInstanceAccess } = await import('../resource-access')
  const { toRecordId } = await import('@auxx/types/resource')

  const recordId = toRecordId(entityDefinitionId, groupId)
  const resourceCtx = { db, organizationId, userId }

  // Creator gets admin
  await grantInstanceAccess(resourceCtx, {
    recordId,
    granteeType: ResourceGranteeType.user,
    granteeId: userId,
    permission: ResourcePermission.admin,
  })

  // Public groups: all org members get view
  if (visibility === GroupVisibility.public) {
    await grantInstanceAccess(resourceCtx, {
      recordId,
      granteeType: ResourceGranteeType.role,
      granteeId: 'org_member',
      permission: ResourcePermission.view,
    })
  }
}

/**
 * Update member count in group metadata
 */
async function updateMemberCount(ctx: GroupContext, groupId: string): Promise<void> {
  const { db } = ctx

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.EntityGroupMember)
    .where(eq(schema.EntityGroupMember.groupInstanceId, groupId))

  const count = Number(result?.count ?? 0)

  // Update metadata with new count
  const group = await db.query.EntityInstance.findFirst({
    where: eq(schema.EntityInstance.id, groupId),
    columns: { metadata: true },
  })

  const currentMetadata = (group?.metadata as GroupMetadata) ?? {}

  await db
    .update(schema.EntityInstance)
    .set({
      metadata: {
        ...currentMetadata,
        memberCount: count,
      },
    })
    .where(eq(schema.EntityInstance.id, groupId))
}
