// packages/lib/src/tags/tag-service.ts
// Service for managing tags within an organization.
// Uses UnifiedCrudHandler internally for all CRUD operations.
// Tag-to-entity relationships (e.g., thread tags) are managed via FieldValue RELATIONSHIP fields.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { UnifiedCrudHandler, listAll } from '../resources/crud'
import { toRecordId, parseRecordId, type RecordId } from '../resources/resource-id'

const logger = createScopedLogger('tag-service')

/** Tag data returned from the service */
export interface TagData {
  recordId: RecordId
  id: string
  title: string
  tag_description: string | null
  tag_emoji: string | null
  tag_color: string
  parentId: string | null
  parentRecordId: RecordId | null
  isSystemTag: boolean
  createdAt: Date
  updatedAt: Date
}

/** Tag with children for hierarchy */
export interface TagWithChildren extends TagData {
  children: TagWithChildren[]
}

/** Input for creating a tag */
export interface CreateTagInput {
  title: string
  tag_description?: string
  tag_emoji?: string
  tag_color?: string
  parentId?: RecordId
}

/** Input for updating a tag */
export interface UpdateTagInput {
  title?: string
  tag_description?: string | null
  tag_emoji?: string | null
  tag_color?: string | null
  parentId?: RecordId | null
}

/**
 * Service for managing tags within an organization.
 * Uses UnifiedCrudHandler internally for CRUD operations.
 */
export class TagService {
  private organizationId: string
  private userId: string
  private db: Database
  private handler: UnifiedCrudHandler
  private tagEntityDefId: string | null = null

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
    this.handler = new UnifiedCrudHandler(organizationId, userId, db)
  }

  /**
   * Resolve and cache the tag entity definition ID
   */
  private async getTagEntityDefId(): Promise<string> {
    if (!this.tagEntityDefId) {
      const entityDef = await this.handler.resolveEntityDefinition('tag')
      this.tagEntityDefId = entityDef.id
    }
    return this.tagEntityDefId
  }

  /**
   * Build RecordId for a tag from instance ID
   */
  private async buildRecordId(instanceId: string): Promise<RecordId> {
    const entityDefId = await this.getTagEntityDefId()
    return toRecordId(entityDefId, instanceId)
  }

  /**
   * Parse parent RecordId from field value
   */
  private parseParentRecordId(parentValue: unknown): { parentId: string | null; parentRecordId: RecordId | null } {
    if (!parentValue) {
      return { parentId: null, parentRecordId: null }
    }

    // Parent can be stored as array of RecordIds or single RecordId
    const parentRecordIdStr = Array.isArray(parentValue) ? parentValue[0] : parentValue
    if (typeof parentRecordIdStr !== 'string' || !parentRecordIdStr.includes(':')) {
      return { parentId: null, parentRecordId: null }
    }

    const { entityInstanceId } = parseRecordId(parentRecordIdStr as RecordId)
    return {
      parentId: entityInstanceId,
      parentRecordId: parentRecordIdStr as RecordId
    }
  }

  /**
   * Transform listAll result item to TagData
   */
  private async transformToTagData(item: {
    id: string
    fieldValues: Record<string, unknown>
    displayName?: string | null
    createdAt: Date
    updatedAt: Date
  }): Promise<TagData> {
    const recordId = await this.buildRecordId(item.id)
    const { parentId, parentRecordId } = this.parseParentRecordId(item.fieldValues.tag_parent)

    return {
      recordId,
      id: item.id,
      title: (item.fieldValues.title as string) ?? item.displayName ?? '',
      tag_description: (item.fieldValues.tag_description as string) ?? null,
      tag_emoji: (item.fieldValues.tag_emoji as string) ?? null,
      tag_color: (item.fieldValues.tag_color as string) ?? '#94a3b8',
      parentId,
      parentRecordId,
      isSystemTag: (item.fieldValues.is_system_tag as boolean) ?? false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }

  /**
   * Get all tags for an organization
   * @returns Promise resolving to array of tags sorted by title
   */
  async getAllTags(): Promise<TagData[]> {
    try {
      const result = await listAll(
        { db: this.db, organizationId: this.organizationId, userId: this.userId },
        { entityDefinitionId: 'tag' }
      )

      return Promise.all(result.items.map((item) => this.transformToTagData(item)))
    } catch (error) {
      logger.error('Error fetching tags', { error })
      throw error
    }
  }

  /**
   * Get tag hierarchy with parent-child relationships
   * @returns Promise resolving to array of root tags with nested children
   */
  async getTagHierarchy(): Promise<TagWithChildren[]> {
    try {
      const result = await listAll(
        { db: this.db, organizationId: this.organizationId, userId: this.userId },
        { entityDefinitionId: 'tag' }
      )

      // Transform to flat tags with parentId
      const flatTags = await Promise.all(
        result.items.map(async (item) => ({
          ...(await this.transformToTagData(item)),
          children: [] as TagWithChildren[],
        }))
      )

      // Build hierarchy
      const tagMap = new Map(flatTags.map((t) => [t.id, t]))
      const rootTags: TagWithChildren[] = []

      for (const tag of flatTags) {
        if (tag.parentId && tagMap.has(tag.parentId)) {
          tagMap.get(tag.parentId)!.children.push(tag)
        } else {
          rootTags.push(tag)
        }
      }

      return rootTags
    } catch (error) {
      logger.error('Error fetching tag hierarchy', { error })
      throw error
    }
  }

  /**
   * Search tags by query string
   * @param query - Search query (case-insensitive)
   * @param limit - Maximum results to return
   * @returns Promise resolving to matching tags
   */
  async searchTags(query: string, limit: number = 10): Promise<{ recordId: RecordId; id: string; name: string }[]> {
    try {
      const allTags = await this.getAllTags()
      const lowerQuery = query.toLowerCase()

      return allTags
        .filter((tag) => tag.title.toLowerCase().includes(lowerQuery))
        .slice(0, limit)
        .map((tag) => ({ recordId: tag.recordId, id: tag.id, name: tag.title }))
    } catch (error) {
      logger.error('Error searching tags', { query, error })
      throw error
    }
  }

  /**
   * Create a new tag
   * @param data - Tag creation data
   * @returns Promise resolving to the created tag
   */
  async createTag(data: CreateTagInput): Promise<TagData> {
    try {
      const values: Record<string, unknown> = {
        title: data.title,
        tag_description: data.tag_description,
        tag_emoji: data.tag_emoji,
        tag_color: data.tag_color,
      }

      // If parentId (RecordId) is provided, use it directly
      if (data.parentId) {
        values.tag_parent = data.parentId
      }

      const result = await this.handler.create('tag', values)
      const recordId = result.recordId
      const { entityInstanceId } = parseRecordId(recordId)

      // Parse parent info
      const { parentId, parentRecordId } = this.parseParentRecordId(data.parentId)

      return {
        recordId,
        id: entityInstanceId,
        title: data.title,
        tag_description: data.tag_description ?? null,
        tag_emoji: data.tag_emoji ?? null,
        tag_color: data.tag_color ?? '#94a3b8',
        parentId,
        parentRecordId,
        isSystemTag: false,
        createdAt: result.instance.createdAt,
        updatedAt: result.instance.updatedAt ?? result.instance.createdAt,
      }
    } catch (error) {
      logger.error('Error creating tag', { data, error })
      throw error
    }
  }

  /**
   * Update an existing tag
   * @param recordId - Tag RecordId to update
   * @param data - Updated tag data
   * @returns Promise resolving to the updated tag
   */
  async updateTag(recordId: RecordId, data: UpdateTagInput): Promise<TagData> {
    try {
      const values: Record<string, unknown> = {}

      // Only include fields that are explicitly set
      if (data.title !== undefined) values.title = data.title
      if (data.tag_description !== undefined) values.tag_description = data.tag_description
      if (data.tag_emoji !== undefined) values.tag_emoji = data.tag_emoji
      if (data.tag_color !== undefined) values.tag_color = data.tag_color

      // Handle parent relationship
      if (data.parentId !== undefined) {
        values.tag_parent = data.parentId // Can be null or RecordId
      }

      await this.handler.update(recordId, values)

      // Fetch the updated tag to return accurate data
      return await this.getTagById(recordId) as TagData
    } catch (error) {
      logger.error('Error updating tag', { recordId, data, error })
      throw error
    }
  }

  /**
   * Delete a tag
   * @param recordId - Tag RecordId to delete
   */
  async deleteTag(recordId: RecordId): Promise<void> {
    try {
      await this.handler.delete(recordId)
    } catch (error) {
      logger.error('Error deleting tag', { recordId, error })
      throw error
    }
  }

  /**
   * Get a single tag by RecordId
   * @param recordId - Tag RecordId
   * @returns Promise resolving to the tag or null if not found
   */
  async getTagById(recordId: RecordId): Promise<TagData | null> {
    try {
      const { entityInstanceId } = parseRecordId(recordId)
      const allTags = await this.getAllTags()
      return allTags.find((tag) => tag.id === entityInstanceId) ?? null
    } catch (error) {
      logger.error('Error fetching tag by id', { recordId, error })
      throw error
    }
  }

  /**
   * Find a tag by name within the organization
   * @param name - Tag name to search for
   * @returns Promise resolving to the tag or null if not found
   */
  async findTagByName(name: string): Promise<TagData | null> {
    try {
      const allTags = await this.getAllTags()
      return allTags.find((tag) => tag.title === name) ?? null
    } catch (error) {
      logger.error('Error finding tag by name', { name, error })
      throw error
    }
  }

  /**
   * Find or create a tag by name
   * @param name - Tag name to find or create
   * @param metadata - Optional metadata for tag creation
   * @returns Promise resolving to the found or created tag
   */
  async findOrCreateTag(
    name: string,
    metadata?: { tag_description?: string; tag_color?: string; tag_emoji?: string; parentId?: RecordId }
  ): Promise<TagData> {
    try {
      const existingTag = await this.findTagByName(name)
      if (existingTag) {
        return existingTag
      }

      return await this.createTag({
        title: name,
        tag_description: metadata?.tag_description,
        tag_color: metadata?.tag_color,
        tag_emoji: metadata?.tag_emoji,
        parentId: metadata?.parentId,
      })
    } catch (error) {
      logger.error('Error finding or creating tag', { name, metadata, error })
      throw error
    }
  }
}
