// lib/inbox/inbox-service.ts
import { InboxStatus, MemberType, BuiltInEntityType, ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { type InboxIntegrationEntity as InboxIntegration } from '@auxx/database/models'

import { database as db, schema, type Database } from '@auxx/database'
import { eq, and, or, inArray, sql, desc } from 'drizzle-orm'
import { setInstanceAccess, getInstanceAccess, getUserAccessibleInstances } from '@auxx/lib/resource-access'
import { toRecordId, parseRecordId } from '@auxx/types/resource'

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import type {
  CreateInboxInput,
  InboxAccessInput,
  InboxWithRelations,
  UpdateInboxInput,
} from './types'

const logger = createScopedLogger('inbox-service')

const DefaultInboxWith = {
  integrations: {
    with: { integration: { columns: { name: true, email: true, provider: true } } },
  },
  memberAccess: true,
  // Note: groupAccess removed - migrated to ResourceAccess
} as const

export class InboxService {
  private organizationId: string
  private enableCache: boolean
  private cacheTtl: number // in seconds

  /**
   * Create a new InboxService instance
   * @param db Database instance (not used - we use the imported db directly)
   * @param organizationId Organization ID to scope operations to
   * @param options Optional service configuration
   */
  constructor(
    db: Database,
    organizationId: string,
    options: { enableCache?: boolean; cacheTtl?: number } = {}
  ) {
    this.organizationId = organizationId
    this.enableCache = options.enableCache ?? false // Enable by default
    this.cacheTtl = options.cacheTtl ?? 300 // 5 minutes default TTL
  }

  /**
   * Get cache key for user inboxes
   * @param userId User ID
   * @returns Cache key string
   */
  private getUserInboxesCacheKey(userId: string): string {
    return `inbox:user:${userId}:org:${this.organizationId}`
  }

  /**
   * Get cache key for organization inboxes
   * @returns Cache key string
   */
  private getOrgInboxesCacheKey(): string {
    return `inbox:org:${this.organizationId}`
  }

  /**
   * Try to get data from cache
   * @param key Cache key
   * @returns Cached data or null if not found
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.enableCache) return null

    try {
      const redis = await getRedisClient(false)
      if (!redis) return null

      const cachedData = await redis.get(key)
      if (cachedData) {
        return JSON.parse(cachedData) as T
      }
    } catch (error) {
      logger.warn('Cache retrieval failed', { error, key })
    }

    return null
  }

  /**
   * Set data in cache
   * @param key Cache key
   * @param data Data to cache
   * @returns Success status
   */
  private async setInCache<T>(key: string, data: T): Promise<boolean> {
    if (!this.enableCache) return false

    try {
      const redis = await getRedisClient(false)
      if (!redis) return false

      await redis.set(key, JSON.stringify(data), 'EX', this.cacheTtl)
      return true
    } catch (error) {
      logger.warn('Cache storage failed', { error, key })
      return false
    }
  }

  /**
   * Invalidate all inbox caches for an organization
   */
  async invalidateAllInboxCaches(): Promise<void> {
    if (!this.enableCache) return

    try {
      const redis = await getRedisClient(false)
      if (!redis || !redis.keys) {
        logger.debug('Redis unavailable, skipping cache invalidation')
        return
      }

      const pattern = `inbox:*:org:${this.organizationId}*`

      // Find all keys matching the pattern
      const keys = await redis.keys(pattern)
      logger.info('Found keys to invalidate', { keys, pattern })
      // Delete all matching keys
      if (keys.length > 0) {
        await redis!.del(...keys)
        logger.info('Invalidated all inbox caches', {
          organizationId: this.organizationId,
          keyCount: keys.length,
        })
      }
    } catch (error) {
      logger.error('Error invalidating inbox caches', { error })
      // Continue execution even if cache invalidation fails
    }
  }

  /**
   * Invalidate inbox cache for a specific user
   * @param userId User ID
   */
  async invalidateUserInboxCache(userId: string): Promise<void> {
    if (!this.enableCache) return

    try {
      const redis = await getRedisClient(false)
      if (!redis) {
        logger.debug('Redis unavailable, skipping user cache invalidation')
        return
      }

      const key = this.getUserInboxesCacheKey(userId)
      await redis.del(key)
      logger.info('Invalidated user inbox cache', { userId })
    } catch (error) {
      logger.error('Error invalidating user inbox cache', { error, userId })
      // Continue execution even if cache invalidation fails
    }
  }

  /**
   * Create a new inbox for the organization
   * @param data Inbox creation data
   * @returns The created inbox with its relations
   */
  async createInbox(data: CreateInboxInput): Promise<InboxWithRelations> {
    try {
      logger.info('Creating new inbox', { organizationId: this.organizationId, name: data.name })

      const [inbox] = await db
        .insert(schema.Inbox)
        .values({
          name: data.name,
          description: data.description,
          color: data.color,
          status: data.status || InboxStatus.ACTIVE,
          settings: data.settings ? data.settings : {},
          organizationId: this.organizationId,
          // Access control fields directly on Inbox
          allowAllMembers: data.allowAllMembers ?? true,
          enableMemberAccess: data.enableMemberAccess ?? false,
          enableGroupAccess: data.enableGroupAccess ?? false,
          updatedAt: new Date(),
        })
        .returning()

      // Get the created inbox with relations
      const inboxWithRelations = await db.query.Inbox.findFirst({
        where: eq(schema.Inbox.id, inbox!.id),
        with: DefaultInboxWith,
      })

      if (!inboxWithRelations) {
        throw new Error('Failed to retrieve created inbox')
      }

      // Invalidate caches after successful creation
      await this.invalidateAllInboxCaches()

      return inboxWithRelations
    } catch (error) {
      logger.error('Error creating inbox', { error, data, organizationId: this.organizationId })
      throw error
    }
  }

  /**
   * Get all inboxes for the organization
   * @returns Array of inboxes with their relations
   */
  async getInboxes(): Promise<InboxWithRelations[]> {
    try {
      const cacheKey = this.getOrgInboxesCacheKey()
      logger.info('Fetching organization inboxes', { cacheKey })

      // Try to get from cache
      const cachedInboxes = await this.getFromCache<InboxWithRelations[]>(cacheKey)

      if (cachedInboxes) {
        logger.info('Retrieved organization inboxes from cache', {
          organizationId: this.organizationId,
        })
        return cachedInboxes
      }

      logger.info('Fetching inboxes from database', { organizationId: this.organizationId })

      const inboxes = await db.query.Inbox.findMany({
        where: eq(schema.Inbox.organizationId, this.organizationId),
        with: DefaultInboxWith,
        orderBy: [desc(schema.Inbox.createdAt)],
      })

      // Store in cache for future requests
      await this.setInCache(cacheKey, inboxes)

      return inboxes
    } catch (error) {
      logger.error('Error fetching inboxes', { error, organizationId: this.organizationId })
      throw error
    }
  }

  /**
   * Get a specific inbox by ID
   * @param inboxId The inbox ID
   * @returns The inbox with its relations, or null if not found
   */
  async getInbox(inboxId: string): Promise<InboxWithRelations | null> {
    try {
      const cacheKey = `inbox:${inboxId}:org:${this.organizationId}`

      // Try to get from cache
      const cachedInbox = await this.getFromCache<InboxWithRelations>(cacheKey)
      if (cachedInbox) {
        logger.info('Retrieved inbox from cache', { inboxId })
        return cachedInbox
      }

      logger.info('Fetching inbox from database', { inboxId, organizationId: this.organizationId })

      const inbox = await db.query.Inbox.findFirst({
        where: and(
          eq(schema.Inbox.id, inboxId),
          eq(schema.Inbox.organizationId, this.organizationId)
        ),
        with: DefaultInboxWith,
      })

      // Only cache if inbox exists
      if (inbox) {
        await this.setInCache(cacheKey, inbox)
      }

      return inbox || null
    } catch (error) {
      logger.error('Error fetching inbox', { error, inboxId, organizationId: this.organizationId })
      throw error
    }
  }

  /**
   * Update an existing inbox
   * @param inboxId The inbox ID
   * @param data Update data
   * @returns The updated inbox with its relations
   */
  async updateInbox(inboxId: string, data: UpdateInboxInput): Promise<InboxWithRelations> {
    try {
      logger.info('Updating inbox', { inboxId, organizationId: this.organizationId, data })

      const updateData: Partial<typeof schema.Inbox.$inferInsert> = {
        updatedAt: new Date(),
      }

      if (data.name !== undefined) updateData.name = data.name
      if (data.description !== undefined) updateData.description = data.description
      if (data.color !== undefined) updateData.color = data.color
      if (data.status !== undefined) updateData.status = data.status
      if (data.settings !== undefined) updateData.settings = data.settings

      await db
        .update(schema.Inbox)
        .set(updateData)
        .where(
          and(eq(schema.Inbox.id, inboxId), eq(schema.Inbox.organizationId, this.organizationId))
        )

      // Get updated inbox with relations
      const result = await db.query.Inbox.findFirst({
        where: and(
          eq(schema.Inbox.id, inboxId),
          eq(schema.Inbox.organizationId, this.organizationId)
        ),
        with: DefaultInboxWith,
      })

      if (!result) {
        throw new Error('Inbox not found after update')
      }

      // Invalidate caches after successful update
      await this.invalidateAllInboxCaches()

      return result
    } catch (error) {
      logger.error('Error updating inbox', {
        error,
        inboxId,
        organizationId: this.organizationId,
        data,
      })
      throw error
    }
  }

  /**
   * Delete an inbox
   * @param inboxId The inbox ID
   * @returns True if successful, throws an error otherwise
   */
  async deleteInbox(inboxId: string): Promise<boolean> {
    try {
      logger.info('Deleting inbox', { inboxId, organizationId: this.organizationId })

      await db.transaction(async (tx) => {
        // Delete all related records in correct order
        await tx
          .delete(schema.InboxMemberAccess)
          .where(eq(schema.InboxMemberAccess.inboxId, inboxId))

        // Delete ResourceAccess records for this inbox
        await tx
          .delete(schema.ResourceAccess)
          .where(
            and(
              eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.inbox),
              eq(schema.ResourceAccess.entityInstanceId, inboxId)
            )
          )

        await tx.delete(schema.InboxIntegration).where(eq(schema.InboxIntegration.inboxId, inboxId))

        // Finally delete the inbox itself
        await tx
          .delete(schema.Inbox)
          .where(
            and(eq(schema.Inbox.id, inboxId), eq(schema.Inbox.organizationId, this.organizationId))
          )
      })

      // Invalidate caches after successful deletion
      await this.invalidateAllInboxCaches()

      return true
    } catch (error) {
      logger.error('Error deleting inbox', { error, inboxId, organizationId: this.organizationId })
      throw error
    }
  }

  /**
   * Add an integration to an inbox
   * @param inboxId The inbox ID
   * @param integrationId The integration ID
   * @param isDefault Whether this is the default integration
   * @param settings Integration-specific settings
   * @returns The created inbox integration
   */
  async addIntegration(
    inboxId: string,
    integrationId: string,
    isDefault: boolean = false,
    settings?: Record<string, any>
  ): Promise<InboxIntegration | undefined> {
    try {
      logger.info('Adding integration to inbox', { inboxId, integrationId, isDefault })

      const result = await db.transaction(async (tx) => {
        // Check if the integration is already assigned to another inbox
        const existingAssignment = await tx.query.InboxIntegration.findFirst({
          where: eq(schema.InboxIntegration.integrationId, integrationId),
          columns: { id: true },
        })

        if (existingAssignment) {
          // throw new Error(
          //   `Integration ${integrationId} is already assigned to inbox ${existingAssignment.inboxId}`
          // )
        }

        // Check if the integration belongs to the same organization as the service
        const integration = await tx.query.Integration.findFirst({
          where: and(
            eq(schema.Integration.id, integrationId),
            eq(schema.Integration.organizationId, this.organizationId)
          ),
        })

        if (!integration) {
          throw new Error(
            `Integration ${integrationId} not found or not associated with this organization`
          )
        }

        // If this is the default integration, ensure no other integration is default
        if (isDefault) {
          await tx
            .update(schema.InboxIntegration)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.InboxIntegration.inboxId, inboxId),
                eq(schema.InboxIntegration.isDefault, true)
              )
            )
        }

        if (existingAssignment) {
          // If the integration already exists, update it
          const [updated] = await tx
            .update(schema.InboxIntegration)
            .set({ isDefault, inboxId, settings: settings || {}, updatedAt: new Date() })
            .where(eq(schema.InboxIntegration.id, existingAssignment.id))
            .returning()

          return updated
        } else {
          const [created] = await tx
            .insert(schema.InboxIntegration)
            .values({
              inboxId,
              integrationId,
              isDefault,
              settings: settings || {},
              updatedAt: new Date(),
            })
            .returning()

          return created
        }
      })

      // Invalidate caches after successful integration
      await this.invalidateAllInboxCaches()

      return result
    } catch (error) {
      logger.error('Error adding integration to inbox', { error, inboxId, integrationId })
      throw error
    }
  }

  /**
   * Remove an integration from an inbox
   * @param inboxId The inbox ID
   * @param integrationId The integration ID
   * @returns True if successful, throws an error otherwise
   */
  async removeIntegration(inboxId: string, integrationId: string): Promise<boolean> {
    try {
      logger.info('Removing integration from inbox', { inboxId, integrationId })

      await db
        .delete(schema.InboxIntegration)
        .where(
          and(
            eq(schema.InboxIntegration.inboxId, inboxId),
            eq(schema.InboxIntegration.integrationId, integrationId)
          )
        )

      // Invalidate caches after successful removal
      await this.invalidateAllInboxCaches()

      return true
    } catch (error) {
      logger.error('Error removing integration from inbox', { error, inboxId, integrationId })
      throw error
    }
  }

  /**
   * Update inbox access settings
   * @param inboxId The inbox ID
   * @param accessData Access configuration data
   * @returns The updated inbox with its relations
   */
  async updateInboxAccess(
    inboxId: string,
    accessData: InboxAccessInput
  ): Promise<InboxWithRelations> {
    try {
      logger.info('Updating inbox access', {
        inboxId,
        organizationId: this.organizationId,
        accessData,
      })

      const result = await db.transaction(async (tx) => {
        // Update inbox access fields directly
        await tx
          .update(schema.Inbox)
          .set({
            allowAllMembers: accessData.allowAllMembers ?? true,
            enableMemberAccess: !!accessData.memberIds?.length,
            enableGroupAccess: !!accessData.groupIds?.length,
            updatedAt: new Date(),
          })
          .where(
            and(eq(schema.Inbox.id, inboxId), eq(schema.Inbox.organizationId, this.organizationId))
          )

        // Update member access if provided
        if (accessData.memberIds !== undefined) {
          // First delete existing member access entries
          await tx
            .delete(schema.InboxMemberAccess)
            .where(eq(schema.InboxMemberAccess.inboxId, inboxId))

          // Then create new member access entries
          if (accessData.memberIds.length > 0) {
            await tx.insert(schema.InboxMemberAccess).values(
              accessData.memberIds.map((memberId) => ({
                inboxId,
                organizationMemberId: memberId,
                updatedAt: new Date(),
              }))
            )
          }
        }

        // Update group access if provided using ResourceAccess
        if (accessData.groupIds !== undefined) {
          await setInstanceAccess(
            { db: tx, organizationId: this.organizationId },
            toRecordId(BuiltInEntityType.inbox, inboxId),
            ResourceGranteeType.group,
            accessData.groupIds.map((gid) => ({ granteeId: gid, permission: ResourcePermission.view }))
          )
        }

        // Return the updated inbox with all its relations
        const updatedInbox = await tx.query.Inbox.findFirst({
          where: eq(schema.Inbox.id, inboxId),
          with: DefaultInboxWith,
        })

        if (!updatedInbox) {
          throw new Error('Inbox not found after update')
        }

        return updatedInbox
      })

      // Invalidate caches after successful access update
      await this.invalidateAllInboxCaches()

      return result
    } catch (error) {
      logger.error('Error updating inbox access', {
        error,
        inboxId,
        organizationId: this.organizationId,
        accessData,
      })
      throw error
    }
  }

  /**
   * Check if a user has access to an inbox
   * @param inboxId The inbox ID
   * @param userId The user ID
   * @returns Boolean indicating if the user has access
   */
  async hasUserAccess(inboxId: string, userId: string): Promise<boolean> {
    try {
      // Check cache first
      const cacheKey = `inbox:access:${inboxId}:user:${userId}`
      const cachedAccess = await this.getFromCache<boolean>(cacheKey)

      if (cachedAccess !== null) {
        return cachedAccess
      }

      // Get the inbox with direct access fields
      const inbox = await db.query.Inbox.findFirst({
        where: eq(schema.Inbox.id, inboxId),
      })

      if (!inbox || inbox.organizationId !== this.organizationId) {
        await this.setInCache(cacheKey, false)
        return false
      }

      // If all members are allowed, user has access
      if (inbox.allowAllMembers) {
        await this.setInCache(cacheKey, true)
        return true
      }

      // Get user's organization membership
      const orgMember = await db.query.OrganizationMember.findFirst({
        where: and(
          eq(schema.OrganizationMember.organizationId, this.organizationId),
          eq(schema.OrganizationMember.userId, userId)
        ),
      })

      if (!orgMember) {
        await this.setInCache(cacheKey, false)
        return false
      }

      // Check direct member access
      if (inbox.enableMemberAccess) {
        const memberAccess = await db.query.InboxMemberAccess.findFirst({
          where: and(
            eq(schema.InboxMemberAccess.inboxId, inboxId),
            eq(schema.InboxMemberAccess.organizationMemberId, orgMember.id)
          ),
        })

        if (memberAccess) {
          await this.setInCache(cacheKey, true)
          return true
        }
      }

      // Check group-based access via ResourceAccess
      if (inbox.enableGroupAccess) {
        // Get all groups with access to this inbox via ResourceAccess
        const accessRecords = await getInstanceAccess(
          { db, organizationId: this.organizationId },
          toRecordId(BuiltInEntityType.inbox, inboxId)
        )
        const groupIds = accessRecords
          .filter((a) => a.granteeType === ResourceGranteeType.group)
          .map((a) => a.granteeId)

        if (groupIds.length) {
          // Check if user is a member of any of these groups (via EntityGroupMember)
          const userInGroup = await db.query.EntityGroupMember.findFirst({
            where: and(
              eq(schema.EntityGroupMember.memberType, MemberType.user),
              eq(schema.EntityGroupMember.memberRefId, userId),
              inArray(schema.EntityGroupMember.groupInstanceId, groupIds)
            ),
          })

          if (userInGroup) {
            await this.setInCache(cacheKey, true)
            return true
          }
        }
      }

      await this.setInCache(cacheKey, false)
      return false
    } catch (error) {
      logger.error('Error checking user access to inbox', { error, inboxId, userId })
      return false
    }
  }

  /**
   * Get all inboxes a user has access to
   * @param userId The user ID
   * @returns Array of inboxes the user has access to
   */
  async getInboxesForUser(userId: string): Promise<InboxWithRelations[]> {
    try {
      const cacheKey = this.getUserInboxesCacheKey(userId)

      // Try to get from cache first
      const cachedInboxes = await this.getFromCache<InboxWithRelations[]>(cacheKey)
      if (cachedInboxes) {
        logger.info('Retrieved user inboxes from cache', { userId })
        return cachedInboxes
      }

      logger.info('Getting inboxes for user from database', {
        userId,
        organizationId: this.organizationId,
      })

      // Get user's organization member record
      const [orgMember] = await db
        .select({ id: schema.OrganizationMember.id })
        .from(schema.OrganizationMember)
        .where(
          and(
            eq(schema.OrganizationMember.organizationId, this.organizationId),
            eq(schema.OrganizationMember.userId, userId)
          )
        )
        .limit(1)

      if (!orgMember) return []

      // Get user's group IDs (from EntityGroupMember)
      const userGroups = await db
        .select({ groupId: schema.EntityGroupMember.groupInstanceId })
        .from(schema.EntityGroupMember)
        .innerJoin(schema.EntityInstance, eq(schema.EntityGroupMember.groupInstanceId, schema.EntityInstance.id))
        .where(
          and(
            eq(schema.EntityGroupMember.memberType, MemberType.user),
            eq(schema.EntityGroupMember.memberRefId, userId),
            eq(schema.EntityInstance.organizationId, this.organizationId)
          )
        )

      const userGroupIds = userGroups.map((g) => g.groupId)

      // Get all inboxes where user has access
      // 1. All members allowed
      const allMemberInboxes = await db
        .select()
        .from(schema.Inbox)
        .where(
          and(
            eq(schema.Inbox.organizationId, this.organizationId),
            eq(schema.Inbox.allowAllMembers, true)
          )
        )

      // 2. Specific member access
      const memberAccessInboxes = await db
        .select()
        .from(schema.Inbox)
        .innerJoin(schema.InboxMemberAccess, eq(schema.Inbox.id, schema.InboxMemberAccess.inboxId))
        .where(
          and(
            eq(schema.Inbox.organizationId, this.organizationId),
            eq(schema.Inbox.enableMemberAccess, true),
            eq(schema.InboxMemberAccess.organizationMemberId, orgMember.id)
          )
        )
        .then((rows) => rows.map((row) => row.Inbox))

      // 3. Group access via ResourceAccess (if user has groups)
      let groupAccessInboxes: any[] = []
      if (userGroupIds.length > 0) {
        // Get all inbox access records for user's groups from ResourceAccess
        const groupAccessRecords = await db
          .select({ entityInstanceId: schema.ResourceAccess.entityInstanceId })
          .from(schema.ResourceAccess)
          .where(
            and(
              eq(schema.ResourceAccess.organizationId, this.organizationId),
              eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.inbox),
              eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
              inArray(schema.ResourceAccess.granteeId, userGroupIds)
            )
          )

        const inboxIdsWithGroupAccess = groupAccessRecords.map((r) => r.entityInstanceId)

        if (inboxIdsWithGroupAccess.length > 0) {
          groupAccessInboxes = await db
            .select()
            .from(schema.Inbox)
            .where(
              and(
                eq(schema.Inbox.organizationId, this.organizationId),
                eq(schema.Inbox.enableGroupAccess, true),
                inArray(schema.Inbox.id, inboxIdsWithGroupAccess)
              )
            )
        }
      }

      // Combine and deduplicate inboxes
      const allInboxes = [...allMemberInboxes, ...memberAccessInboxes, ...groupAccessInboxes]
      const uniqueInboxes = allInboxes.filter(
        (inbox, index, arr) => arr.findIndex((i) => i.id === inbox.id) === index
      )

      // Store in cache for future requests
      await this.setInCache(cacheKey, uniqueInboxes)

      return uniqueInboxes
    } catch (error) {
      logger.error('Error getting inboxes for user', {
        error,
        userId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Get inboxes with detailed group information for a user
   * @param userId The user ID
   * @returns Array of inboxes with detailed group info
   */
  async getInboxesWithGroupDetails(userId: string) {
    try {
      const inboxes = await this.getInboxesForUser(userId)

      // Get detailed group information (from EntityGroupMember)
      const userGroups = await db.query.EntityGroupMember.findMany({
        where: and(
          eq(schema.EntityGroupMember.memberType, MemberType.user),
          eq(schema.EntityGroupMember.memberRefId, userId)
        ),
        with: {
          groupInstance: true,
        },
      })

      // Filter out groups that don't belong to this organization
      const filteredUserGroups = userGroups.filter(
        (membership) => membership.groupInstance.organizationId === this.organizationId
      )

      const userGroupIds = filteredUserGroups.map((m) => m.groupInstanceId)

      // Get all inbox access records from ResourceAccess for this organization
      const inboxAccessRecords = await db
        .select({
          inboxId: schema.ResourceAccess.entityInstanceId,
          groupId: schema.ResourceAccess.granteeId,
        })
        .from(schema.ResourceAccess)
        .where(
          and(
            eq(schema.ResourceAccess.organizationId, this.organizationId),
            eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.inbox),
            eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
            inArray(schema.ResourceAccess.granteeId, userGroupIds.length > 0 ? userGroupIds : [''])
          )
        )

      // Enhance inbox objects with detailed group information
      return inboxes.map((inbox) => {
        // Find which groups gave access to this inbox
        const inboxGroupIds = inboxAccessRecords
          .filter((r) => r.inboxId === inbox.id)
          .map((r) => r.groupId)

        const accessGroups = filteredUserGroups
          .filter((membership) => inboxGroupIds.includes(membership.groupInstanceId))
          .map((g) => g.groupInstance)

        return { ...inbox, accessGroups }
      })
    } catch (error) {
      logger.error('Error getting inboxes with group details', {
        error,
        userId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  async addIntegrationToDefaultInbox(integrationId: string) {
    let defaultInbox = await db.query.Inbox.findFirst({
      where: eq(schema.Inbox.organizationId, this.organizationId),
      columns: { id: true },
    })

    if (!defaultInbox) {
      defaultInbox = await this.createInbox({
        name: 'Default Inbox',
        description: 'Default inbox for all incoming emails',
        color: '#A7C1F2', // Light Blue
        status: InboxStatus.ACTIVE,
      })
    }

    if (!defaultInbox) {
      throw new Error('Failed to create or retrieve default inbox')
    }

    try {
      const connection = await this.addIntegration(defaultInbox.id, integrationId, true)
      return connection
    } catch (error) {
      logger.error('Error adding integration to default inbox', {
        error,
        integrationId,
        inboxId: defaultInbox.id,
      })
      throw error
    }
  }
}
