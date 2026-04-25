// packages/lib/src/tags/tag-service.ts
// Service for reading tags within an organization.
// Uses UnifiedCrudHandler internally for entity-definition lookup.
// Writes/deletes go through the generic record + fieldValue tRPC routes; this
// service is read-only.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { listAll, UnifiedCrudHandler } from '../resources/crud'
import { parseRecordId, type RecordId, toRecordId } from '../resources/resource-id'

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

/**
 * Service for reading tags within an organization.
 * Uses UnifiedCrudHandler internally for entity-definition resolution.
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
  private parseParentRecordId(parentValue: unknown): {
    parentId: string | null
    parentRecordId: RecordId | null
  } {
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
      parentRecordId: parentRecordIdStr as RecordId,
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
      tag_color: (item.fieldValues.tag_color as string) ?? 'gray',
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
  async searchTags(
    query: string,
    limit: number = 10
  ): Promise<{ recordId: RecordId; id: string; name: string }[]> {
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
}
