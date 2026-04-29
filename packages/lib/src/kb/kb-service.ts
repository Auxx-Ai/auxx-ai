// @auxx/lib/kb/kb-service.ts
import { type Database, schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import type { ArticleStatus as ArticleStatusType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, gt, gte, isNull, ne, sql } from 'drizzle-orm'

// Local model types inferred from Drizzle schema
type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect
type Article = typeof schema.Article.$inferSelect
type ArticleRevision = typeof schema.ArticleRevision.$inferSelect
// No heavy merge of attachments/versions at read time; URLs are maintained at write-time
const logger = createScopedLogger('kb-service')
/**
 * Base type for KB fields
 */
export interface KBFields {
  name?: string
  slug?: string
  description?: string
  isPublic?: boolean
  // Original fields
  // primaryColor?: string
  // logo?: string
  customDomain?: string
  // New logo fields
  logoDark?: string
  logoLight?: string
  // Theme settings
  theme?: 'clean' | 'muted' | 'gradient' | 'bold'
  showMode?: boolean
  defaultMode?: 'light' | 'dark'
  // Color scheme
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
  // UI styling
  fontFamily?: string
  iconsFamily?: 'solid' | 'regular' | 'light'
  cornerStyle?: 'rounded' | 'straight'
  sidebarListStyle?: 'default' | 'pill' | 'line'
  searchbarPosition?: 'center' | 'corner'
  // Navigation
  headerNavigation?: Array<{
    title: string
    link: string
  }>
  footerNavigation?: Array<{
    title: string
    link: string
  }>
}
/**
 * Input types for service methods - using the base type
 */
export interface KBCreateInput
  extends Required<Pick<KBFields, 'name' | 'slug'>>,
    Omit<KBFields, 'name' | 'slug'> {}
// Use type alias since no additional properties are needed
export type KBUpdateInput = KBFields
// Base types for article operations
export interface ArticleBaseFields {
  title?: string
  description?: string
  slug?: string
  content?: string
  contentJson?: any
  excerpt?: string
  emoji?: string | null
  isCategory?: boolean
  parentId?: string | null
  isPublished?: boolean
  status?: ArticleStatusType
}
// export interface ArticleCreateInput
//   extends Required<Pick<ArticleBaseFields, 'title' | 'slug'>>,
//     Omit<ArticleBaseFields, 'title' | 'slug'> {}
// Use type alias since no additional properties are needed
export type ArticleCreateInput = ArticleBaseFields
// Use type alias since no additional properties are needed
export type ArticleUpdateInput = ArticleBaseFields
export interface ArticleBatchUpdateItem {
  id: string
  updates: ArticleUpdateInput
}
export interface ArticleListOptions {
  includeUnpublished?: boolean
}
export interface ArticleIncludeOptions {
  children?: boolean
  revisions?: boolean
}
/**
 * Knowledge Base Service
 */
export class KBService {
  private db: Database
  private readonly organizationId: string
  constructor(db: Database, organizationId: string) {
    this.db = db
    this.organizationId = organizationId
  }
  /**
   * Get a knowledge base by ID
   */
  async getKnowledgeBaseById(id: string): Promise<KnowledgeBase> {
    try {
      const knowledgeBase = await this.db.query.KnowledgeBase.findFirst({
        where: and(
          eq(schema.KnowledgeBase.id, id),
          eq(schema.KnowledgeBase.organizationId, this.organizationId)
        ),
      })
      if (!knowledgeBase) {
        throw this.createNotFoundError(`Knowledge base with ID '${id}' not found`)
      }
      // Return KB as-is; logoLight/logoDark maintained at write-time
      return knowledgeBase
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge base', { knowledgeBaseId: id })
    }
  }
  /**
   * Get all knowledge bases for the organization
   */
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
  /**
   * Create a new knowledge base
   */
  async createKnowledgeBase(input: KBCreateInput, createdById: string): Promise<KnowledgeBase> {
    try {
      await this.validateSlugAvailability(input.slug)
      // Create the knowledge base
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
   * Update a knowledge base
   */
  async updateKnowledgeBase(id: string, data: KBUpdateInput): Promise<KnowledgeBase> {
    try {
      const existingKb = await this.verifyKnowledgeBaseExists(id)
      // If changing slug, make sure it's not already in use
      if (data.slug && data.slug !== existingKb.slug) {
        await this.validateSlugAvailability(data.slug, id)
      }
      // Update the knowledge base
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
   * Delete a knowledge base
   */
  async deleteKnowledgeBase(id: string): Promise<{
    success: boolean
  }> {
    try {
      await this.verifyKnowledgeBaseExists(id)
      // Delete the knowledge base
      await this.db.delete(schema.KnowledgeBase).where(eq(schema.KnowledgeBase.id, id))
      return { success: true }
    } catch (error) {
      return this.handleError(error, 'Error deleting knowledge base', { knowledgeBaseId: id })
    }
  }
  /**
   * Get all articles for a knowledge base
   */
  async getArticles(knowledgeBaseId: string, options: ArticleListOptions = {}) {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      // Build where conditions
      // Fetch articles
      return await this.db.query.Article.findMany({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId),
          options.includeUnpublished ? undefined : eq(schema.Article.isPublished, true)
        ),
        orderBy: [
          asc(schema.Article.parentId),
          asc(schema.Article.order),
          asc(schema.Article.title),
        ],
        columns: {
          id: true,
          knowledgeBaseId: true,
          title: true,
          slug: true,
          emoji: true,
          parentId: true,
          isCategory: true,
          order: true,
          isPublished: true,
          status: true,
          description: true,
          excerpt: true,
        },
      })
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge base articles', { knowledgeBaseId })
    }
  }
  /**
   * Get a single article by ID
   */
  async getArticleById(
    id: string,
    knowledgeBaseId?: string,
    include: ArticleIncludeOptions = {}
  ): Promise<Article> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId),
          knowledgeBaseId ? eq(schema.Article.knowledgeBaseId, knowledgeBaseId) : undefined
        ),
        with: this.buildArticleIncludeOptions(include),
      })
      if (!article) {
        throw this.createNotFoundError(`Article with ID '${id}' not found`)
      }
      return article
    } catch (error) {
      return this.handleError(error, 'Error fetching article', { articleId: id })
    }
  }
  /**
   * Get a single article by slug
   */
  async getArticleBySlug(
    slug: string,
    knowledgeBaseId: string,
    include: ArticleIncludeOptions = {}
  ): Promise<Article> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.slug, slug),
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: this.buildArticleIncludeOptions(include),
      })
      if (!article) {
        throw this.createNotFoundError(`Article with slug '${slug}' not found`)
      }
      return article
    } catch (error) {
      return this.handleError(error, 'Error fetching article by slug', { slug, knowledgeBaseId })
    }
  }
  /**
   * Create a new article
   */
  async createArticle(
    knowledgeBaseId: string,
    input: ArticleCreateInput,
    authorId: string,
    orderInfo?: {
      adjacentId: string
      position: 'before' | 'after'
    }
  ): Promise<Article> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      // Auto-generate title and slug if not provided
      const articleInput = { ...input }
      // If title is missing, create an auto-numbered page
      if (!articleInput.title || articleInput.title.trim() === '') {
        const nextPageNumber = await this.findNextPageNumber(knowledgeBaseId)
        articleInput.title = `Page ${nextPageNumber}`
        articleInput.slug = `page-${nextPageNumber}`
      }
      // If title exists but slug doesn't, generate slug from title
      else if (!articleInput.slug || articleInput.slug.trim() === '') {
        articleInput.slug = await this.generateUniqueSlugFromTitle(
          articleInput.title,
          knowledgeBaseId
        )
      }
      await this.validateArticleSlugAvailability(articleInput.slug, knowledgeBaseId)
      if (articleInput.parentId) {
        await this.verifyParentArticleExists(articleInput.parentId, knowledgeBaseId)
      }
      // Calculate article order
      let newOrder = 0
      if (orderInfo) {
        // Find the adjacent article
        const adjacentArticle = await this.db.query.Article.findFirst({
          where: eq(schema.Article.id, orderInfo.adjacentId),
          columns: { order: true, parentId: true },
        })
        if (adjacentArticle) {
          // Set same parent as adjacent article if not specified
          if (articleInput.parentId === undefined) {
            articleInput.parentId = adjacentArticle.parentId
          }
          // Find all siblings
          const siblings = await this.db.query.Article.findMany({
            where: and(
              eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
              articleInput.parentId === null
                ? isNull(schema.Article.parentId)
                : eq(schema.Article.parentId, articleInput.parentId as any)
            ),
            orderBy: asc(schema.Article.order),
            columns: { id: true, order: true },
          })
          // Calculate new order and update other articles
          if (orderInfo.position === 'before') {
            newOrder = adjacentArticle.order
            // Update other articles order
            await this.db
              .update(schema.Article)
              .set({ order: sql`${schema.Article.order} + 1` })
              .where(
                and(
                  eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
                  articleInput.parentId === null
                    ? isNull(schema.Article.parentId)
                    : eq(schema.Article.parentId, articleInput.parentId as any),
                  gte(schema.Article.order, newOrder)
                )
              )
          } else {
            // After - place right after the adjacent article
            newOrder = adjacentArticle.order + 1
            // Update other articles order
            await this.db
              .update(schema.Article)
              .set({ order: sql`${schema.Article.order} + 1` })
              .where(
                and(
                  eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
                  articleInput.parentId === null
                    ? isNull(schema.Article.parentId)
                    : eq(schema.Article.parentId, articleInput.parentId as any),
                  gt(schema.Article.order, adjacentArticle.order)
                )
              )
          }
        }
      } else {
        // Default ordering at the end
        newOrder = await this.getNextArticleOrder(knowledgeBaseId, articleInput.parentId)
      }
      const [newArticle] = await this.db
        .insert(schema.Article)
        .values({
          title: articleInput.title || '',
          slug: articleInput.slug || '',
          content: articleInput.content || '',
          contentJson: articleInput.contentJson || null,
          excerpt: articleInput.excerpt,
          emoji: articleInput.emoji,
          isCategory: articleInput.isCategory || false,
          parentId: articleInput.parentId ?? null,
          isPublished: articleInput.isPublished || false,
          status: articleInput.isPublished ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
          order: newOrder,
          knowledgeBaseId,
          organizationId: this.organizationId,
          authorId,
          updatedAt: new Date(),
        })
        .returning()
      logger.info('Created article', { newArticle })
      return newArticle
    } catch (error) {
      return this.handleError(error, 'Error creating article', { input, knowledgeBaseId })
    }
  }
  /**
   * Update an article
   */
  async updateArticle(
    id: string,
    data: ArticleUpdateInput,
    editorId: string,
    knowledgeBaseId?: string
  ): Promise<Article> {
    // logger.info('Updating fdssdf', { data })
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
      })
      if (!article) {
        throw this.createNotFoundError(`Article with ID '${id}' not found`)
      }
      // If knowledge base ID provided, validate it matches
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      // If changing slug, check it's not already in use
      if (data.slug && data.slug !== article.slug) {
        await this.validateArticleSlugAvailability(data.slug, article.knowledgeBaseId, id)
      }
      // Create revision
      await this.createArticleRevision(article, editorId)
      // Prepare update data with status/isPublished sync
      const updateData = this.syncPublishedStatus(data)
      const [updatedArticle] = await this.db
        .update(schema.Article)
        .set(updateData)
        .where(eq(schema.Article.id, id))
        .returning()
      return updatedArticle
    } catch (error) {
      return this.handleError(error, 'Error updating article', { articleId: id })
    }
  }
  /**
   * Update multiple articles in batch (for reordering, structure changes)
   */
  async updateArticlesBatch(
    knowledgeBaseId: string,
    articles: ArticleBatchUpdateItem[],
    editorId: string
  ): Promise<Article[]> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      // Update each article in a transaction
      return await this.db.transaction(async (tx) => {
        const results = []
        for (const { id, updates } of articles) {
          // Verify the article exists and belongs to the knowledge base
          const existingArticle = await tx.query.Article.findFirst({
            where: and(
              eq(schema.Article.id, id),
              eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
              eq(schema.Article.organizationId, this.organizationId)
            ),
          })
          if (!existingArticle) {
            logger.warn(`Article ${id} not found or not part of knowledge base ${knowledgeBaseId}`)
            continue
          }
          // Create a revision if there are significant changes
          if (
            updates.content !== undefined ||
            updates.contentJson !== undefined ||
            updates.isCategory !== undefined
          ) {
            await this.createArticleRevision(existingArticle, editorId)
          }
          // Clean undefined values from updates
          const cleanedUpdates: any = {}
          Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined) {
              cleanedUpdates[key] = value
            }
          })
          // Update the article
          const [updatedArticle] = await tx
            .update(schema.Article)
            .set({ ...cleanedUpdates, updatedAt: new Date() })
            .where(eq(schema.Article.id, id))
            .returning()
          results.push(updatedArticle)
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
  /**
   * Delete an article
   */
  async deleteArticle(
    id: string,
    knowledgeBaseId?: string
  ): Promise<{
    success: boolean
  }> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { children: true },
      })
      if (!article) {
        throw this.createNotFoundError(`Article with ID '${id}' not found`)
      }
      // If knowledge base ID provided, validate it matches
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      // Check if article has children
      if (article.children.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot delete an article with children. Please remove or reassign children first.',
        })
      }
      // Delete the article
      await this.db.delete(schema.Article).where(eq(schema.Article.id, id))
      return { success: true }
    } catch (error) {
      return this.handleError(error, 'Error deleting article', { articleId: id })
    }
  }
  /**
   * Get article revision history
   */
  async getArticleRevisions(articleId: string): Promise<ArticleRevision[]> {
    try {
      await this.verifyArticleExists(articleId)
      // Fetch revisions
      return await this.db.query.ArticleRevision.findMany({
        where: and(
          eq(schema.ArticleRevision.articleId, articleId),
          eq(schema.ArticleRevision.organizationId, this.organizationId)
        ),
        orderBy: desc(schema.ArticleRevision.updatedAt),
        with: { editor: { columns: { id: true, name: true, image: true } } },
      })
    } catch (error) {
      return this.handleError(error, 'Error fetching article revisions', { articleId })
    }
  }
  // ==================== Private Helper Methods ====================
  /**
   * Build article include options based on the provided include flags
   */
  private buildArticleIncludeOptions(include: ArticleIncludeOptions): any {
    const withOptions: any = {}
    // Children (self-relation: parentId → id)
    if (include.children !== false) {
      withOptions.children = { orderBy: asc(schema.Article.order) }
    }
    if (include.revisions) {
      withOptions.revisions = {
        orderBy: desc(schema.ArticleRevision.updatedAt),
        with: { editor: { columns: { id: true, name: true, image: true } } },
      }
    }
    return withOptions
  }
  /**
   * Find the next available page number for auto-numbering
   * @param knowledgeBaseId The knowledge base ID to check existing pages
   */
  private async findNextPageNumber(knowledgeBaseId: string): Promise<number> {
    try {
      // Find all articles with titles matching "Page X" pattern
      const articles = await this.db.query.Article.findMany({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId),
          sql`${schema.Article.title} like 'Page %'`
        ),
        columns: { title: true },
      })
      if (articles.length === 0) return 1
      // Extract numbers from titles and find maximum
      const pageNumbers = articles
        .map((article) => {
          const match = article.title.match(/^Page (\d+)$/)
          return match ? parseInt(match[1], 10) : 0
        })
        .filter((num) => num > 0)
      return pageNumbers.length > 0 ? Math.max(...pageNumbers) + 1 : 1
    } catch (error) {
      logger.error('Error finding next page number', {
        knowledgeBaseId,
        organizationId: this.organizationId,
        error,
      })
      return 1 // Default to 1 if there's an error
    }
  }
  /**
   * Create a TRPCError with NOT_FOUND code
   */
  private createNotFoundError(message: string): TRPCError {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }
  /**
   * Verify knowledge base exists and belongs to the organization
   */
  private async verifyKnowledgeBaseExists(id: string): Promise<KnowledgeBase> {
    const knowledgeBase = await this.db.query.KnowledgeBase.findFirst({
      where: and(
        eq(schema.KnowledgeBase.id, id),
        eq(schema.KnowledgeBase.organizationId, this.organizationId)
      ),
    })
    if (!knowledgeBase) {
      throw this.createNotFoundError(`Knowledge base with ID '${id}' not found`)
    }
    return knowledgeBase
  }
  /**
   * Verify article exists and belongs to the organization
   */
  private async verifyArticleExists(id: string): Promise<Article> {
    const article = await this.db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, this.organizationId)),
    })
    if (!article) {
      throw this.createNotFoundError(`Article with ID '${id}' not found`)
    }
    return article
  }
  /**
   * Verify parent article exists in the knowledge base
   */
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
  /**
   * Handle errors consistently throughout the service
   */
  private handleError(error: any, logMessage: string, context: Record<string, any> = {}): never {
    if (error instanceof TRPCError) throw error
    logger.error(logMessage, { error, organizationId: this.organizationId, ...context })
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: logMessage, cause: error })
  }
  /**
   * Validate that a KB slug is available
   */
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
  /**
   * Validate that an article slug is available in the specified knowledge base
   */
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
  /**
   * Get the next order value for an article within its parent
   */
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
  /**
   * Generate a unique slug from a title
   * @param title The title to convert to a slug
   * @param knowledgeBaseId The knowledge base ID for uniqueness check
   * @param excludeId Optional article ID to exclude from uniqueness check
   */
  private async generateUniqueSlugFromTitle(
    title: string,
    knowledgeBaseId: string,
    excludeId?: string
  ): Promise<string> {
    // Create base slug - lowercase, replace spaces with hyphens, remove special chars
    const baseSlug = title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
    let slug = baseSlug
    let counter = 1
    let isUnique = false
    // Keep checking until we find a unique slug
    while (!isUnique) {
      // Check if this slug exists
      const existingArticle = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.slug, slug),
          excludeId ? ne(schema.Article.id, excludeId) : undefined
        ),
      })
      if (!existingArticle) {
        isUnique = true
      } else {
        // Append counter to make unique
        slug = `${baseSlug}-${counter}`
        counter++
      }
    }
    return slug
  }
  /**
   * Create a revision of an article
   */
  private async createArticleRevision(article: Article, editorId: string): Promise<void> {
    await this.db.insert(schema.ArticleRevision).values({
      articleId: (article as any).id,
      editorId,
      organizationId: this.organizationId,
      previousContent: (article as any).content,
      previousContentJson: (article as any).contentJson || undefined,
      wasCategory: (article as any).isCategory,
    })
  }
  async togglePublishArticle(id: string, isPublished: boolean) {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
      })
      if (!article) {
        throw this.createNotFoundError(`Article with ID '${id}' not found`)
      }
      const data = this.syncPublishedStatus({ isPublished })
      await this.db.update(schema.Article).set(data).where(eq(schema.Article.id, id))
      return { success: true }
    } catch (error) {
      return this.handleError(error, 'Error toggling article publish status', { articleId: id })
    }
  }
  /**
   * Sync isPublished status with ArticleStatus for consistency
   */
  private syncPublishedStatus(data: ArticleUpdateInput): any {
    const updateData: any = {}
    // Copy all defined values from data
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        updateData[key] = value
      }
    })
    // If status is set, sync isPublished
    if (updateData.status) {
      updateData.isPublished = updateData.status === ArticleStatus.PUBLISHED
    }
    // If isPublished is set, sync status
    if (typeof updateData.isPublished !== 'undefined' && updateData.isPublished !== null) {
      updateData.status = updateData.isPublished ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT
    }
    return updateData
  }
}
