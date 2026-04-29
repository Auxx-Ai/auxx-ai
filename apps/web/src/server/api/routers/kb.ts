// ~/server/api/routers/kb.ts

import { schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { onCacheEvent } from '@auxx/lib/cache'
import { getUserOrganizationId } from '@auxx/lib/email'
import { KBService } from '@auxx/lib/kb'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { TRPCError } from '@trpc/server'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'
import { fireKBRevalidate } from '~/server/lib/kb-revalidate'

// Base knowledge base fields schema
const kbFieldsSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
  // Original fields
  // primaryColor: z.string().optional(),
  // logo: z.string().optional(),
  customDomain: z.string().optional(),
  // New logo fields
  logoDark: z.string().optional(),
  logoLight: z.string().optional(),
  // Theme settings
  theme: z.enum(['clean', 'muted', 'gradient', 'bold']).optional(),
  showMode: z.boolean().optional(),
  defaultMode: z.enum(['light', 'dark']).optional(),
  // Color scheme
  primaryColorLight: z.string().optional(),
  primaryColorDark: z.string().optional(),
  tintColorLight: z.string().optional(),
  tintColorDark: z.string().optional(),
  infoColorLight: z.string().optional(),
  infoColorDark: z.string().optional(),
  successColorLight: z.string().optional(),
  successColorDark: z.string().optional(),
  warningColorLight: z.string().optional(),
  warningColorDark: z.string().optional(),
  dangerColorLight: z.string().optional(),
  dangerColorDark: z.string().optional(),
  // UI styling
  fontFamily: z.string().optional(),
  iconsFamily: z.enum(['solid', 'regular', 'light']).optional(),
  cornerStyle: z.enum(['rounded', 'straight']).optional(),
  sidebarListStyle: z.enum(['default', 'pill', 'line']).optional(),
  searchbarPosition: z.enum(['center', 'corner']).optional(),
  // Navigation
  headerNavigation: z.array(z.object({ title: z.string(), link: z.string() })).optional(),
  footerNavigation: z.array(z.object({ title: z.string(), link: z.string() })).optional(),
})
// Create schema requires name and slug to be required
const kbCreateSchema = kbFieldsSchema.extend({ name: z.string().min(1), slug: z.string().min(1) })
// Article schema with common fields
const articleFieldsSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  slug: z.string().min(1).optional(),
  content: z.string().optional(),
  contentJson: z.any().nullish(),
  excerpt: z.string().nullish(),
  emoji: z.string().nullish(),
  isCategory: z.boolean().optional(),
  parentId: z.string().nullish(),
  isPublished: z.boolean().optional(),
  status: z.enum([ArticleStatus.DRAFT, ArticleStatus.PUBLISHED, ArticleStatus.ARCHIVED]).optional(),
})
// Create schema requires title and slug
const articleCreateSchema = articleFieldsSchema.extend({
  // title: z.string().min(1),
  // slug: z.string().min(1),
  adjacentTo: z.string().optional(),
  position: z.enum(['before', 'after']).optional(),
})
// Helper to get KBService instance with proper authorization
const getKBService = (ctx: any) => {
  const organizationId = getUserOrganizationId(ctx.session)
  if (!organizationId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
  }
  return new KBService(ctx.db, organizationId)
}
export const knowledgeBaseRouter = createTRPCRouter({
  /**
   * Get a knowledge base by ID
   */
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const kbService = getKBService(ctx)
    return await kbService.getKnowledgeBaseById(input.id)
  }),
  /**
   * Get all knowledge bases for the current organization
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const kbService = getKBService(ctx)
    return await kbService.listKnowledgeBases()
  }),
  /**
   * Create a new knowledge base
   */
  create: protectedProcedure.input(kbCreateSchema).mutation(async ({ ctx, input }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
    }

    // Feature gate: check KB access + limit
    await new FeaturePermissionService(ctx.db).requireAccessAndLimit(
      organizationId,
      FeatureKey.knowledgeBase,
      FeatureKey.knowledgeBases,
      async () => {
        const [{ value }] = await ctx.db
          .select({ value: count() })
          .from(schema.KnowledgeBase)
          .where(eq(schema.KnowledgeBase.organizationId, organizationId))
        return value
      }
    )

    const kbService = getKBService(ctx)
    const result = await kbService.createKnowledgeBase(input, ctx.session.user.id)
    await onCacheEvent('kb.created', { orgId: organizationId })
    return result
  }),
  /**
   * Update a knowledge base
   */
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: kbFieldsSchema }))
    .mutation(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      const result = await kbService.updateKnowledgeBase(input.id, input.data)
      void fireKBRevalidate(input.id)
      return result
    }),
  /**
   * Delete a knowledge base
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      const result = await kbService.deleteKnowledgeBase(input.id)
      const organizationId = getUserOrganizationId(ctx.session)
      await onCacheEvent('kb.deleted', { orgId: organizationId })
      return result
    }),
  /**
   * Get all articles for a knowledge base
   */
  getArticles: protectedProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        includeUnpublished: z.boolean().optional().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      return await kbService.getArticles(input.knowledgeBaseId, {
        includeUnpublished: input.includeUnpublished,
      })
    }),
  /**
   * Get a single article by ID
   */
  getArticleById: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      return await kbService.getArticleById(input.id, input.knowledgeBaseId)
    }),
  /**
   * Get a single article by slug
   */
  getArticleBySlug: protectedProcedure
    .input(z.object({ slug: z.string(), knowledgeBaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      return await kbService.getArticleBySlug(input.slug, input.knowledgeBaseId)
    }),
  /**
   * Create a new article
   */
  createArticle: protectedProcedure
    .input(z.object({ knowledgeBaseId: z.string() }).and(articleCreateSchema))
    .mutation(async ({ ctx, input }) => {
      // const { knowledgeBaseId, ...articleData } = input
      const { knowledgeBaseId, adjacentTo, position, ...articleData } = input
      const kbService = getKBService(ctx)
      const result = await kbService.createArticle(
        knowledgeBaseId,
        articleData,
        ctx.session.user.id,
        adjacentTo && position ? { adjacentId: adjacentTo, position } : undefined
      )
      void fireKBRevalidate(knowledgeBaseId)
      return result
    }),
  /**
   * Update an article
   */
  updateArticle: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: articleFieldsSchema,
        knowledgeBaseId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      const result = await kbService.updateArticle(
        input.id,
        input.data,
        ctx.session.user.id,
        input.knowledgeBaseId
      )
      if (input.knowledgeBaseId) void fireKBRevalidate(input.knowledgeBaseId)
      return result
    }),
  publishArticle: protectedProcedure
    .input(
      z.object({ id: z.string(), knowledgeBaseId: z.string().optional(), isPublished: z.boolean() })
    )
    .use(notDemo('publish knowledge base articles'))
    .mutation(async ({ ctx, input }) => {
      // Only enforce limit when publishing (not unpublishing)
      if (input.isPublished) {
        const organizationId = getUserOrganizationId(ctx.session)
        const featureService = new FeaturePermissionService(ctx.db)
        const articleLimit = await featureService.getLimit(
          organizationId,
          FeatureKey.kbPublishedArticles
        )
        if (typeof articleLimit === 'number' && articleLimit >= 0) {
          const [{ value: current }] = await ctx.db
            .select({ value: count() })
            .from(schema.Article)
            .where(
              and(
                eq(schema.Article.organizationId, organizationId),
                eq(schema.Article.status, ArticleStatus.PUBLISHED)
              )
            )
          if (current >= articleLimit) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: `You have reached your published article limit (${articleLimit}). Upgrade your plan to publish more articles.`,
            })
          }
        }
      }
      const kbService = getKBService(ctx)
      const result = await kbService.togglePublishArticle(input.id, input.isPublished)
      await onCacheEvent(input.isPublished ? 'article.published' : 'article.unpublished', {
        orgId: organizationId,
      })
      if (input.knowledgeBaseId) void fireKBRevalidate(input.knowledgeBaseId)
      return result
    }),
  /**
   * Update multiple articles in batch (for reordering, structure changes)
   */
  updateArticlesBatch: protectedProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        articles: z.array(z.object({ id: z.string(), updates: articleFieldsSchema })),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      return await kbService.updateArticlesBatch(
        input.knowledgeBaseId,
        input.articles,
        ctx.session.user.id
      )
    }),
  updateArticleOrder: protectedProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        articles: z.array(
          z.object({ id: z.string(), parentId: z.string().nullable(), order: z.number() })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { articles } = input
      // Update each article in a transaction
      await ctx.db.transaction(async (tx) => {
        for (const article of articles) {
          await tx
            .update(schema.Article)
            .set({ parentId: article.parentId, order: article.order })
            .where(eq(schema.Article.id, article.id))
        }
      })
      return { success: true }
    }),
  /**
   * Delete an article
   */
  deleteArticle: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      const result = await kbService.deleteArticle(input.id, input.knowledgeBaseId)
      const organizationId = getUserOrganizationId(ctx.session)
      await onCacheEvent('article.deleted', { orgId: organizationId })
      if (input.knowledgeBaseId) void fireKBRevalidate(input.knowledgeBaseId)
      return result
    }),
  /**
   * Get article revision history
   */
  getArticleRevisions: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const kbService = getKBService(ctx)
      return await kbService.getArticleRevisions(input.articleId)
    }),
})
