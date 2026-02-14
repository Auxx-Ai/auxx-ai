import { database as db, schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api/article')
// Helper function to get article with tags and author
const getArticleWithRelations = async (whereCondition: any) => {
  // Get the article first
  const [article] = await db
    .select({
      id: schema.Article.id,
      title: schema.Article.title,
      content: schema.Article.content,
      status: schema.Article.status,
      createdAt: schema.Article.createdAt,
      updatedAt: schema.Article.updatedAt,
      viewsCount: schema.Article.viewsCount,
      authorId: schema.Article.authorId,
      organizationId: schema.Article.organizationId,
    })
    .from(schema.Article)
    .where(whereCondition)
    .limit(1)
  if (!article) return null
  // Get tags for this article
  const tags = await db
    .select({
      id: schema.ArticleTag.id,
      name: schema.ArticleTag.name,
    })
    .from(schema.TagsOnArticle)
    .leftJoin(schema.ArticleTag, eq(schema.TagsOnArticle.tagId, schema.ArticleTag.id))
    .where(eq(schema.TagsOnArticle.articleId, article.id))
  // Get author
  const [author] = await db
    .select({
      id: schema.User.id,
      name: schema.User.name,
    })
    .from(schema.User)
    .where(eq(schema.User.id, article.authorId!))
    .limit(1)
  // Get files
  const files = await db
    .select({
      id: schema.File.id,
      name: schema.File.name,
      type: schema.File.type,
      size: schema.File.size,
    })
    .from(schema.File)
    .where(and(eq(schema.File.entityId, article.id), eq(schema.File.entityType, 'Article')))
  return {
    ...article,
    tags: tags.map((t) => ({ tag: { name: t.name, id: t.id } })),
    author,
    files,
  }
}
export const articleRouter = createTRPCRouter({
  // getUser: protectedProcedure.input()
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1, 'Title is required'),
        content: z.string().min(1, 'Content is required'),
        categoryId: z.string().min(1, 'Category is required'),
        productId: z.string().optional(),
        tags: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { title, content } = input
      const userId = ctx.session.user.id
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId || !userId) {
        logger.error('Organization ID or User ID is required')
        return { error: 'Organization ID or User ID is required' }
      }
      const tags = input.tags ? input.tags.split(',').map((tag) => tag.toLowerCase().trim()) : []
      const result = await db.transaction(async (tx) => {
        // Create the article first
        const [createdArticle] = await tx
          .insert(schema.Article)
          .values({
            title,
            content,
            authorId: userId,
            organizationId,
            slug: title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, ''),
            knowledgeBaseId: 'default', // TODO: This should come from input or default KB
          })
          .returning({ id: schema.Article.id })
        // Handle tags
        for (const tagName of tags) {
          // Find or create the tag
          let [tag] = await tx
            .select()
            .from(schema.ArticleTag)
            .where(
              and(
                eq(schema.ArticleTag.name, tagName),
                eq(schema.ArticleTag.organizationId, organizationId)
              )
            )
            .limit(1)
          if (!tag) {
            const [newTag] = await tx
              .insert(schema.ArticleTag)
              .values({ name: tagName, organizationId })
              .returning()
            tag = newTag
          }
          // Link tag to article
          await tx
            .insert(schema.TagsOnArticle)
            .values({ articleId: createdArticle.id, tagId: tag.id })
        }
        return createdArticle
      })
      const article = result
      return { article }
    }),
  // Update this method too
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1, 'Title is required'),
        content: z.string().min(1, 'Content is required'),
        categoryId: z.string().min(1, 'Category is required'),
        tags: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, title, content, categoryId, tags } = input
      const { userId, organizationId } = ctx.session
      if (!organizationId || !userId) {
        return { error: 'Organization ID or User ID is required' }
      }
      const result = await db.transaction(async (tx) => {
        // Update article
        const [updatedArticle] = await tx
          .update(schema.Article)
          .set({ title, content })
          .where(and(eq(schema.Article.id, id), eq(schema.Article.organizationId, organizationId)))
          .returning()
        // Update tags if provided
        if (tags) {
          // First delete all existing tags for this article
          await tx.delete(schema.TagsOnArticle).where(eq(schema.TagsOnArticle.articleId, id))
          // Then create new tags
          const tagArray = tags.split(',').map((tag) => tag.toLowerCase().trim())
          for (const tagName of tagArray) {
            // Find or create the tag
            let [tag] = await tx
              .select()
              .from(schema.ArticleTag)
              .where(
                and(
                  eq(schema.ArticleTag.name, tagName),
                  eq(schema.ArticleTag.organizationId, organizationId)
                )
              )
              .limit(1)
            if (!tag) {
              const [newTag] = await tx
                .insert(schema.ArticleTag)
                .values({ name: tagName, organizationId })
                .returning()
              tag = newTag
            }
            // Connect tag to article
            await tx.insert(schema.TagsOnArticle).values({ articleId: id, tagId: tag.id })
          }
        }
        return updatedArticle
      })
      const article = result
      return { article }
    }),
  withCategories: protectedProcedure
    .input(
      z.object({
        cursor: z.number().optional(), // Cursor for pagination
        sortOrder: z.enum(['asc', 'desc']).default('desc'), // Sorting order
        orderBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'), // Sorting field
      })
    )
    .query(async ({ ctx }) => {
      const userId = ctx.session.user.id
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!userId || !organizationId) {
        return { error: 'User not found' }
      }
      // const categories = await ctx.db.articleCategory.findMany({
      //   where: { organizationId },
      //   select: { id: true, name: true, parentId: true, organizationId: true, createdAt: true },
      // })
      const tags = await db
        .select({ id: schema.ArticleTag.id, name: schema.ArticleTag.name })
        .from(schema.ArticleTag)
        .where(eq(schema.ArticleTag.organizationId, organizationId))
      // Get all articles for this organization
      const articles = await db
        .select({
          id: schema.Article.id,
          title: schema.Article.title,
          content: schema.Article.content,
          status: schema.Article.status,
          createdAt: schema.Article.createdAt,
          updatedAt: schema.Article.updatedAt,
          viewsCount: schema.Article.viewsCount,
          authorId: schema.Article.authorId,
        })
        .from(schema.Article)
        .where(eq(schema.Article.organizationId, organizationId))
      // Get tags for each article
      const articlesWithTags = await Promise.all(
        articles.map(async (article) => {
          const articleTags = await db
            .select({ name: schema.ArticleTag.name, id: schema.ArticleTag.id })
            .from(schema.TagsOnArticle)
            .leftJoin(schema.ArticleTag, eq(schema.TagsOnArticle.tagId, schema.ArticleTag.id))
            .where(eq(schema.TagsOnArticle.articleId, article.id))
          const [author] = await db
            .select({ id: schema.User.id, name: schema.User.name })
            .from(schema.User)
            .where(eq(schema.User.id, article.authorId!))
            .limit(1)
          const files = await db
            .select({
              id: schema.File.id,
              name: schema.File.name,
              type: schema.File.type,
              size: schema.File.size,
            })
            .from(schema.File)
            .where(and(eq(schema.File.entityId, article.id), eq(schema.File.entityType, 'Article')))
          return {
            ...article,
            tags: articleTags.map((t) => t.name),
            author,
            files,
          }
        })
      )
      return { articles: articlesWithTags, tags }
    }),
  all: protectedProcedure
    .input(
      z.object({
        cursor: z.number().optional(), // Cursor for pagination
        sortOrder: z.enum(['asc', 'desc']).default('desc'), // Sorting order
        orderBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'), // Sorting field
      })
    )
    .query(async ({ ctx, input }) => {
      const take = 100
      const orderBy = { [input.orderBy]: input.sortOrder }
      const cursor = input.cursor ? { id: input.cursor } : undefined
      const skip = input.cursor ? 1 : 0
      // Get articles with pagination
      const articles = await db
        .select({
          id: schema.Article.id,
          title: schema.Article.title,
          content: schema.Article.content,
          status: schema.Article.status,
          createdAt: schema.Article.createdAt,
          updatedAt: schema.Article.updatedAt,
          viewsCount: schema.Article.viewsCount,
          authorId: schema.Article.authorId,
        })
        .from(schema.Article)
        .orderBy(
          input.orderBy === 'createdAt'
            ? input.sortOrder === 'desc'
              ? desc(schema.Article.createdAt)
              : asc(schema.Article.createdAt)
            : input.sortOrder === 'desc'
              ? desc(schema.Article.updatedAt)
              : asc(schema.Article.updatedAt)
        )
        .limit(take + 1)
        .offset(input.cursor ? 1 : 0)
      // Handle pagination
      const hasMore = articles.length > take
      const resultArticles = hasMore ? articles.slice(0, take) : articles
      // Get tags for each article
      const articlesWithTags = await Promise.all(
        resultArticles.map(async (article) => {
          const articleTags = await db
            .select({ name: schema.ArticleTag.name, id: schema.ArticleTag.id })
            .from(schema.TagsOnArticle)
            .leftJoin(schema.ArticleTag, eq(schema.TagsOnArticle.tagId, schema.ArticleTag.id))
            .where(eq(schema.TagsOnArticle.articleId, article.id))
          const [author] = await db
            .select({ id: schema.User.id, name: schema.User.name })
            .from(schema.User)
            .where(eq(schema.User.id, article.authorId!))
            .limit(1)
          const files = await db
            .select({
              id: schema.File.id,
              name: schema.File.name,
              type: schema.File.type,
              size: schema.File.size,
            })
            .from(schema.File)
            .where(and(eq(schema.File.entityId, article.id), eq(schema.File.entityType, 'Article')))
          return {
            ...article,
            tags: articleTags.map((t) => t.name),
            author,
            files,
          }
        })
      )
      const nextCursor: number | null = hasMore
        ? (resultArticles[resultArticles.length - 1].id as unknown as number)
        : null
      return { articles: articlesWithTags, nextCursor }
    }),
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id
    const organizationId = ctx.session.user.defaultOrganizationId
    const { id } = input
    if (!userId || !organizationId) {
      logger.error('User not found', { userId })
      return { error: 'User not found' }
    }
    const article = await getArticleWithRelations(
      and(eq(schema.Article.id, id), eq(schema.Article.organizationId, organizationId))
    )
    if (!article) {
      logger.error('Article not found', { articleId: id })
      return { error: 'Article not found' }
    }
    // Transform tags to match expected format
    const formattedArticle = {
      ...article,
      tags: article.tags.map((tag) => tag.tag.name),
    }
    return { article: formattedArticle }
  }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const organizationId = ctx.session.user.defaultOrganizationId
      const { id } = input
      if (!organizationId || !userId) {
        logger.error('User not found', { userId })
        return { error: 'User not found' }
      }
      await db
        .delete(schema.Article)
        .where(and(eq(schema.Article.id, id), eq(schema.Article.organizationId, organizationId)))
      // const file = await ctx.db.article.update({
      //   where: { id: input.id, userId },
      //   data: { deletedAt: new Date(), deletedById: userId },
      // })
      return { success: true }
      // return { file }
    }),
  publish: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(ArticleStatus) }))
    .mutation(async ({ ctx, input }) => {
      const { id, status } = input
      const organizationId = ctx.session.user.defaultOrganizationId
      const userId = ctx.session.user.id
      if (!userId || !organizationId) {
        logger.error('User not found', { userId })
        return { error: 'User not found' }
      }
      const [article] = await db
        .update(schema.Article)
        .set({ status })
        .where(and(eq(schema.Article.id, id), eq(schema.Article.organizationId, organizationId)))
        .returning()
      return { article }
    }),
})
