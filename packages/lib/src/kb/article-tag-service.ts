// packages/lib/src/kb/article-tag-service.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/types/resource'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { FieldValueService } from '../field-values'
import { getArticleTagIds } from '../field-values/relationship-queries'

const logger = createScopedLogger('article-tag-service')

/**
 * Service for managing tag assignments on articles.
 *
 * Mirrors `ThreadMutationService.tagThreadsBulk` — articles use the same
 * `tag` EntityDefinition and the same FieldValue-backed relationship pattern,
 * just with `systemAttribute='article_tags'` instead of `'thread_tags'`.
 *
 * Writes go through `FieldValueService` so inverse-sync, field-trigger, and
 * realtime-publish behavior matches every other relationship write.
 */
export class ArticleTagMutationService {
  private readonly organizationId: string
  private readonly userId: string
  private readonly db: Database

  constructor(organizationId: string, userId: string, db: Database) {
    this.organizationId = organizationId
    this.userId = userId
    this.db = db
  }

  private async getArticleTagsFieldId(): Promise<string | null> {
    const field = await getOrgCache()
      .from(this.organizationId, 'customFields')
      .bySystemAttribute('article_tags')
    return field?.id ?? null
  }

  private async toArticleRecordId(articleId: string): Promise<RecordId> {
    const articleEntityDefId = await requireCachedEntityDefId(this.organizationId, 'article')
    return toRecordId(articleEntityDefId, articleId)
  }

  /**
   * Replace the tag list for a single article with `tagRecordIds`.
   * Returns counts compatible with `tagArticlesBulk`.
   */
  async setTags(
    articleRecordId: RecordId,
    tagRecordIds: RecordId[]
  ): Promise<{ created: number; skipped: number }> {
    const fieldId = await this.getArticleTagsFieldId()
    if (!fieldId) {
      logger.warn('article_tags field not found for organization', {
        organizationId: this.organizationId,
      })
      return { created: 0, skipped: 0 }
    }

    const fieldValueService = new FieldValueService(this.organizationId, this.userId, this.db)
    const value = tagRecordIds.map((recordId) => ({ recordId }))
    await fieldValueService.setValueWithBuiltIn({
      recordId: articleRecordId,
      fieldId,
      value,
    })
    return { created: tagRecordIds.length, skipped: 0 }
  }

  /**
   * Bulk-tag many articles. `operation` controls whether the tag set is added,
   * removed, or replaced for each article.
   */
  async tagArticlesBulk(
    articleRecordIds: RecordId[],
    tagRecordIds: RecordId[],
    operation: 'add' | 'remove' | 'set' = 'add'
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    if (!articleRecordIds.length || !tagRecordIds.length) {
      return { created: 0, skipped: 0, errors: [] }
    }

    logger.info('Bulk tagging articles', {
      operation,
      articleCount: articleRecordIds.length,
      tagCount: tagRecordIds.length,
      organizationId: this.organizationId,
    })

    const errors: string[] = []
    const fieldId = await this.getArticleTagsFieldId()
    if (!fieldId) {
      errors.push('Article tags field not found for organization')
      return { created: 0, skipped: 0, errors }
    }

    try {
      const fieldValueService = new FieldValueService(this.organizationId, this.userId, this.db)
      let created = 0
      let skipped = 0

      if (operation === 'add') {
        const result = await fieldValueService.addRelationValuesBulk({
          recordIds: articleRecordIds,
          fieldId,
          relatedRecordIds: tagRecordIds,
        })
        created = result.inserted
        skipped = result.skipped
      } else if (operation === 'remove') {
        const result = await fieldValueService.removeRelationValuesBulk({
          recordIds: articleRecordIds,
          fieldId,
          relatedRecordIds: tagRecordIds,
        })
        created = result.removed
      } else {
        // 'set' — no bulk primitive; per-entity setValueWithBuiltIn reuses
        // inverse sync + publish logic.
        const value = tagRecordIds.map((recordId) => ({ recordId }))
        await Promise.all(
          articleRecordIds.map((recordId) =>
            fieldValueService.setValueWithBuiltIn({ recordId, fieldId, value })
          )
        )
        created = articleRecordIds.length * tagRecordIds.length
      }

      return { created, skipped, errors }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to update article tags in bulk', { error: message })
      throw new Error(`Database error updating tags for articles: ${message}`)
    }
  }

  /**
   * Read tag RecordIds for a single article. Sorted by FieldValue.sortKey
   * (delegated to `getArticleTagIds`).
   */
  async getTags(articleRecordId: RecordId): Promise<RecordId[]> {
    const tagEntityDefId = await requireCachedEntityDefId(this.organizationId, 'tag')
    const articleId = getInstanceId(articleRecordId)
    if (!articleId) return []
    const tagIds = await getArticleTagIds(this.db, articleId, this.organizationId)
    return tagIds.map((id) => toRecordId(tagEntityDefId, id))
  }
}
