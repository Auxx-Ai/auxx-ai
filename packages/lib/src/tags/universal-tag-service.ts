// packages/lib/src/tags/universal-tag-service.ts

import { type Database, schema } from '@auxx/database'
import type { IntegrationProviderType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { randomUUID } from 'crypto'
import { and, eq, isNotNull } from 'drizzle-orm'

const logger = createScopedLogger('universal-tag-service')

/**
 * UniversalTagService - Manages the relationship between internal tags and provider labels
 *
 * This service handles:
 * - Creating and managing universal tags that work across all providers
 * - Linking tags to provider-specific labels
 * - Providing fallback behavior when providers don't support labels
 * - Syncing tag/label state between internal system and providers
 */
export class UniversalTagService {
  constructor(
    private db: Database,
    private organizationId: string
  ) {}

  /**
   * Get or create a linked label for a tag and integration
   * This creates a provider-specific label that maps to our internal tag
   */
  async getOrCreateLinkedLabel(
    tagId: string,
    integrationId: string,
    providerType: IntegrationProviderType,
    providerCreateLabel?: (name: string, color?: string) => Promise<{ id: string; name: string }>
  ): Promise<{ id: string; labelId: string; name: string } | null> {
    try {
      // First check if we already have a linked label
      const existingLink = await this.db.query.IntegrationTagLabel.findFirst({
        where: (integrationTagLabels, { eq, and }) =>
          and(
            eq(integrationTagLabels.integrationId, integrationId),
            eq(integrationTagLabels.tagId, tagId)
          ),
        with: {
          label: true,
          tag: true,
        },
      })

      if (existingLink) {
        return {
          id: existingLink.id,
          labelId: existingLink.labelId,
          name: existingLink.label.name,
        }
      }

      // Get the tag details
      const tag = await this.db.query.Tag.findFirst({
        where: (tags, { eq }) => eq(tags.id, tagId),
      })

      if (!tag || tag.organizationId !== this.organizationId) {
        logger.error('Tag not found or belongs to different organization', {
          tagId,
          organizationId: this.organizationId,
        })
        return null
      }

      // Create provider label if provider supports it and we have creation function
      let providerLabelId: string | null = null
      if (providerCreateLabel) {
        try {
          const providerLabel = await providerCreateLabel(tag.title, tag.color || undefined)
          providerLabelId = providerLabel.id
        } catch (error) {
          logger.warn('Failed to create provider label, will create local-only label', {
            error,
            tagId,
            integrationId,
          })
        }
      }

      // Create local label record
      const [label] = await this.db
        .insert(schema.Label)
        .values({
          id: randomUUID(),
          name: tag.title,
          integrationType: providerType,
          integrationId: integrationId,
          labelId: providerLabelId || `local-${tagId}-${Date.now()}`,
          organizationId: this.organizationId,
          backgroundColor: tag.color,
          type: 'system' as const,
          description: `Synced from tag: ${tag.title}`,
          updatedAt: new Date(),
        })
        .returning()

      // Create the link between tag and label
      const [link] = await this.db
        .insert(schema.IntegrationTagLabel)
        .values({
          id: randomUUID(),
          organizationId: this.organizationId,
          integrationId,
          tagId,
          labelId: label!.id,
          updatedAt: new Date(),
        })
        .returning()

      logger.info('Created linked label for tag', {
        tagId,
        labelId: label!.id,
        integrationId,
        providerLabelId,
      })

      return {
        id: link!.id,
        labelId: link!.labelId,
        name: label!.name,
      }
    } catch (error) {
      logger.error('Error creating linked label', {
        error,
        tagId,
        integrationId,
      })
      throw error
    }
  }

  /**
   * Get the CustomField ID for thread_tags (cached per instance)
   */
  private threadTagsFieldId: string | null = null
  private async getThreadTagsFieldId(): Promise<string | null> {
    if (this.threadTagsFieldId) return this.threadTagsFieldId

    const result = await this.db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.systemAttribute, 'thread_tags'),
          eq(schema.CustomField.organizationId, this.organizationId)
        )
      )
      .limit(1)

    this.threadTagsFieldId = result[0]?.id ?? null
    return this.threadTagsFieldId
  }

  /**
   * Apply a tag to an entity (thread, message, etc)
   * This is the universal operation that works for all providers.
   * Uses FieldValue storage for tag relationships.
   */
  async applyTag(params: {
    tagId: string
    entityType: 'thread' | 'message' | 'customer'
    entityId: string
    createdBy: string
  }): Promise<{ id: string }> {
    try {
      // Currently only thread is supported in the schema
      if (params.entityType === 'thread') {
        const fieldId = await this.getThreadTagsFieldId()
        if (!fieldId) {
          throw new Error('Thread tags field not found for organization')
        }

        // Check if tag already applied via FieldValue
        const existing = await this.db
          .select({ id: schema.FieldValue.id })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.fieldId, fieldId),
              eq(schema.FieldValue.entityId, params.entityId),
              eq(schema.FieldValue.relatedEntityId, params.tagId)
            )
          )
          .limit(1)

        if (existing.length > 0) {
          return { id: `${params.tagId}-${params.entityId}` }
        }

        // Apply the tag via FieldValue
        await this.db.insert(schema.FieldValue).values({
          id: generateId('fv'),
          fieldId,
          entityId: params.entityId,
          relatedEntityId: params.tagId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        logger.info('Applied tag to thread', {
          tagId: params.tagId,
          threadId: params.entityId,
        })

        return { id: `${params.tagId}-${params.entityId}` }
      } else {
        // For other entity types, we'll need to extend the schema
        logger.warn('Unsupported entity type for tagging', {
          entityType: params.entityType,
          entityId: params.entityId,
        })
        throw new Error(`Entity type ${params.entityType} is not yet supported for tagging`)
      }
    } catch (error) {
      logger.error('Error applying tag', {
        error,
        params,
      })
      throw error
    }
  }

  /**
   * Remove a tag from an entity.
   * Uses FieldValue storage for tag relationships.
   */
  async removeTag(params: {
    tagId: string
    entityType: 'thread' | 'message' | 'customer'
    entityId: string
  }): Promise<void> {
    try {
      if (params.entityType === 'thread') {
        const fieldId = await this.getThreadTagsFieldId()
        if (!fieldId) {
          throw new Error('Thread tags field not found for organization')
        }

        // Remove via FieldValue
        await this.db
          .delete(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.fieldId, fieldId),
              eq(schema.FieldValue.entityId, params.entityId),
              eq(schema.FieldValue.relatedEntityId, params.tagId)
            )
          )

        logger.info('Removed tag from thread', {
          tagId: params.tagId,
          threadId: params.entityId,
        })
      } else {
        logger.warn('Unsupported entity type for tag removal', {
          entityType: params.entityType,
          entityId: params.entityId,
        })
        throw new Error(`Entity type ${params.entityType} is not yet supported for tag removal`)
      }
    } catch (error) {
      // If tag wasn't applied, that's okay
      if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
        logger.debug('Tag was not applied to entity', params)
        return
      }

      logger.error('Error removing tag', {
        error,
        params,
      })
      throw error
    }
  }

  /**
   * Get all tags applied to an entity.
   * Uses FieldValue storage for tag relationships.
   */
  async getEntityTags(
    entityType: string,
    entityId: string
  ): Promise<
    Array<{
      id: string
      name: string
      color: string | null
      isSystemTag: boolean
    }>
  > {
    try {
      if (entityType === 'thread') {
        const fieldId = await this.getThreadTagsFieldId()
        if (!fieldId) {
          return []
        }

        // Get tag IDs from FieldValue
        const fieldValues = await this.db
          .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.fieldId, fieldId),
              eq(schema.FieldValue.entityId, entityId),
              isNotNull(schema.FieldValue.relatedEntityId)
            )
          )

        const tagIds = fieldValues
          .map((fv) => fv.relatedEntityId)
          .filter((id): id is string => id !== null)

        if (tagIds.length === 0) {
          return []
        }

        // Get full tag details
        const tags = await this.db.query.Tag.findMany({
          where: (tag, { inArray }) => inArray(tag.id, tagIds),
        })

        return tags.map((tag) => ({
          id: tag.id,
          name: tag.title,
          color: tag.color,
          isSystemTag: tag.isSystemTag,
        }))
      } else {
        logger.warn('Unsupported entity type for getting tags', {
          entityType,
          entityId,
        })
        return []
      }
    } catch (error) {
      logger.error('Error getting entity tags', {
        error,
        entityType,
        entityId,
      })
      throw error
    }
  }

  /**
   * Sync a provider label back to a tag
   * Used when labels are created/modified in the provider
   */
  async syncLabelToTag(params: {
    integrationId: string
    providerLabelId: string
    labelName: string
    labelColor?: string
    integrationType: IntegrationProviderType
  }): Promise<{ tagId: string }> {
    try {
      // Check if we already have this label mapped
      const existingLink = await this.db.query.IntegrationTagLabel.findFirst({
        where: (integrationTagLabels, { eq, and }) =>
          and(
            eq(integrationTagLabels.organizationId, this.organizationId),
            eq(integrationTagLabels.integrationId, params.integrationId)
          ),
        with: {
          tag: true,
          label: {
            where: (label, { eq }) => eq(label.labelId, params.providerLabelId),
          },
        },
      })

      if (existingLink) {
        // Update the tag name/color if changed
        const tag = existingLink.tag
        if (tag.title !== params.labelName || tag.color !== params.labelColor) {
          await this.db
            .update(schema.Tag)
            .set({
              title: params.labelName,
              color: params.labelColor,
              updatedAt: new Date(),
            })
            .where(eq(schema.Tag.id, tag.id))
        }
        return { tagId: tag.id }
      }

      // Create new tag for this label
      const [tag] = await this.db
        .insert(schema.Tag)
        .values({
          id: randomUUID(),
          title: params.labelName,
          color: params.labelColor,
          organizationId: this.organizationId,
          isSystemTag: false,
          updatedAt: new Date(),
        })
        .returning()

      // Create or update label record
      const [label] = await this.db
        .insert(schema.Label)
        .values({
          id: randomUUID(),
          name: params.labelName,
          organizationId: this.organizationId,
          backgroundColor: params.labelColor,
          labelId: params.providerLabelId,
          integrationId: params.integrationId,
          integrationType: params.integrationType,
          type: 'system' as const,
          description: `Synced from provider`,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.Label.labelId, schema.Label.organizationId, schema.Label.integrationId],
          set: {
            name: params.labelName,
            backgroundColor: params.labelColor,
            updatedAt: new Date(),
          },
        })
        .returning()

      // Create the link
      await this.db.insert(schema.IntegrationTagLabel).values({
        id: randomUUID(),
        integrationId: params.integrationId,
        tagId: tag!.id,
        labelId: label!.id,
        organizationId: this.organizationId,
        updatedAt: new Date(),
      })

      logger.info('Synced provider label to tag', {
        tagId: tag!.id,
        labelName: params.labelName,
        providerLabelId: params.providerLabelId,
      })

      return { tagId: tag!.id }
    } catch (error) {
      logger.error('Error syncing label to tag', {
        error,
        params,
      })
      throw error
    }
  }

  /**
   * Get all tags with their linked labels for a specific integration
   */
  async getTagsWithLabels(integrationId: string): Promise<
    Array<{
      tagId: string
      tagName: string
      tagColor: string | null
      labelId: string | null
      labelName: string | null
      providerLabelId: string | null
    }>
  > {
    try {
      const tags = await this.db.query.Tag.findMany({
        where: (tags, { eq }) => eq(tags.organizationId, this.organizationId),
        with: {
          integrationTagLabels: {
            where: (integrationTagLabels, { eq }) =>
              eq(integrationTagLabels.integrationId, integrationId),
            with: {
              label: true,
            },
          },
        },
      })

      return tags.map((tag) => {
        const link = tag.integrationTagLabels[0]
        return {
          tagId: tag.id,
          tagName: tag.title,
          tagColor: tag.color,
          labelId: link?.labelId ?? null,
          labelName: link?.label.name ?? null,
          providerLabelId: link?.label.labelId ?? null,
        }
      })
    } catch (error) {
      logger.error('Error getting tags with labels', {
        error,
        integrationId,
      })
      throw error
    }
  }

  /**
   * Ensure system tags exist for fallback operations
   * These are used when providers don't support certain operations
   */
  async ensureSystemTags(): Promise<void> {
    const systemTags = [
      { title: 'Archived', color: '#6B7280', description: 'Messages archived by the system' },
      { title: 'Spam', color: '#EF4444', description: 'Messages marked as spam' },
      { title: 'Trash', color: '#991B1B', description: 'Messages moved to trash' },
      { title: 'Important', color: '#F59E0B', description: 'Messages marked as important' },
      { title: 'Starred', color: '#FCD34D', description: 'Starred messages' },
    ]

    for (const tagData of systemTags) {
      // Check if tag already exists
      const existingTag = await this.db.query.Tag.findFirst({
        where: (tags, { eq, and, isNull }) =>
          and(
            eq(tags.organizationId, this.organizationId),
            eq(tags.title, tagData.title),
            isNull(tags.parentId)
          ),
      })

      if (!existingTag) {
        await this.db.insert(schema.Tag).values({
          id: randomUUID(),
          ...tagData,
          organizationId: this.organizationId,
          isSystemTag: true,
          updatedAt: new Date(),
        })
      } else {
        await this.db
          .update(schema.Tag)
          .set({
            color: tagData.color,
            description: tagData.description,
            isSystemTag: true,
            updatedAt: new Date(),
          })
          .where(eq(schema.Tag.id, existingTag.id))
      }
    }

    logger.info('Ensured system tags exist', {
      organizationId: this.organizationId,
    })
  }

  /**
   * Get or create a system tag by name
   */
  async getSystemTag(name: string): Promise<{ id: string; name: string } | null> {
    try {
      const tag = await this.db.query.Tag.findFirst({
        where: (tags, { eq, and }) =>
          and(
            eq(tags.organizationId, this.organizationId),
            eq(tags.title, name),
            eq(tags.isSystemTag, true)
          ),
      })

      if (!tag) {
        logger.warn('System tag not found', { name })
        return null
      }

      return { id: tag.id, name: tag.title }
    } catch (error) {
      logger.error('Error getting system tag', {
        error,
        name,
      })
      throw error
    }
  }
}
