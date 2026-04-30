// @auxx/lib/kb/kb-service.ts
import { type Database, schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import type { ArticleStatus as ArticleStatusType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, gt, gte, isNull, ne, sql } from 'drizzle-orm'
import type { KBDraftSettings } from './draft-settings'
import { enrichDocWithHighlighting } from './highlight-code'

// Local model types inferred from Drizzle schema
type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect
type ArticleRow = typeof schema.Article.$inferSelect
type ArticleRevision = typeof schema.ArticleRevision.$inferSelect
type KBPublishStatus = 'DRAFT' | 'PUBLISHED' | 'UNLISTED'

const logger = createScopedLogger('kb-service')

// ─── Public shapes (flattened) ───────────────────────────────────────────

export interface ArticleListItem {
  id: string
  knowledgeBaseId: string
  organizationId: string
  slug: string
  parentId: string | null
  order: number
  isCategory: boolean
  isPublished: boolean
  status: ArticleStatusType
  isHomePage: boolean
  hasUnpublishedChanges: boolean
  publishedAt: Date | null
  publishedRevisionId: string | null
  draftRevisionId: string | null
  // From the joined revision (published if exists, else draft)
  title: string
  emoji: string | null
  description: string | null
  excerpt: string | null
}

export interface ArticleEditorView extends ArticleListItem {
  // Always the draft fields, plus the heavy content
  content: string
  contentJson: unknown
  hasPublishedVersion: boolean
  publishedTitle: string | null
  publishedContent: string | null
  publishedContentJson: unknown
}

// ─── KB / Article input shapes ───────────────────────────────────────────

export interface KBFields {
  name?: string
  slug?: string
  description?: string
  publishStatus?: KBPublishStatus
  visibility?: 'PUBLIC' | 'INTERNAL'
  customDomain?: string
  logoDark?: string
  logoLight?: string
  theme?: 'clean' | 'muted' | 'gradient' | 'bold'
  showMode?: boolean
  defaultMode?: 'light' | 'dark'
  primaryColorLight?: string
  primaryColorDark?: string
  tintColorLight?: string
  tintColorDark?: string
  infoColorLight?: string
  infoColorDark?: string
  successColorLight?: string
  successColorDark?: string
  warningColorLight?: string
  warningColorDark?: string
  dangerColorLight?: string
  dangerColorDark?: string
  fontFamily?: string
  iconsFamily?: 'solid' | 'regular' | 'light'
  cornerStyle?: 'rounded' | 'straight'
  sidebarListStyle?: 'default' | 'pill' | 'line'
  searchbarPosition?: 'center' | 'corner'
  headerEnabled?: boolean
  footerEnabled?: boolean
  headerNavigation?: Array<{ title: string; link: string }>
  footerNavigation?: Array<{ title: string; link: string }>
}

export interface KBCreateInput
  extends Required<Pick<KBFields, 'name' | 'slug'>>,
    Omit<KBFields, 'name' | 'slug'> {}

/**
 * Live-only update input. Settings that visitors care about (theme, colors,
 * navigation, etc.) live in the draft envelope and go through
 * {@link KBService.updateDraftSettings}.
 */
export interface KBLiveInput {
  slug?: string
  customDomain?: string | null
  visibility?: 'PUBLIC' | 'INTERNAL'
  publishStatus?: KBPublishStatus
}

export type KBUpdateInput = KBLiveInput

export interface ArticleCreateInput {
  title?: string
  description?: string | null
  slug?: string
  content?: string
  contentJson?: unknown
  excerpt?: string | null
  emoji?: string | null
  isCategory?: boolean
  parentId?: string | null
}

export interface ArticleDraftFields {
  title?: string
  description?: string | null
  excerpt?: string | null
  emoji?: string | null
  content?: string
  contentJson?: unknown
}

export interface ArticleStructureFields {
  slug?: string
  parentId?: string | null
  order?: number
  isCategory?: boolean
}

export interface ArticleBatchUpdateItem {
  id: string
  updates: ArticleDraftFields & ArticleStructureFields
}

export interface ArticleListOptions {
  includeUnpublished?: boolean
}

// ─── Service ─────────────────────────────────────────────────────────────

export class KBService {
  private db: Database
  private readonly organizationId: string
  constructor(db: Database, organizationId: string) {
    this.db = db
    this.organizationId = organizationId
  }

  // ─── KB CRUD ────────────────────────────────────────────────────────

  async getKnowledgeBaseById(id: string): Promise<KnowledgeBase> {
    try {
      const knowledgeBase = await this.db.query.KnowledgeBase.findFirst({
        where: and(
          eq(schema.KnowledgeBase.id, id),
          eq(schema.KnowledgeBase.organizationId, this.organizationId)
        ),
      })
      if (!knowledgeBase) throw this.createNotFoundError(`Knowledge base with ID '${id}' not found`)
      return knowledgeBase
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge base', { knowledgeBaseId: id })
    }
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    try {
      return await this.db.query.KnowledgeBase.findMany({
        where: eq(schema.KnowledgeBase.organizationId, this.organizationId),
        orderBy: asc(schema.KnowledgeBase.name),
      })
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge bases')
    }
  }

  async createKnowledgeBase(input: KBCreateInput, createdById: string): Promise<KnowledgeBase> {
    try {
      await this.validateSlugAvailability(input.slug)
      const [knowledgeBase] = await this.db
        .insert(schema.KnowledgeBase)
        .values({
          ...input,
          organizationId: this.organizationId,
          createdById,
          updatedAt: new Date(),
        })
        .returning()
      return knowledgeBase
    } catch (error) {
      return this.handleError(error, 'Error creating knowledge base', { input })
    }
  }

  /**
   * Update live-only KB columns (URL slug, custom domain, visibility, publish
   * status). Draftable presentation fields go through {@link updateDraftSettings}.
   */
  async updateKnowledgeBase(id: string, data: KBLiveInput): Promise<KnowledgeBase> {
    try {
      const existingKb = await this.verifyKnowledgeBaseExists(id)
      if (data.slug && data.slug !== existingKb.slug) {
        await this.validateSlugAvailability(data.slug, id)
      }
      const [updatedKb] = await this.db
        .update(schema.KnowledgeBase)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updatedKb
    } catch (error) {
      return this.handleError(error, 'Error updating knowledge base', { id, data })
    }
  }

  /**
   * Shallow-merge `patch` into the KB's `draftSettings` JSON. Never touches
   * flat columns. Public visitors continue to see whatever's on the row.
   */
  async updateDraftSettings(id: string, patch: KBDraftSettings): Promise<KnowledgeBase> {
    try {
      if (Object.keys(patch).length === 0) {
        return await this.verifyKnowledgeBaseExists(id)
      }
      const existing = await this.verifyKnowledgeBaseExists(id)
      const nextDraft: KBDraftSettings = {
        ...((existing.draftSettings as KBDraftSettings | null) ?? {}),
        ...patch,
      }
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ draftSettings: nextDraft, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error updating KB draft settings', { id })
    }
  }

  /**
   * Apply pending `draftSettings` onto the live columns and clear the JSON.
   * No-op if there's no pending draft.
   */
  async publishPendingSettings(id: string): Promise<KnowledgeBase> {
    try {
      const kb = await this.verifyKnowledgeBaseExists(id)
      const draft = kb.draftSettings as KBDraftSettings | null
      if (!draft || Object.keys(draft).length === 0) return kb
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ ...draft, draftSettings: null, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error publishing KB draft settings', { id })
    }
  }

  /** Drop the pending draft. Live columns are untouched. */
  async discardSettingsDraft(id: string): Promise<KnowledgeBase> {
    try {
      await this.verifyKnowledgeBaseExists(id)
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ draftSettings: null, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error discarding KB draft settings', { id })
    }
  }

  async deleteKnowledgeBase(id: string): Promise<{ success: boolean }> {
    try {
      await this.verifyKnowledgeBaseExists(id)
      await this.db.delete(schema.KnowledgeBase).where(eq(schema.KnowledgeBase.id, id))
      return { success: true }
    } catch (error) {
      return this.handleError(error, 'Error deleting knowledge base', { knowledgeBaseId: id })
    }
  }

  /**
   * Toggle KB publish state. Updates publishedAt the first time it goes live;
   * lastPublishedAt every time it transitions to PUBLISHED/UNLISTED. Also
   * flushes any pending settings draft onto the live row in the same write,
   * so "Publish site" ships pending presentation changes too.
   */
  async publishKnowledgeBase(id: string, status: 'PUBLISHED' | 'UNLISTED'): Promise<KnowledgeBase> {
    try {
      const kb = await this.verifyKnowledgeBaseExists(id)
      const draft = kb.draftSettings as KBDraftSettings | null
      const now = new Date()
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({
          ...(draft ?? {}),
          draftSettings: null,
          publishStatus: status,
          publishedAt: kb.publishedAt ?? now,
          lastPublishedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error publishing knowledge base', { id, status })
    }
  }

  async unpublishKnowledgeBase(id: string): Promise<KnowledgeBase> {
    try {
      await this.verifyKnowledgeBaseExists(id)
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ publishStatus: 'DRAFT', updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error unpublishing knowledge base', { id })
    }
  }

  // ─── Article reads ──────────────────────────────────────────────────

  /**
   * List articles for a KB. Each row's title/emoji/etc. is sourced from the
   * published revision when available, falling back to the draft revision
   * (so unpublished articles still show their authoring title in the sidebar).
   */
  async getArticles(
    knowledgeBaseId: string,
    options: ArticleListOptions = {}
  ): Promise<ArticleListItem[]> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      const articles = await this.db.query.Article.findMany({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId),
          options.includeUnpublished ? undefined : eq(schema.Article.isPublished, true)
        ),
        orderBy: [asc(schema.Article.parentId), asc(schema.Article.order)],
        with: { publishedRevision: true, draftRevision: true },
      })
      return articles.map((a) => this.flattenForList(a))
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge base articles', { knowledgeBaseId })
    }
  }

  /**
   * Editor view: returns the article with its draft revision content + a hint
   * of the published revision content for "discard draft" previews.
   */
  async getArticleById(id: string, knowledgeBaseId?: string): Promise<ArticleEditorView> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId),
          knowledgeBaseId ? eq(schema.Article.knowledgeBaseId, knowledgeBaseId) : undefined
        ),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      return this.flattenForEditor(article)
    } catch (error) {
      return this.handleError(error, 'Error fetching article', { articleId: id })
    }
  }

  async getArticleBySlug(slug: string, knowledgeBaseId: string): Promise<ArticleEditorView> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.slug, slug),
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with slug '${slug}' not found`)
      return this.flattenForEditor(article)
    } catch (error) {
      return this.handleError(error, 'Error fetching article by slug', { slug, knowledgeBaseId })
    }
  }

  /**
   * Resolve the slash-joined slug path of an article by walking parentId.
   * Used for surgical revalidation of the public site.
   */
  async getArticleSlugPath(articleId: string): Promise<string | undefined> {
    try {
      const path: string[] = []
      let cursor: { id: string; slug: string; parentId: string | null } | undefined =
        await this.db.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, articleId),
            eq(schema.Article.organizationId, this.organizationId)
          ),
          columns: { id: true, slug: true, parentId: true },
        })
      if (!cursor) return undefined
      while (cursor) {
        path.unshift(cursor.slug)
        if (!cursor.parentId) break
        cursor = await this.db.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, cursor.parentId),
            eq(schema.Article.organizationId, this.organizationId)
          ),
          columns: { id: true, slug: true, parentId: true },
        })
      }
      return path.join('/')
    } catch (error) {
      logger.warn('failed to resolve slug path', { articleId, error })
      return undefined
    }
  }

  // ─── Article writes ─────────────────────────────────────────────────

  /**
   * Create a new article + its initial draft revision in one transaction.
   */
  async createArticle(
    knowledgeBaseId: string,
    input: ArticleCreateInput,
    authorId: string,
    orderInfo?: { adjacentId: string; position: 'before' | 'after' }
  ): Promise<ArticleListItem> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      const articleInput = { ...input }
      if (!articleInput.title || articleInput.title.trim() === '') {
        const nextPageNumber = await this.findNextPageNumber(knowledgeBaseId)
        articleInput.title = `Page ${nextPageNumber}`
        articleInput.slug = `page-${nextPageNumber}`
      } else if (!articleInput.slug || articleInput.slug.trim() === '') {
        articleInput.slug = await this.generateUniqueSlugFromTitle(
          articleInput.title,
          knowledgeBaseId
        )
      }
      await this.validateArticleSlugAvailability(articleInput.slug!, knowledgeBaseId)
      if (articleInput.parentId) {
        await this.verifyParentArticleExists(articleInput.parentId, knowledgeBaseId)
      }
      let newOrder = 0
      if (orderInfo) {
        const adjacent = await this.db.query.Article.findFirst({
          where: eq(schema.Article.id, orderInfo.adjacentId),
          columns: { order: true, parentId: true },
        })
        if (adjacent) {
          if (articleInput.parentId === undefined) articleInput.parentId = adjacent.parentId
          if (orderInfo.position === 'before') {
            newOrder = adjacent.order
            await this.db
              .update(schema.Article)
              .set({ order: sql`${schema.Article.order} + 1` })
              .where(
                and(
                  eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
                  articleInput.parentId === null
                    ? isNull(schema.Article.parentId)
                    : eq(schema.Article.parentId, articleInput.parentId as string),
                  gte(schema.Article.order, newOrder)
                )
              )
          } else {
            newOrder = adjacent.order + 1
            await this.db
              .update(schema.Article)
              .set({ order: sql`${schema.Article.order} + 1` })
              .where(
                and(
                  eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
                  articleInput.parentId === null
                    ? isNull(schema.Article.parentId)
                    : eq(schema.Article.parentId, articleInput.parentId as string),
                  gt(schema.Article.order, adjacent.order)
                )
              )
          }
        }
      } else {
        newOrder = await this.getNextArticleOrder(knowledgeBaseId, articleInput.parentId)
      }

      const result = await this.db.transaction(async (tx) => {
        // 1. Insert Article with NULL revision pointers (FKs are nullable)
        const [newArticle] = await tx
          .insert(schema.Article)
          .values({
            slug: articleInput.slug || '',
            isCategory: articleInput.isCategory || false,
            parentId: articleInput.parentId ?? null,
            isPublished: false,
            status: ArticleStatus.DRAFT,
            order: newOrder,
            knowledgeBaseId,
            organizationId: this.organizationId,
            authorId,
            updatedAt: new Date(),
            hasUnpublishedChanges: false,
          })
          .returning()

        // 2. Insert the initial draft revision
        const [newRevision] = await tx
          .insert(schema.ArticleRevision)
          .values({
            articleId: newArticle.id,
            organizationId: this.organizationId,
            versionNumber: null,
            title: articleInput.title || '',
            description: articleInput.description ?? null,
            excerpt: articleInput.excerpt ?? null,
            emoji: articleInput.emoji ?? null,
            content: articleInput.content ?? '',
            contentJson: articleInput.contentJson ?? null,
            editorId: authorId,
          })
          .returning()

        // 3. Wire the pointer
        const [withPointer] = await tx
          .update(schema.Article)
          .set({ draftRevisionId: newRevision.id })
          .where(eq(schema.Article.id, newArticle.id))
          .returning()
        return { article: withPointer, draftRevision: newRevision }
      })

      return this.flattenForList({
        ...result.article,
        publishedRevision: null,
        draftRevision: result.draftRevision,
      })
    } catch (error) {
      return this.handleError(error, 'Error creating article', { input, knowledgeBaseId })
    }
  }

  /**
   * Update the draft revision row in place. Marks the article as having
   * unpublished changes. Does not write any structural fields.
   */
  async updateArticleDraft(
    id: string,
    fields: ArticleDraftFields,
    editorId: string,
    knowledgeBaseId?: string
  ): Promise<ArticleListItem> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      if (!article.draftRevisionId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Article has no draft revision',
        })
      }

      const draftUpdate: Partial<ArticleRevision> = {
        editorId,
        updatedAt: new Date(),
      }
      if (fields.title !== undefined) draftUpdate.title = fields.title
      if (fields.description !== undefined) draftUpdate.description = fields.description
      if (fields.excerpt !== undefined) draftUpdate.excerpt = fields.excerpt
      if (fields.emoji !== undefined) draftUpdate.emoji = fields.emoji
      if (fields.content !== undefined) draftUpdate.content = fields.content
      if (fields.contentJson !== undefined) {
        const enriched = fields.contentJson
          ? await enrichDocWithHighlighting(
              fields.contentJson as Parameters<typeof enrichDocWithHighlighting>[0]
            )
          : fields.contentJson
        draftUpdate.contentJson = enriched as ArticleRevision['contentJson']
      }

      const updated = await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ArticleRevision)
          .set(draftUpdate)
          .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
        const [next] = await tx
          .update(schema.Article)
          .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
          .where(eq(schema.Article.id, id))
          .returning()
        return next
      })

      // Reload with revisions to flatten
      const reloaded = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, id),
        with: { publishedRevision: true, draftRevision: true },
      })
      return this.flattenForList(
        reloaded ?? { ...updated, publishedRevision: null, draftRevision: null }
      )
    } catch (error) {
      return this.handleError(error, 'Error updating article draft', { articleId: id })
    }
  }

  /**
   * Mutate structural fields (slug, parent, order, isCategory). Stays on the
   * Article row — no revision side-effects.
   */
  async updateArticleStructure(
    id: string,
    fields: ArticleStructureFields,
    knowledgeBaseId?: string
  ): Promise<ArticleListItem> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      if (fields.slug && fields.slug !== article.slug) {
        await this.validateArticleSlugAvailability(fields.slug, article.knowledgeBaseId, id)
      }
      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (fields.slug !== undefined) updateData.slug = fields.slug
      if (fields.parentId !== undefined) updateData.parentId = fields.parentId
      if (fields.order !== undefined) updateData.order = fields.order
      if (fields.isCategory !== undefined) updateData.isCategory = fields.isCategory

      await this.db.update(schema.Article).set(updateData).where(eq(schema.Article.id, id))

      const reloaded = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, id),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!reloaded) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      return this.flattenForList(reloaded)
    } catch (error) {
      return this.handleError(error, 'Error updating article structure', { articleId: id })
    }
  }

  /**
   * Batch tree mutations (reorder + parent). Used by drag-and-drop.
   */
  async updateArticlesBatch(
    knowledgeBaseId: string,
    articles: ArticleBatchUpdateItem[]
  ): Promise<ArticleListItem[]> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      return await this.db.transaction(async (tx) => {
        const results: ArticleListItem[] = []
        for (const { id, updates } of articles) {
          const existing = await tx.query.Article.findFirst({
            where: and(
              eq(schema.Article.id, id),
              eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
              eq(schema.Article.organizationId, this.organizationId)
            ),
          })
          if (!existing) {
            logger.warn(`Article ${id} not found in KB ${knowledgeBaseId}`)
            continue
          }
          const cleaned: Record<string, unknown> = { updatedAt: new Date() }
          for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined && ['slug', 'parentId', 'order', 'isCategory'].includes(key)) {
              cleaned[key] = value
            }
          }
          await tx.update(schema.Article).set(cleaned).where(eq(schema.Article.id, id))
          const reloaded = await tx.query.Article.findFirst({
            where: eq(schema.Article.id, id),
            with: { publishedRevision: true, draftRevision: true },
          })
          if (reloaded) results.push(this.flattenForList(reloaded))
        }
        return results
      })
    } catch (error) {
      return this.handleError(error, 'Error updating articles batch', {
        knowledgeBaseId,
        articleCount: articles.length,
      })
    }
  }

  async deleteArticle(id: string, knowledgeBaseId?: string): Promise<{ success: boolean }> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { children: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      if (article.children.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot delete an article with children. Please remove or reassign children first.',
        })
      }
      // Drop revision pointers first to avoid the circular FK blocking the cascade
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.Article)
          .set({ publishedRevisionId: null, draftRevisionId: null })
          .where(eq(schema.Article.id, id))
        await tx.delete(schema.Article).where(eq(schema.Article.id, id))
      })
      return { success: true }
    } catch (error) {
      return this.handleError(error, 'Error deleting article', { articleId: id })
    }
  }

  // ─── Publish state transitions ──────────────────────────────────────

  /**
   * Publish the article. If the draft has changes (or there is no published
   * revision yet), inserts a new ArticleRevision snapshot with the next
   * versionNumber and points the article at it. Otherwise just toggles
   * visibility back on (no new snapshot).
   */
  async publishArticle(
    id: string,
    editorId: string
  ): Promise<{ article: ArticleListItem; version: ArticleRevision | null }> {
    try {
      const result = await this.db.transaction(async (tx) => {
        const article = await tx.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, id),
            eq(schema.Article.organizationId, this.organizationId)
          ),
          with: { draftRevision: true },
        })
        if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
        if (!article.draftRevision) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Article has no draft revision to publish',
          })
        }
        const needsNewSnapshot =
          article.hasUnpublishedChanges || article.publishedRevisionId === null

        let newVersion: ArticleRevision | null = null
        let newPublishedRevisionId = article.publishedRevisionId

        if (needsNewSnapshot) {
          // Compute next version number
          const [{ next }] = await tx
            .select({
              next: sql<number>`COALESCE(MAX(${schema.ArticleRevision.versionNumber}), 0) + 1`,
            })
            .from(schema.ArticleRevision)
            .where(eq(schema.ArticleRevision.articleId, id))
          const draft = article.draftRevision
          const [inserted] = await tx
            .insert(schema.ArticleRevision)
            .values({
              articleId: id,
              organizationId: this.organizationId,
              versionNumber: next,
              title: draft.title,
              description: draft.description,
              excerpt: draft.excerpt,
              emoji: draft.emoji,
              content: draft.content,
              contentJson: draft.contentJson,
              editorId,
            })
            .returning()
          newVersion = inserted
          newPublishedRevisionId = inserted.id
        }

        const now = new Date()
        const [updated] = await tx
          .update(schema.Article)
          .set({
            publishedRevisionId: newPublishedRevisionId,
            isPublished: true,
            status: ArticleStatus.PUBLISHED,
            publishedAt: article.publishedAt ?? now,
            publishedById: editorId,
            hasUnpublishedChanges: false,
            updatedAt: now,
          })
          .where(eq(schema.Article.id, id))
          .returning()
        return { article: updated, version: newVersion }
      })

      const reloaded = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, id),
        with: { publishedRevision: true, draftRevision: true },
      })
      return {
        article: this.flattenForList(
          reloaded ?? {
            ...result.article,
            publishedRevision: null,
            draftRevision: null,
          }
        ),
        version: result.version,
      }
    } catch (error) {
      return this.handleError(error, 'Error publishing article', { articleId: id })
    }
  }

  async unpublishArticle(id: string): Promise<ArticleListItem> {
    try {
      const article = await this.verifyArticleExists(id)
      await this.db
        .update(schema.Article)
        .set({
          isPublished: false,
          status: ArticleStatus.DRAFT,
          updatedAt: new Date(),
        })
        .where(eq(schema.Article.id, article.id))
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error unpublishing article', { articleId: id })
    }
  }

  async archiveArticle(id: string): Promise<ArticleListItem> {
    try {
      await this.verifyArticleExists(id)
      await this.db
        .update(schema.Article)
        .set({
          status: ArticleStatus.ARCHIVED,
          isPublished: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.Article.id, id))
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error archiving article', { articleId: id })
    }
  }

  async unarchiveArticle(id: string): Promise<ArticleListItem> {
    try {
      await this.verifyArticleExists(id)
      await this.db
        .update(schema.Article)
        .set({
          status: ArticleStatus.DRAFT,
          isPublished: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.Article.id, id))
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error unarchiving article', { articleId: id })
    }
  }

  /**
   * Discard the current draft, copying the published revision's content
   * back into the draft revision row. No-op if there's no published version.
   */
  async discardArticleDraft(id: string): Promise<ArticleListItem> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { publishedRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (!article.publishedRevision || !article.draftRevisionId) {
        // Nothing to discard back to; just clear the dirty flag for tidiness.
        await this.db
          .update(schema.Article)
          .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
          .where(eq(schema.Article.id, id))
        return await this.reloadFlat(id)
      }
      const pub = article.publishedRevision
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ArticleRevision)
          .set({
            title: pub.title,
            description: pub.description,
            excerpt: pub.excerpt,
            emoji: pub.emoji,
            content: pub.content,
            contentJson: pub.contentJson,
            updatedAt: new Date(),
          })
          .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
        await tx
          .update(schema.Article)
          .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
          .where(eq(schema.Article.id, id))
      })
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error discarding article draft', { articleId: id })
    }
  }

  /**
   * Restore a prior version into the draft revision (in-place). Marks the
   * article dirty so the user can preview before publishing.
   */
  async restoreArticleVersion(versionId: string, editorId: string): Promise<ArticleListItem> {
    try {
      const version = await this.db.query.ArticleRevision.findFirst({
        where: and(
          eq(schema.ArticleRevision.id, versionId),
          eq(schema.ArticleRevision.organizationId, this.organizationId)
        ),
      })
      if (!version) throw this.createNotFoundError(`Version with ID '${versionId}' not found`)
      if (version.versionNumber === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot restore from a draft revision',
        })
      }
      const article = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, version.articleId),
      })
      if (!article || !article.draftRevisionId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Article has no draft revision',
        })
      }
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ArticleRevision)
          .set({
            title: version.title,
            description: version.description,
            excerpt: version.excerpt,
            emoji: version.emoji,
            content: version.content,
            contentJson: version.contentJson,
            editorId,
            updatedAt: new Date(),
          })
          .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
        await tx
          .update(schema.Article)
          .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
          .where(eq(schema.Article.id, article.id))
      })
      return await this.reloadFlat(article.id)
    } catch (error) {
      return this.handleError(error, 'Error restoring article version', { versionId })
    }
  }

  /**
   * Mark a single article as the home page of its KB. Clears isHomePage on
   * every other article in the same KB.
   */
  async setHomeArticle(id: string): Promise<ArticleListItem> {
    try {
      const article = await this.verifyArticleExists(id)
      if (!article.isPublished) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only published articles can be set as the home page',
        })
      }
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.Article)
          .set({ isHomePage: false })
          .where(
            and(
              eq(schema.Article.knowledgeBaseId, article.knowledgeBaseId),
              ne(schema.Article.id, id)
            )
          )
        await tx
          .update(schema.Article)
          .set({ isHomePage: true, updatedAt: new Date() })
          .where(eq(schema.Article.id, id))
      })
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error setting home article', { articleId: id })
    }
  }

  // ─── Versions ───────────────────────────────────────────────────────

  async getArticleVersions(articleId: string) {
    try {
      await this.verifyArticleExists(articleId)
      return await this.db.query.ArticleRevision.findMany({
        where: and(
          eq(schema.ArticleRevision.articleId, articleId),
          eq(schema.ArticleRevision.organizationId, this.organizationId),
          sql`${schema.ArticleRevision.versionNumber} IS NOT NULL`
        ),
        orderBy: desc(schema.ArticleRevision.versionNumber),
        with: { editor: { columns: { id: true, name: true, image: true } } },
      })
    } catch (error) {
      return this.handleError(error, 'Error fetching article versions', { articleId })
    }
  }

  async renameArticleVersion(versionId: string, label: string | null): Promise<void> {
    try {
      await this.db
        .update(schema.ArticleRevision)
        .set({ label, updatedAt: new Date() })
        .where(
          and(
            eq(schema.ArticleRevision.id, versionId),
            eq(schema.ArticleRevision.organizationId, this.organizationId)
          )
        )
    } catch (error) {
      this.handleError(error, 'Error renaming article version', { versionId })
    }
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  private flattenForList(a: any): ArticleListItem {
    const display = a.publishedRevision ?? a.draftRevision ?? {}
    return {
      id: a.id,
      knowledgeBaseId: a.knowledgeBaseId,
      organizationId: a.organizationId,
      slug: a.slug,
      parentId: a.parentId,
      order: a.order,
      isCategory: a.isCategory,
      isPublished: a.isPublished,
      status: a.status,
      isHomePage: a.isHomePage,
      hasUnpublishedChanges: a.hasUnpublishedChanges,
      publishedAt: a.publishedAt,
      publishedRevisionId: a.publishedRevisionId,
      draftRevisionId: a.draftRevisionId,
      title: display.title ?? '',
      emoji: display.emoji ?? null,
      description: display.description ?? null,
      excerpt: display.excerpt ?? null,
    }
  }

  private flattenForEditor(a: any): ArticleEditorView {
    const draft = a.draftRevision
    const pub = a.publishedRevision
    if (!draft) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Article ${a.id} has no draft revision`,
      })
    }
    return {
      id: a.id,
      knowledgeBaseId: a.knowledgeBaseId,
      organizationId: a.organizationId,
      slug: a.slug,
      parentId: a.parentId,
      order: a.order,
      isCategory: a.isCategory,
      isPublished: a.isPublished,
      status: a.status,
      isHomePage: a.isHomePage,
      hasUnpublishedChanges: a.hasUnpublishedChanges,
      publishedAt: a.publishedAt,
      publishedRevisionId: a.publishedRevisionId,
      draftRevisionId: a.draftRevisionId,
      title: draft.title ?? '',
      emoji: draft.emoji ?? null,
      description: draft.description ?? null,
      excerpt: draft.excerpt ?? null,
      content: draft.content ?? '',
      contentJson: draft.contentJson ?? null,
      hasPublishedVersion: !!pub,
      publishedTitle: pub?.title ?? null,
      publishedContent: pub?.content ?? null,
      publishedContentJson: pub?.contentJson ?? null,
    }
  }

  private async reloadFlat(id: string): Promise<ArticleListItem> {
    const reloaded = await this.db.query.Article.findFirst({
      where: eq(schema.Article.id, id),
      with: { publishedRevision: true, draftRevision: true },
    })
    if (!reloaded) throw this.createNotFoundError(`Article with ID '${id}' not found`)
    return this.flattenForList(reloaded)
  }

  private async findNextPageNumber(knowledgeBaseId: string): Promise<number> {
    try {
      // Pull every article for this KB along with its draft revision title so
      // we can scan for "Page N" titles and "page-N" slugs.
      const articles = await this.db.query.Article.findMany({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId),
          sql`${schema.Article.slug} like 'page-%'`
        ),
        columns: { slug: true },
        with: { draftRevision: { columns: { title: true } } },
      })
      if (articles.length === 0) return 1
      const numbers: number[] = []
      for (const article of articles) {
        const slugMatch = article.slug.match(/^page-(\d+)$/)
        if (slugMatch) numbers.push(parseInt(slugMatch[1], 10))
        const titleMatch = article.draftRevision?.title?.match(/^Page (\d+)$/)
        if (titleMatch) numbers.push(parseInt(titleMatch[1], 10))
      }
      return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
    } catch (error) {
      logger.error('Error finding next page number', {
        knowledgeBaseId,
        organizationId: this.organizationId,
        error,
      })
      return 1
    }
  }

  private createNotFoundError(message: string): TRPCError {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }

  private async verifyKnowledgeBaseExists(id: string): Promise<KnowledgeBase> {
    const knowledgeBase = await this.db.query.KnowledgeBase.findFirst({
      where: and(
        eq(schema.KnowledgeBase.id, id),
        eq(schema.KnowledgeBase.organizationId, this.organizationId)
      ),
    })
    if (!knowledgeBase) throw this.createNotFoundError(`Knowledge base with ID '${id}' not found`)
    return knowledgeBase
  }

  private async verifyArticleExists(id: string): Promise<ArticleRow> {
    const article = await this.db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, this.organizationId)),
    })
    if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
    return article
  }

  private async verifyParentArticleExists(
    parentId: string,
    knowledgeBaseId: string
  ): Promise<void> {
    const parentExists = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, parentId),
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId)
      ),
    })
    if (!parentExists) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Parent article with ID '${parentId}' not found`,
      })
    }
  }

  private handleError(error: any, logMessage: string, context: Record<string, any> = {}): never {
    if (error instanceof TRPCError) throw error
    logger.error(logMessage, { error, organizationId: this.organizationId, ...context })
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: logMessage, cause: error })
  }

  private async validateSlugAvailability(slug: string, excludeId?: string): Promise<void> {
    const existingKb = await this.db.query.KnowledgeBase.findFirst({
      where: and(
        eq(schema.KnowledgeBase.organizationId, this.organizationId),
        eq(schema.KnowledgeBase.slug, slug),
        excludeId ? ne(schema.KnowledgeBase.id, excludeId) : undefined
      ),
      columns: { id: true },
    })
    if (existingKb) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A knowledge base with slug '${slug}' already exists`,
      })
    }
  }

  private async validateArticleSlugAvailability(
    slug: string,
    knowledgeBaseId: string,
    excludeId?: string
  ): Promise<void> {
    const slugExists = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        eq(schema.Article.slug, slug),
        excludeId ? ne(schema.Article.id, excludeId) : undefined
      ),
    })
    if (slugExists) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `An article with slug '${slug}' already exists in this knowledge base`,
      })
    }
  }

  private async getNextArticleOrder(
    knowledgeBaseId: string,
    parentId?: string | null
  ): Promise<number> {
    const highestOrder = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        parentId === null || parentId === undefined
          ? isNull(schema.Article.parentId)
          : eq(schema.Article.parentId, parentId)
      ),
      orderBy: desc(schema.Article.order),
      columns: { order: true },
    })
    return highestOrder ? (highestOrder as any).order + 1 : 0
  }

  private async generateUniqueSlugFromTitle(
    title: string,
    knowledgeBaseId: string,
    excludeId?: string
  ): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
    let slug = baseSlug
    let counter = 1
    while (true) {
      const existing = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.slug, slug),
          excludeId ? ne(schema.Article.id, excludeId) : undefined
        ),
      })
      if (!existing) return slug
      slug = `${baseSlug}-${counter}`
      counter++
    }
  }
}
