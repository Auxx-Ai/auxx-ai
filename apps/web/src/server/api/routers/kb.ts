// ~/server/api/routers/kb.ts

import { schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { onCacheEvent } from '@auxx/lib/cache'
import { getUserOrganizationId } from '@auxx/lib/email'
import { articleToMarkdown, KBService } from '@auxx/lib/kb'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { TRPCError } from '@trpc/server'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'
import { fireKBRevalidate } from '~/server/lib/kb-revalidate'

// Live-only fields. Draftable presentation fields go through
// `kb.updateDraftSettings`.
const kbLiveFieldsSchema = z.object({
  slug: z.string().min(1).optional(),
  customDomain: z.string().nullish(),
  visibility: z.enum(['PUBLIC', 'INTERNAL']).optional(),
  publishStatus: z.enum(['DRAFT', 'PUBLISHED', 'UNLISTED']).optional(),
})

// Draftable subset — shallow-merged into KnowledgeBase.draftSettings.
const kbDraftSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  logoDark: z.string().nullish(),
  logoLight: z.string().nullish(),
  logoDarkId: z.string().nullish(),
  logoLightId: z.string().nullish(),
  theme: z.enum(['clean', 'muted', 'gradient', 'bold']).optional(),
  showMode: z.boolean().optional(),
  defaultMode: z.enum(['light', 'dark']).optional(),
  primaryColorLight: z.string().nullish(),
  primaryColorDark: z.string().nullish(),
  tintColorLight: z.string().nullish(),
  tintColorDark: z.string().nullish(),
  infoColorLight: z.string().nullish(),
  infoColorDark: z.string().nullish(),
  successColorLight: z.string().nullish(),
  successColorDark: z.string().nullish(),
  warningColorLight: z.string().nullish(),
  warningColorDark: z.string().nullish(),
  dangerColorLight: z.string().nullish(),
  dangerColorDark: z.string().nullish(),
  fontFamily: z.string().nullish(),
  iconsFamily: z.enum(['solid', 'regular', 'light']).optional(),
  cornerStyle: z.enum(['rounded', 'straight']).optional(),
  sidebarListStyle: z.enum(['default', 'pill', 'line']).optional(),
  searchbarPosition: z.enum(['center', 'corner']).optional(),
  headerEnabled: z.boolean().optional(),
  footerEnabled: z.boolean().optional(),
  headerNavigation: z.array(z.object({ title: z.string(), link: z.string() })).nullish(),
  footerNavigation: z.array(z.object({ title: z.string(), link: z.string() })).nullish(),
})

const kbCreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
})

const articleDraftFieldsSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  excerpt: z.string().nullish(),
  emoji: z.string().nullish(),
  content: z.string().optional(),
  contentJson: z.any().nullish(),
})

// Slug regex mirrors `toSlug` output — kebab, lowercase, no leading/trailing
// dashes. Hardens every caller (settings dialog, batch updates, tab dialog).
const articleStructureFieldsSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case lowercase (a-z, 0-9, -)')
    .optional(),
  parentId: z.string().nullish(),
})

const articleKindSchema = z.enum(['page', 'category', 'header', 'tab', 'link'])

const articleCreateSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  slug: z.string().optional(),
  content: z.string().optional(),
  contentJson: z.any().nullish(),
  excerpt: z.string().nullish(),
  emoji: z.string().nullish(),
  articleKind: articleKindSchema.optional(),
  parentId: z.string().nullish(),
  adjacentTo: z.string().optional(),
  position: z.enum(['before', 'after']).optional(),
})

const getKBService = (ctx: any) => {
  const organizationId = getUserOrganizationId(ctx.session)
  if (!organizationId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
  }
  return new KBService(ctx.db, organizationId)
}

async function revalidateForArticle(
  ctx: any,
  knowledgeBaseId: string | undefined,
  articleId: string | undefined
) {
  if (!knowledgeBaseId) return
  let slugPath: string | undefined
  if (articleId) {
    try {
      slugPath = await getKBService(ctx).getArticleSlugPath(articleId)
    } catch {
      // best-effort; don't block the mutation
    }
  }
  void fireKBRevalidate(knowledgeBaseId, slugPath)
}

export const knowledgeBaseRouter = createTRPCRouter({
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return await getKBService(ctx).getKnowledgeBaseById(input.id)
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return await getKBService(ctx).listKnowledgeBases()
  }),

  create: protectedProcedure.input(kbCreateSchema).mutation(async ({ ctx, input }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
    }
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
    const result = await getKBService(ctx).createKnowledgeBase(input, ctx.session.user.id)
    await onCacheEvent('kb.created', { orgId: organizationId })
    return result
  }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), data: kbLiveFieldsSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).updateKnowledgeBase(input.id, input.data)
      void fireKBRevalidate(input.id)
      return result
    }),

  updateDraftSettings: protectedProcedure
    .input(z.object({ id: z.string(), patch: kbDraftSettingsSchema }))
    .mutation(async ({ ctx, input }) => {
      // No revalidate — draft is admin-only.
      return await getKBService(ctx).updateDraftSettings(input.id, input.patch)
    }),

  publishPendingSettings: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(notDemo('publish knowledge base settings'))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).publishPendingSettings(input.id)
      void fireKBRevalidate(input.id)
      return result
    }),

  discardSettingsDraft: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // No revalidate — discard never affects the public site.
      return await getKBService(ctx).discardSettingsDraft(input.id)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).deleteKnowledgeBase(input.id)
      const organizationId = getUserOrganizationId(ctx.session)
      await onCacheEvent('kb.deleted', { orgId: organizationId })
      return result
    }),

  publishSite: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(['PUBLISHED', 'UNLISTED']) }))
    .use(notDemo('publish knowledge base'))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).publishKnowledgeBase(input.id, input.status)
      void fireKBRevalidate(input.id)
      return result
    }),

  unpublishSite: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(notDemo('unpublish knowledge base'))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).unpublishKnowledgeBase(input.id)
      void fireKBRevalidate(input.id)
      return result
    }),

  // ─── Articles ────────────────────────────────────────────────────

  getArticles: protectedProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        includeUnpublished: z.boolean().optional().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      return await getKBService(ctx).getArticles(input.knowledgeBaseId, {
        includeUnpublished: input.includeUnpublished,
      })
    }),

  getArticleById: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        knowledgeBaseId: z.string().optional(),
        versionNumber: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await getKBService(ctx).getArticleById(
        input.id,
        input.knowledgeBaseId,
        input.versionNumber
      )
    }),

  getArticleBySlug: protectedProcedure
    .input(z.object({ slug: z.string(), knowledgeBaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await getKBService(ctx).getArticleBySlug(input.slug, input.knowledgeBaseId)
    }),

  createArticle: protectedProcedure
    .input(z.object({ knowledgeBaseId: z.string() }).and(articleCreateSchema))
    .mutation(async ({ ctx, input }) => {
      const { knowledgeBaseId, adjacentTo, position, ...articleData } = input
      const result = await getKBService(ctx).createArticle(
        knowledgeBaseId,
        articleData,
        ctx.session.user.id,
        adjacentTo && position ? { adjacentId: adjacentTo, position } : undefined
      )
      void fireKBRevalidate(knowledgeBaseId)
      return result
    }),

  /**
   * Edit the draft revision in place (title/description/excerpt/emoji/content).
   * Marks the article as having unpublished changes. Public site is NOT
   * revalidated — drafts aren't public.
   */
  updateArticleDraft: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: articleDraftFieldsSchema,
        knowledgeBaseId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await getKBService(ctx).updateArticleDraft(
        input.id,
        input.data,
        ctx.session.user.id,
        input.knowledgeBaseId
      )
    }),

  /**
   * Edit structural fields (slug/parentId/order). Live; revalidates.
   */
  updateArticleStructure: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: articleStructureFieldsSchema,
        knowledgeBaseId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).updateArticleStructure(
        input.id,
        input.data,
        input.knowledgeBaseId
      )
      if (input.knowledgeBaseId) void fireKBRevalidate(input.knowledgeBaseId)
      return result
    }),

  publishArticle: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        knowledgeBaseId: z.string().optional(),
        ancestorIds: z.array(z.string()).default([]),
      })
    )
    .use(notDemo('publish knowledge base articles'))
    .mutation(async ({ ctx, input }) => {
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
        const cascadeTotal = input.ancestorIds.length + 1
        if (current + cascadeTotal > articleLimit) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `You have reached your published article limit (${articleLimit}). Upgrade your plan to publish more articles.`,
          })
        }
      }
      const result = await getKBService(ctx).publishArticle(
        input.id,
        ctx.session.user.id,
        input.ancestorIds
      )
      await onCacheEvent('article.published', { orgId: organizationId })
      await revalidateForArticle(ctx, input.knowledgeBaseId, input.id)
      for (const ancestorId of input.ancestorIds) {
        await revalidateForArticle(ctx, input.knowledgeBaseId, ancestorId)
      }
      return result
    }),

  unpublishArticle: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .use(notDemo('unpublish knowledge base articles'))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).unpublishArticle(input.id)
      const organizationId = getUserOrganizationId(ctx.session)
      await onCacheEvent('article.unpublished', { orgId: organizationId })
      await revalidateForArticle(ctx, input.knowledgeBaseId, input.id)
      return result
    }),

  archiveArticle: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .use(notDemo('archive knowledge base articles'))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).archiveArticle(input.id)
      await revalidateForArticle(ctx, input.knowledgeBaseId, input.id)
      return result
    }),

  unarchiveArticle: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return await getKBService(ctx).unarchiveArticle(input.id)
    }),

  discardArticleDraft: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return await getKBService(ctx).discardArticleDraft(input.id)
    }),

  restoreArticleVersion: protectedProcedure
    .input(z.object({ versionId: z.string() }))
    .use(notDemo('restore knowledge base article version'))
    .mutation(async ({ ctx, input }) => {
      return await getKBService(ctx).restoreArticleVersion(input.versionId, ctx.session.user.id)
    }),

  moveArticle: protectedProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        id: z.string(),
        parentId: z.string().nullable(),
        sortOrder: z.string().optional(),
        adjacentId: z.string().optional(),
        position: z.enum(['before', 'after']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { knowledgeBaseId, ...rest } = input
      const result = await getKBService(ctx).moveArticle(knowledgeBaseId, rest)
      void fireKBRevalidate(knowledgeBaseId)
      return result
    }),

  updateArticlesBatch: protectedProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        articles: z.array(
          z.object({
            id: z.string(),
            updates: articleStructureFieldsSchema.merge(articleDraftFieldsSchema),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await getKBService(ctx).updateArticlesBatch(input.knowledgeBaseId, input.articles)
    }),

  deleteArticle: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getKBService(ctx).deleteArticle(input.id, input.knowledgeBaseId)
      const organizationId = getUserOrganizationId(ctx.session)
      await onCacheEvent('article.deleted', { orgId: organizationId })
      if (input.knowledgeBaseId) void fireKBRevalidate(input.knowledgeBaseId)
      return result
    }),

  getArticleVersions: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await getKBService(ctx).getArticleVersions(input.articleId)
    }),

  exportArticleMarkdown: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const article = await getKBService(ctx).getArticleById(input.id, input.knowledgeBaseId)
      if (article.articleKind === 'link') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Link articles have no body to export.',
        })
      }
      const fallback = (article.slug || article.title || 'article').replace(/[^a-z0-9-_]+/gi, '-')
      const filename = `${fallback}.md`
      const markdown = articleToMarkdown({
        title: article.title,
        contentJson: article.contentJson,
      })
      const header =
        article.title && article.title.trim().length > 0 ? `# ${article.title}\n\n` : ''
      return { filename, markdown: header + markdown }
    }),

  renameArticleVersion: protectedProcedure
    .input(z.object({ versionId: z.string(), label: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      await getKBService(ctx).renameArticleVersion(input.versionId, input.label ?? null)
      return { success: true }
    }),
})
