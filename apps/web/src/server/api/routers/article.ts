import { database as db, schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api/article')
const getArticleWithRelations = async (whereCondition: any) => {
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
  const [author] = await db
    .select({
      id: schema.User.id,
      name: schema.User.name,
    })
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
      const [article] = await db
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
      return { article }
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1, 'Title is required'),
        content: z.string().min(1, 'Content is required'),
        categoryId: z.string().min(1, 'Category is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, title, content } = input
      const { userId, organizationId } = ctx.session
      if (!organizationId || !userId) {
        return { error: 'Organization ID or User ID is required' }
      }
      const [article] = await db
        .update(schema.Article)
        .set({ title, content })
        .where(and(eq(schema.Article.id, id), eq(schema.Article.organizationId, organizationId)))
        .returning()
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
      const articlesWithRelations = await Promise.all(
        articles.map(async (article) => {
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
          return { ...article, author, files }
        })
      )
      return { articles: articlesWithRelations }
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
      const articlesWithRelations = await Promise.all(
        resultArticles.map(async (article) => {
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
          return { ...article, author, files }
        })
      )
      const nextCursor: number | null = hasMore
        ? (resultArticles[resultArticles.length - 1].id as unknown as number)
        : null
      return { articles: articlesWithRelations, nextCursor }
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
    return { article }
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
      await onCacheEvent('article.deleted', { orgId: organizationId })
      return { success: true }
    }),
  publish: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(ArticleStatus) }))
    .use(notDemo('publish articles'))
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
      if (status === 'PUBLISHED') {
        await onCacheEvent('article.published', { orgId: organizationId })
      } else {
        await onCacheEvent('article.unpublished', { orgId: organizationId })
      }
      return { article }
    }),
})
