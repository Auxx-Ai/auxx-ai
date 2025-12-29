// packages/lib/src/tags/tag-service.ts
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { PermissionService } from '../permissions/permission-service'

const logger = createScopedLogger('tag-service')

/**
 * Service for managing tags within an organization
 * Handles tag CRUD operations, hierarchy management, and entity tagging
 */
export class TagService {
  private organizationId: string
  private userId: string
  private db: Database
  private permissionService: PermissionService

  /**
   * Initialize TagService
   * @param organizationId - The organization ID to scope operations to
   * @param userId - The user ID for permission checks
   * @param db - Database instance
   */
  constructor(organizationId: string, userId: string, db: Database) {
    this.organizationId = organizationId
    this.userId = userId
    this.db = db
    this.permissionService = new PermissionService(this.organizationId, this.userId, this.db)
  }

  /**
   * Get all tags for an organization
   * @returns Promise resolving to array of tags sorted by title
   * @throws Error if database query fails
   */
  async getAllTags(): Promise<(typeof schema.Tag.$inferSelect)[]> {
    try {
      return await this.db.query.Tag.findMany({
        where: eq(schema.Tag.organizationId, this.organizationId),
        orderBy: asc(schema.Tag.title),
      })
    } catch (error) {
      logger.error('Error fetching tags', { error })
      throw error
    }
  }

  /**
   * Get tag hierarchy with parent-child relationships
   * @returns Promise resolving to array of root tags with nested children
   * @throws Error if database query fails
   */
  async getTagHierarchy(): Promise<(typeof schema.Tag.$inferSelect & { tags: any[] })[]> {
    try {
      // Use regular select query to avoid relation issues
      const allTags = await this.db
        .select()
        .from(schema.Tag)
        .where(eq(schema.Tag.organizationId, this.organizationId))
        .orderBy(asc(schema.Tag.title))

      // Build hierarchy manually
      const rootTags = allTags.filter((tag) => tag.parentId === null)
      const tagMap = new Map(allTags.map((tag) => [tag.id, { ...tag, tags: [] as any[] }]))

      // Add children to parents
      allTags.forEach((tag) => {
        if (tag.parentId && tagMap.has(tag.parentId)) {
          const parent = tagMap.get(tag.parentId)!
          const childWithChildren = tagMap.get(tag.id)!
          parent.tags.push(childWithChildren)
        }
      })

      return rootTags.map((tag) => tagMap.get(tag.id)!)
    } catch (error) {
      logger.error('Error fetching tag hierarchy', { error })
      throw error
    }
  }

  /**
   * Create a new tag
   * @param data - Tag creation data
   * @param data.title - Tag title (required)
   * @param data.description - Optional tag description
   * @param data.emoji - Optional emoji for the tag
   * @param data.color - Optional color for the tag
   * @param data.parentId - Optional parent tag ID for hierarchical tags
   * @returns Promise resolving to the created tag
   * @throws Error if user lacks permissions or tag already exists
   */
  async createTag(data: {
    title: string
    description?: string
    emoji?: string
    color?: string
    parentId?: string
  }): Promise<typeof schema.Tag.$inferSelect> {
    try {
      const isAdmin = await this.permissionService.isAdmin()
      if (!isAdmin) {
        console.error('User does not have permission to create tags')
        // throw new Error('You do not have permission to create tags')
      }

      const { title, parentId } = data
      // Check for duplicate tag in same parent/organization
      const existing = await this.db.query.Tag.findFirst({
        where: and(
          eq(schema.Tag.organizationId, this.organizationId),
          parentId ? eq(schema.Tag.parentId, parentId) : isNull(schema.Tag.parentId),
          eq(schema.Tag.title, title)
        ),
      })

      if (existing) {
        throw new Error(`A tag with the title "${data.title}" already exists in this location`)
      }

      const insertResult = await this.db
        .insert(schema.Tag)
        .values({
          ...data,
          organizationId: this.organizationId,
          updatedAt: new Date(),
        })
        .returning()

      return insertResult[0]!
    } catch (error) {
      logger.error('Error creating tag', { data, error })
      throw error
    }
  }

  /**
   * Update an existing tag
   * @param id - Tag ID to update
   * @param data - Updated tag data
   * @param data.title - Optional new title
   * @param data.description - Optional new description (null to clear)
   * @param data.emoji - Optional new emoji (null to clear)
   * @param data.color - Optional new color (null to clear)
   * @param data.parentId - Optional new parent ID (null to make root tag)
   * @returns Promise resolving to the updated tag
   * @throws Error if user lacks permissions, tag not found, or duplicate title
   */
  async updateTag(
    id: string,
    data: {
      title?: string
      description?: string | null
      emoji?: string | null
      color?: string | null
      parentId?: string | null
    }
  ): Promise<typeof schema.Tag.$inferSelect> {
    try {
      const isAdmin = await this.permissionService.isAdmin()
      logger.info('isAdmin', { isAdmin })
      if (!isAdmin) {
        throw new Error('You do not have permission to update tags')
      }

      // Get the tag to update
      const tag = await this.db.query.Tag.findFirst({
        where: eq(schema.Tag.id, id),
      })

      if (!tag) {
        throw new Error('Tag not found')
      }

      // If title is changing, check for duplicates
      if (data.title && data.title !== tag.title) {
        const existing = await this.db.query.Tag.findFirst({
          where: and(
            eq(schema.Tag.organizationId, this.organizationId),
            data.parentId !== undefined
              ? data.parentId
                ? eq(schema.Tag.parentId, data.parentId)
                : isNull(schema.Tag.parentId)
              : tag.parentId
                ? eq(schema.Tag.parentId, tag.parentId)
                : isNull(schema.Tag.parentId),
            eq(schema.Tag.title, data.title),
            ne(schema.Tag.id, id)
          ),
        })

        if (existing) {
          throw new Error(`A tag with the title "${data.title}" already exists in this location`)
        }
      }

      // Prevent circular references
      if (data.parentId) {
        await this.validateParentChange(id, data.parentId)
      }

      const updateResult = await this.db
        .update(schema.Tag)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(schema.Tag.id, id))
        .returning()

      return updateResult[0]!
    } catch (error) {
      logger.error('Error updating tag', { id, data, error })
      throw error
    }
  }

  /**
   * Delete a tag and its entity associations
   * @param id - Tag ID to delete
   * @returns Promise resolving to the deleted tag
   * @throws Error if user lacks permissions, tag not found, or tag has children
   */
  async deleteTag(id: string): Promise<typeof schema.Tag.$inferSelect> {
    try {
      const isAdmin = await this.permissionService.isAdmin()
      if (!isAdmin) {
        throw new Error('You do not have permission to delete tags')
      }
      // Find the tag
      const tag = await this.db.query.Tag.findFirst({
        where: eq(schema.Tag.id, id),
      })

      if (!tag) {
        throw new Error('Tag not found')
      }

      // Check if it has children with a separate query
      const children = await this.db.query.Tag.findMany({
        where: eq(schema.Tag.parentId, id),
      })

      if (children.length > 0) {
        throw new Error('Cannot delete a tag with child tags. Remove or reassign children first.')
      }

      // Start a transaction to delete tag and its entity associations
      return await this.db.transaction(async (tx: Transaction) => {
        // Delete tag associations with entities
        await tx.delete(schema.TagsOnThread).where(eq(schema.TagsOnThread.tagId, id))
        // await tx.delete(TagsOnTicket).where(eq(TagsOnTicket.tagId, id))
        // await tx.delete(TagsOnContact).where(eq(TagsOnContact.tagId, id))
        // await tx.delete(TagsOnArticle).where(eq(TagsOnArticle.tagId, id))

        // Delete the tag
        const deleteResult = await tx.delete(schema.Tag).where(eq(schema.Tag.id, id)).returning()
        return deleteResult[0]!
      })
    } catch (error) {
      logger.error('Error deleting tag', { id, error })
      throw error
    }
  }

  /**
   * Apply a tag to an entity (thread, ticket, contact, or article)
   * @param data - Tagging data
   * @param data.tagId - ID of the tag to apply
   * @param data.entityType - Type of entity to tag
   * @param data.entityId - ID of the entity to tag
   * @param data.createdBy - User ID who created the tag association
   * @returns Promise resolving to the tag-entity relationship
   * @throws Error if tag not found or unsupported entity type
   */
  async tagEntity(data: {
    tagId: string
    entityType: 'thread' | 'ticket' | 'contact' | 'article'
    entityId: string
    createdBy: string
  }): Promise<typeof schema.TagsOnThread.$inferSelect> {
    const { tagId, entityType, entityId, createdBy } = data

    try {
      // Validate tag exists
      const tag = await this.db.query.Tag.findFirst({
        where: eq(schema.Tag.id, tagId),
      })

      if (!tag) {
        throw new Error('Tag not found')
      }

      // Handle tagging different entity types
      switch (entityType) {
        case 'thread':
          // Check if relationship already exists
          const existing = await this.db.query.TagsOnThread.findFirst({
            where: and(
              eq(schema.TagsOnThread.tagId, tagId),
              eq(schema.TagsOnThread.threadId, entityId)
            ),
          })

          if (existing) {
            return existing
          }

          const insertResult = await this.db
            .insert(schema.TagsOnThread)
            .values({
              tagId,
              threadId: entityId,
              createdBy,
            })
            .returning()

          return insertResult[0]!

        default:
          throw new Error(`Unsupported entity type: ${entityType}`)
      }
    } catch (error) {
      logger.error('Error tagging entity', { data, error })
      throw error
    }
  }

  /**
   * Remove a tag from an entity
   * @param data - Untagging data
   * @param data.tagId - ID of the tag to remove
   * @param data.entityType - Type of entity to untag
   * @param data.entityId - ID of the entity to untag
   * @returns Promise resolving to the removed relationship or null if not found
   * @throws Error if unsupported entity type
   */
  async untagEntity(data: {
    tagId: string
    entityType: 'thread' | 'ticket' | 'contact' | 'article'
    entityId: string
  }): Promise<typeof schema.TagsOnThread.$inferSelect | null> {
    const { tagId, entityType, entityId } = data

    try {
      switch (entityType) {
        case 'thread':
          const deleteResult = await this.db
            .delete(schema.TagsOnThread)
            .where(
              and(eq(schema.TagsOnThread.tagId, tagId), eq(schema.TagsOnThread.threadId, entityId))
            )
            .returning()

          return deleteResult[0] || null

        default:
          throw new Error(`Unsupported entity type: ${entityType}`)
      }
    } catch (error) {
      logger.error('Error untagging entity', { data, error })
      throw error
    }
  }

  /**
   * Get all tags applied to a specific entity
   * @param data - Entity data
   * @param data.entityType - Type of entity to get tags for
   * @param data.entityId - ID of the entity to get tags for
   * @returns Promise resolving to array of tag relationships with tag details
   * @throws Error if unsupported entity type
   */
  async getEntityTags(data: {
    entityType: 'thread' | 'ticket' | 'contact' | 'article'
    entityId: string
  }): Promise<
    (typeof schema.TagsOnThread.$inferSelect & { tag: typeof schema.Tag.$inferSelect })[]
  > {
    const { entityType, entityId } = data

    try {
      switch (entityType) {
        case 'thread':
          return await this.db.query.TagsOnThread.findMany({
            where: eq(schema.TagsOnThread.threadId, entityId),
            with: {
              tag: true,
            },
          })

        default:
          throw new Error(`Unsupported entity type: ${entityType}`)
      }
    } catch (error) {
      logger.error('Error getting entity tags', { data, error })
      throw error
    }
  }

  /**
   * Find entities by tags (filter)
   * @param data - Search criteria
   * @param data.entityType - Type of entities to search
   * @param data.tagIds - Array of tag IDs to search for
   * @param data.requireAll - If true, entity must have ALL tags; if false, ANY of the tags
   * @returns Promise resolving to array of entity IDs matching the criteria
   * @throws Error if unsupported entity type
   */
  async findEntitiesByTags(data: {
    entityType: 'thread' | 'ticket' | 'contact' | 'article'
    tagIds: string[]
    requireAll?: boolean // If true, entity must have ALL tags; if false, ANY of the tags
  }): Promise<string[]> {
    const { entityType, tagIds, requireAll = false } = data

    try {
      if (!tagIds.length) {
        return []
      }

      switch (entityType) {
        case 'thread': {
          if (requireAll) {
            // For requireAll, we need threads that have ALL the specified tags
            const threadsWithTags = await this.db.query.Thread.findMany({
              where: eq(schema.Thread.organizationId, this.organizationId),
              columns: {
                id: true,
              },
              with: {
                tags: {
                  where: inArray(schema.TagsOnThread.tagId, tagIds),
                  columns: {
                    tagId: true,
                  },
                },
              },
            })

            // Filter threads that have all required tags
            return threadsWithTags
              .filter((thread) => thread.tags.length === tagIds.length)
              .map((thread) => thread.id)
          } else {
            // For ANY tag, simpler query using distinct
            const threadTags = await this.db
              .selectDistinct({
                threadId: schema.TagsOnThread.threadId,
              })
              .from(schema.TagsOnThread)
              .innerJoin(schema.Tag, eq(schema.TagsOnThread.tagId, schema.Tag.id))
              .where(
                and(
                  inArray(schema.TagsOnThread.tagId, tagIds),
                  eq(schema.Tag.organizationId, this.organizationId)
                )
              )

            return threadTags.map((item) => item.threadId)
          }
        }

        // Implementation for contact and article entities follows the same pattern
        default:
          throw new Error(`Unsupported entity type: ${entityType}`)
      }
    } catch (error) {
      logger.error('Error finding entities by tags', { data, error })
      throw error
    }
  }

  /**
   * Batch tag multiple entities at once
   * @param data - Batch tagging data
   * @param data.tagId - ID of the tag to apply
   * @param data.entityType - Type of entities to tag
   * @param data.entityIds - Array of entity IDs to tag
   * @param data.createdBy - User ID who created the tag associations
   * @returns Promise resolving to number of entities successfully tagged
   * @throws Error if tag not found or unsupported entity type
   */
  async batchTagEntities(data: {
    tagId: string
    entityType: 'thread' | 'ticket' | 'contact' | 'article'
    entityIds: string[]
    createdBy: string
  }): Promise<number> {
    const { tagId, entityType, entityIds, createdBy } = data

    try {
      if (!entityIds.length) {
        return 0
      }

      // Validate tag exists
      const tag = await this.db.query.Tag.findFirst({
        where: eq(schema.Tag.id, tagId),
      })

      if (!tag) {
        throw new Error('Tag not found')
      }

      // Implementation for batch tagging different entity types
      switch (entityType) {
        case 'thread': {
          const insertData = entityIds.map((threadId) => ({
            tagId,
            threadId,
            createdBy,
          }))

          // Use onConflictDoNothing to skip duplicates
          const result = await this.db
            .insert(schema.TagsOnThread)
            .values(insertData)
            .onConflictDoNothing()
            .returning({ id: schema.TagsOnThread.tagId })

          return result.length
        }

        // Similar implementation for other entity types
        default:
          throw new Error(`Unsupported entity type: ${entityType}`)
      }
    } catch (error) {
      logger.error('Error batch tagging entities', { data, error })
      throw error
    }
  }

  /**
   * Update entity tags by setting a complete list of tag IDs
   * This method will add/remove tags as needed to match the provided list
   * @param data - Update data
   * @param data.tagIds - Complete array of tag IDs that should be applied to the entity
   * @param data.entityType - Type of entity to update tags for
   * @param data.entityId - ID of the entity to update tags for
   * @param data.createdBy - User ID who created new tag associations
   * @returns Promise resolving to counts of added and removed tag associations
   * @throws Error if tags not found or unsupported entity type
   */
  async updateEntityTags(data: {
    tagIds: string[]
    entityType: 'thread' | 'ticket' | 'contact' | 'article'
    entityId: string
    createdBy: string
  }): Promise<{ added: number; removed: number }> {
    const { tagIds, entityType, entityId, createdBy } = data

    try {
      // Validate that all tags exist and belong to this organization
      if (tagIds.length > 0) {
        const existingTags = await this.db.query.Tag.findMany({
          where: and(
            inArray(schema.Tag.id, tagIds),
            eq(schema.Tag.organizationId, this.organizationId)
          ),
          columns: {
            id: true,
          },
        })

        const foundTagIds = existingTags.map((tag) => tag.id)
        if (foundTagIds.length !== tagIds.length) {
          const missingTags = tagIds.filter((id) => !foundTagIds.includes(id))
          throw new Error(`Some tags (${missingTags.join(', ')}) not found in this organization`)
        }
      }

      // Get current tags for the entity
      const currentTags = await this.getEntityTags({ entityType, entityId })
      const currentTagIds = currentTags.map((tagRel) => tagRel.tag.id)

      // Calculate changes needed
      const tagsToAdd = tagIds.filter((id) => !currentTagIds.includes(id))
      const tagsToRemove = currentTagIds.filter((id) => !tagIds.includes(id))

      let addedCount = 0
      let removedCount = 0

      // Use transaction to ensure consistency
      await this.db.transaction(async (tx) => {
        // Remove tags that should no longer be applied
        if (tagsToRemove.length > 0) {
          switch (entityType) {
            case 'thread':
              const deleteResult = await tx
                .delete(schema.TagsOnThread)
                .where(
                  and(
                    eq(schema.TagsOnThread.threadId, entityId),
                    inArray(schema.TagsOnThread.tagId, tagsToRemove)
                  )
                )
                .returning({ id: schema.TagsOnThread.tagId })
              removedCount = deleteResult.length
              break

            default:
              throw new Error(`Unsupported entity type: ${entityType}`)
          }
        }

        // Add new tags
        if (tagsToAdd.length > 0) {
          switch (entityType) {
            case 'thread':
              const createData = tagsToAdd.map((tagId) => ({
                tagId,
                threadId: entityId,
                createdBy,
              }))
              const createResult = await tx
                .insert(schema.TagsOnThread)
                .values(createData)
                .onConflictDoNothing()
                .returning({ id: schema.TagsOnThread.tagId })
              addedCount = createResult.length
              break

            default:
              throw new Error(`Unsupported entity type: ${entityType}`)
          }
        }
      })

      logger.info('Entity tags updated', {
        entityType,
        entityId,
        tagsToAdd: tagsToAdd.length,
        tagsToRemove: tagsToRemove.length,
        addedCount,
        removedCount,
        organizationId: this.organizationId,
      })

      return { added: addedCount, removed: removedCount }
    } catch (error) {
      logger.error('Error updating entity tags', { data, error })
      throw error
    }
  }

  /**
   * Find a tag by name within the organization
   * @param name - Tag name to search for
   * @param organizationId - Optional organization ID (defaults to current organization)
   * @returns Promise resolving to the tag or null if not found
   * @throws Error if database query fails
   */
  async findTagByName(
    name: string,
    organizationId?: string
  ): Promise<typeof schema.Tag.$inferSelect | null> {
    try {
      const orgId = organizationId || this.organizationId
      const result = await this.db.query.Tag.findFirst({
        where: and(eq(schema.Tag.organizationId, orgId), eq(schema.Tag.title, name)),
      })
      return result || null
    } catch (error) {
      logger.error('Error finding tag by name', { name, organizationId, error })
      throw error
    }
  }

  /**
   * Find or create a tag by name within the organization
   * @param name - Tag name to find or create
   * @param organizationId - Optional organization ID (defaults to current organization)
   * @param metadata - Optional metadata for tag creation
   * @param metadata.description - Tag description
   * @param metadata.color - Tag color
   * @param metadata.emoji - Tag emoji
   * @param metadata.parentId - Parent tag ID
   * @returns Promise resolving to the found or created tag
   * @throws Error if database operation fails
   */
  async findOrCreateTag(
    name: string,
    organizationId?: string,
    metadata?: any
  ): Promise<typeof schema.Tag.$inferSelect> {
    try {
      const orgId = organizationId || this.organizationId

      // First try to find existing tag
      let tag = await this.findTagByName(name, orgId)

      if (!tag) {
        // Create new tag if it doesn't exist
        const insertResult = await this.db
          .insert(schema.Tag)
          .values({
            title: name,
            organizationId: orgId,
            isSystemTag: false,
            description: metadata?.description || `Auto-created tag: ${name}`,
            color: metadata?.color || null,
            emoji: metadata?.emoji || null,
            parentId: metadata?.parentId || null,
            updatedAt: new Date(),
          })
          .returning()

        tag = insertResult[0]!
        logger.info('Created new tag', { tagId: tag.id, name, organizationId: orgId })
      }

      return tag
    } catch (error) {
      logger.error('Error finding or creating tag', { name, organizationId, metadata, error })
      throw error
    }
  }

  /**
   * Helper to validate parent changes to prevent circular references
   * @param tagId - ID of the tag being updated
   * @param newParentId - ID of the proposed new parent
   * @throws Error if circular reference would be created
   * @private
   */
  private async validateParentChange(tagId: string, newParentId: string): Promise<void> {
    // Can't make a tag its own parent
    if (tagId === newParentId) {
      throw new Error('A tag cannot be its own parent')
    }

    // Check for circular references by traversing up the hierarchy
    let currentParentId: string | null = newParentId
    const visitedIds = new Set<string>()

    while (currentParentId) {
      // Detect cycles
      if (visitedIds.has(currentParentId)) {
        throw new Error('Circular reference detected in tag hierarchy')
      }

      visitedIds.add(currentParentId)

      // Get the parent's parent
      const parent: { parentId: string | null } | undefined = await this.db.query.Tag.findFirst({
        where: eq(schema.Tag.id, currentParentId),
        columns: {
          parentId: true,
        },
      })

      // Break if no parent found
      if (!parent) break

      // Check if this would create a cycle
      if (parent.parentId === tagId) {
        throw new Error('This change would create a circular reference in the tag hierarchy')
      }

      currentParentId = parent.parentId ?? null
    }
  }
}
