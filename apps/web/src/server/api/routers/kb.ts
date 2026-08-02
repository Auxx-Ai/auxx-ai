// ~/server/api/routers/kb.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { getCachedUserInstanceGrants, onCacheEvent } from '@auxx/lib/cache'
import { getUserOrganizationId } from '@auxx/lib/email'
import { NotFoundError } from '@auxx/lib/errors'
import {
  articleToMarkdown,
  ensureLearnedKb,
  getLearnedArticleDiff,
  getLearnedProvenance,
  KBService,
  linkArticlesIntoKb,
} from '@auxx/lib/kb'
import {
  FeatureKey,
  FeaturePermissionService,
  PermissionKey,
  satisfiesRung,
} from '@auxx/lib/permissions'
import { getThreadLensBatch } from '@auxx/lib/permissions/visibility'
import { TRPCError } from '@trpc/server'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, notDemo } from '~/server/api/trpc'
import { fireKBRevalidate } from '~/server/lib/kb-revalidate'

/**
 * Resolve an article to its home KnowledgeBase — articles inherit their KB's
 * access level (doc 12 §0.5), so every article gate keys on the parent KB when
 * no explicit `knowledgeBaseId` is supplied. Org-scoped; 404s a missing/foreign
 * article. `Article.homeKnowledgeBaseId` is `notNull`.
 */
async function knowledgeBaseIdForArticle(
  db: Database,
  articleId: string,
  organizationId: string
): Promise<string> {
  const [row] = await db
    .select({ knowledgeBaseId: schema.Article.homeKnowledgeBaseId })
    .from(schema.Article)
    .where(and(eq(schema.Article.id, articleId), eq(schema.Article.organizationId, organizationId)))
    .limit(1)
  if (!row) throw new NotFoundError('Article not found')
  return row.knowledgeBaseId
}

/**
 * Resolve an article revision (version) → its article → home KnowledgeBase
 * (doc 12 §3.1). Version/rename ops carry only a `versionId`, so they gate on
 * the owning article's KB. Org-scoped; 404s a missing/foreign revision.
 */
async function knowledgeBaseIdForArticleVersion(
  db: Database,
  versionId: string,
  organizationId: string
): Promise<string> {
  const [row] = await db
    .select({ knowledgeBaseId: schema.Article.homeKnowledgeBaseId })
    .from(schema.ArticleRevision)
    .innerJoin(schema.Article, eq(schema.ArticleRevision.articleId, schema.Article.id))
    .where(
      and(
        eq(schema.ArticleRevision.id, versionId),
        eq(schema.ArticleRevision.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) throw new NotFoundError('Article version not found')
  return row.knowledgeBaseId
}

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
  contentJson: z.array(z.unknown()).nullish(),
  coverImageId: z.string().nullish(),
})

// Slug regex mirrors `toSlug` output — kebab, lowercase, no leading/trailing
// dashes. Hardens every caller (settings dialog, batch updates, tab dialog).
const articleStructureFieldsSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case lowercase (a-z, 0-9, -)')
    .optional(),
  parentId: z.string().nullish(),
  aiEnabled: z.boolean().optional(),
})

const articleKindSchema = z.enum(['page', 'category', 'header', 'tab', 'link'])

const articleCreateSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  slug: z.string().optional(),
  content: z.string().optional(),
  contentJson: z.array(z.unknown()).nullish(),
  excerpt: z.string().nullish(),
  emoji: z.string().nullish(),
  coverImageId: z.string().nullish(),
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
  byId: capabilityProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    // Read — viewing a KB and its articles.
    ctx.capabilities.assertViewInstance('kb', input.id)
    return await getKBService(ctx).getKnowledgeBaseById(input.id)
  }),

  list: capabilityProcedure.query(async ({ ctx }) => {
    // No coarse assert — filter the result to KBs the member may view (base-Edit
    // fallback per §0.2 passes every KB with no explicit row). A None member
    // simply gets an empty list, so the server-warmed page.tsx call never 403s.
    const kbs = await getKBService(ctx).listKnowledgeBases()
    return kbs.filter((kb: { id: string }) => ctx.capabilities.canViewInstance('kb', kb.id))
  }),

  /**
   * Idempotently provision the org's AI Memory KB (kind 'learned') and return
   * its id — the entry point for the "AI Memory" card on the KB landing page.
   */
  ensureLearnedMemory: capabilityProcedure.mutation(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
    }
    // Edit, not Full: this provisions ONE fixed, system-owned KB per org — it
    // is not KB management, and AI Memory is org knowledge every teammate can
    // read and correct (learned bundles likewise land unassigned in Today).
    // Full would lock the entry point to admins while the Member baseline
    // (`knowledgeBase: Edit`) is exactly the rung `upsert_learned_article`
    // asserts to write a memory.
    ctx.capabilities.assert(PermissionKey.knowledgeBaseEdit)
    await new FeaturePermissionService(ctx.db).requireAccess(
      organizationId,
      FeatureKey.learnedMemory
    )
    const { kb } = await ensureLearnedKb({ db: ctx.db, organizationId })
    return { id: kb.id }
  }),

  /**
   * Diff a proposed AI-memory rewrite against the article as published, for the
   * approval surfaces (Today card + in-chat card). A memory update replaces the
   * whole body, so the reviewer needs to see what the merge DROPS — a rendered
   * preview of the proposal alone cannot show that.
   */
  learnedArticleDiff: capabilityProcedure
    .input(z.object({ articleId: z.string(), markdown: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found',
        })
      }
      // Read-only over an article the viewer can already see in the memory
      // editor; the Read rung is the right bar.
      ctx.capabilities.assert(PermissionKey.knowledgeBaseView)
      // …but the area rung alone is NOT the bar: `articleId` is caller-supplied
      // and unconstrained to the learned KB, and `markdown: ''` renders the
      // target's entire published body as removed diff lines. That makes this a
      // full-content read of ANY article in the org. Gate the article's home KB
      // exactly as `kb.getArticleById` does.
      const knowledgeBaseId = await knowledgeBaseIdForArticle(
        ctx.db,
        input.articleId,
        organizationId
      )
      ctx.capabilities.assertViewInstance('kb', knowledgeBaseId)
      return getLearnedArticleDiff(ctx.db, {
        organizationId,
        articleId: input.articleId,
        markdown: input.markdown,
      })
    }),

  /**
   * The conversations a memory article was learned from — the reader for
   * `Article.learnedProvenance`. Answers "why does the AI believe this?", which
   * is the question anyone asks before deleting a memory.
   *
   * Two gates, because this crosses two authorities. The article's home KB
   * decides whether the viewer may ask the question at all (`articleId` is
   * caller-supplied and not constrained to the learned KB). The **mail lens**
   * then decides how much of each cited conversation comes back: a thread's
   * subject line is `identity`-tier (`permissions/visibility/lens.ts`), so a
   * viewer below that rung gets the entry with a `null` subject — the same
   * shape the UI already renders for a conversation that no longer exists.
   * KB access is never a licence to read mail.
   */
  learnedProvenance: capabilityProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found',
        })
      }
      ctx.capabilities.assert(PermissionKey.knowledgeBaseView)
      const knowledgeBaseId = await knowledgeBaseIdForArticle(
        ctx.db,
        input.articleId,
        organizationId
      )
      ctx.capabilities.assertViewInstance('kb', knowledgeBaseId)

      const sources = await getLearnedProvenance(ctx.db, {
        organizationId,
        articleId: input.articleId,
      })
      if (sources.length === 0) return sources

      const viewer = await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
      const lenses = await getThreadLensBatch(
        ctx.db,
        organizationId,
        viewer,
        sources.map((s) => s.threadId)
      )
      return sources.map((source) => ({
        ...source,
        subject: satisfiesRung(lenses.get(source.threadId) ?? 'none', 'identity')
          ? source.subject
          : null,
      }))
    }),

  create: capabilityProcedure.input(kbCreateSchema).mutation(async ({ ctx, input }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
    }
    // L2 area gate: creating a KB requires `knowledgeBase` Full (no instance
    // exists yet to key on). Plan-AND with the Layer-1 feature/limit gate below.
    ctx.capabilities.assert(PermissionKey.knowledgeBaseManage)
    await new FeaturePermissionService(ctx.db).requireAccessAndLimit(
      organizationId,
      FeatureKey.knowledgeBase,
      FeatureKey.knowledgeBases,
      async () => {
        const [row] = await ctx.db
          .select({ value: count() })
          .from(schema.KnowledgeBase)
          .where(eq(schema.KnowledgeBase.organizationId, organizationId))
        return row?.value ?? 0
      }
    )
    const result = await getKBService(ctx).createKnowledgeBase(input, ctx.session.user.id)
    await onCacheEvent('kb.created', { orgId: organizationId })
    return result
  }),

  update: capabilityProcedure
    .input(z.object({ id: z.string(), data: kbLiveFieldsSchema }))
    .mutation(async ({ ctx, input }) => {
      // Full — updating a KB's live settings (slug/domain/visibility).
      ctx.capabilities.assertAdminInstance('kb', input.id)
      const result = await getKBService(ctx).updateKnowledgeBase(input.id, input.data)
      void fireKBRevalidate(input.id)
      // Name/visibility feed the agent-prompt KB catalog.
      await onCacheEvent('kb.updated', { orgId: getUserOrganizationId(ctx.session) })
      return result
    }),

  updateDraftSettings: capabilityProcedure
    .input(z.object({ id: z.string(), patch: kbDraftSettingsSchema }))
    .mutation(async ({ ctx, input }) => {
      // Full — staging KB presentation settings.
      ctx.capabilities.assertAdminInstance('kb', input.id)
      // No revalidate — draft is admin-only.
      return await getKBService(ctx).updateDraftSettings(input.id, input.patch)
    }),

  publishPendingSettings: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .use(notDemo('publish knowledge base settings'))
    .mutation(async ({ ctx, input }) => {
      // Full — publishing staged KB settings.
      ctx.capabilities.assertAdminInstance('kb', input.id)
      const result = await getKBService(ctx).publishPendingSettings(input.id)
      void fireKBRevalidate(input.id)
      return result
    }),

  discardSettingsDraft: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Full — discarding staged KB settings.
      ctx.capabilities.assertAdminInstance('kb', input.id)
      // No revalidate — discard never affects the public site.
      return await getKBService(ctx).discardSettingsDraft(input.id)
    }),

  delete: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Full — deleting a KB and all its articles.
      ctx.capabilities.assertAdminInstance('kb', input.id)
      const result = await getKBService(ctx).deleteKnowledgeBase(input.id)
      const organizationId = getUserOrganizationId(ctx.session)
      await onCacheEvent('kb.deleted', { orgId: organizationId })
      return result
    }),

  // `status` and `visibility` are one user-facing choice ("who can see this
  // site"), so they are written together. The draft flush is NOT client
  // controlled — the service flushes only when the site is going live from
  // DRAFT, so editing access on a live site cannot ship unrelated presentation
  // drafts. Pending settings publish through `publishPendingSettings`.
  publishSite: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['PUBLISHED', 'UNLISTED']),
        visibility: z.enum(['PUBLIC', 'INTERNAL']).optional(),
      })
    )
    .use(notDemo('publish knowledge base'))
    .mutation(async ({ ctx, input }) => {
      // Full — turning the whole public KB site on (governance, §0.6).
      ctx.capabilities.assertAdminInstance('kb', input.id)
      const result = await getKBService(ctx).publishKnowledgeBase(input.id, input.status, {
        visibility: input.visibility,
      })
      void fireKBRevalidate(input.id)
      // Visibility feeds the agent-prompt KB catalog, same as `update`.
      await onCacheEvent('kb.updated', { orgId: getUserOrganizationId(ctx.session) })
      return result
    }),

  unpublishSite: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .use(notDemo('unpublish knowledge base'))
    .mutation(async ({ ctx, input }) => {
      // Full — turning the whole public KB site off (governance, §0.6).
      ctx.capabilities.assertAdminInstance('kb', input.id)
      const result = await getKBService(ctx).unpublishKnowledgeBase(input.id)
      void fireKBRevalidate(input.id)
      return result
    }),

  // ─── Articles ────────────────────────────────────────────────────

  getArticles: capabilityProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        includeUnpublished: z.boolean().optional().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      // Read — articles inherit their KB's access level.
      ctx.capabilities.assertViewInstance('kb', input.knowledgeBaseId)
      return await getKBService(ctx).getArticles(input.knowledgeBaseId, {
        includeUnpublished: input.includeUnpublished,
      })
    }),

  // Link individually-chosen `page` articles from any KB into this KB, placed under
  // `targetParentArticleId` (e.g. the active tab) or the KB root. Idempotent.
  linkArticles: capabilityProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string().min(1),
        articleIds: z.array(z.string().min(1)).min(1),
        targetParentArticleId: z.string().min(1).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found',
        })
      }
      // Write — linking articles mutates the target KB's membership.
      ctx.capabilities.assertEditInstance('kb', input.knowledgeBaseId)
      return linkArticlesIntoKb(ctx.db, organizationId, input.knowledgeBaseId, input.articleIds, {
        targetParentArticleId: input.targetParentArticleId,
      })
    }),

  getArticleById: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        knowledgeBaseId: z.string().optional(),
        versionNumber: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Read — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ??
        (await knowledgeBaseIdForArticle(ctx.db, input.id, getUserOrganizationId(ctx.session)))
      ctx.capabilities.assertViewInstance('kb', kbId)
      return await getKBService(ctx).getArticleById(
        input.id,
        input.knowledgeBaseId,
        input.versionNumber
      )
    }),

  getArticleBySlug: capabilityProcedure
    .input(z.object({ slug: z.string(), knowledgeBaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Read — articles inherit their KB's access level.
      ctx.capabilities.assertViewInstance('kb', input.knowledgeBaseId)
      return await getKBService(ctx).getArticleBySlug(input.slug, input.knowledgeBaseId)
    }),

  createArticle: capabilityProcedure
    .input(z.object({ knowledgeBaseId: z.string() }).and(articleCreateSchema))
    .mutation(async ({ ctx, input }) => {
      const { knowledgeBaseId, adjacentTo, position, ...articleData } = input
      // Write — creating an article in the target KB (article doesn't exist yet).
      ctx.capabilities.assertEditInstance('kb', knowledgeBaseId)
      const result = await getKBService(ctx).createArticle(
        knowledgeBaseId,
        articleData as Parameters<ReturnType<typeof getKBService>['createArticle']>[1],
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
  updateArticleDraft: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        data: articleDraftFieldsSchema,
        knowledgeBaseId: z.string().optional(),
        originatorSessionId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Guard managed (source-owned) articles at the user-facing edge only —
      // the article sink writes managed drafts through the lib fn directly, so
      // this must NOT live inside KBService. Detach (managed=false) re-opens edits.
      const organizationId = getUserOrganizationId(ctx.session)
      // Write — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ?? (await knowledgeBaseIdForArticle(ctx.db, input.id, organizationId))
      ctx.capabilities.assertEditInstance('kb', kbId)
      const target = await ctx.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, input.id),
          eq(schema.Article.organizationId, organizationId)
        ),
        columns: { managed: true },
      })
      if (target?.managed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This article is managed by a knowledge source. Detach it to edit.',
        })
      }
      return await getKBService(ctx).updateArticleDraft(
        input.id,
        input.data as Parameters<ReturnType<typeof getKBService>['updateArticleDraft']>[1],
        ctx.session.user.id,
        input.knowledgeBaseId,
        { originatorSessionId: input.originatorSessionId }
      )
    }),

  /**
   * Edit structural fields (slug/parentId/order). Live; revalidates.
   */
  updateArticleStructure: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        data: articleStructureFieldsSchema,
        knowledgeBaseId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Write — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ??
        (await knowledgeBaseIdForArticle(ctx.db, input.id, getUserOrganizationId(ctx.session)))
      ctx.capabilities.assertEditInstance('kb', kbId)
      const result = await getKBService(ctx).updateArticleStructure(
        input.id,
        input.data,
        input.knowledgeBaseId
      )
      if (input.knowledgeBaseId) void fireKBRevalidate(input.knowledgeBaseId)
      return result
    }),

  publishArticle: capabilityProcedure
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
      // Write — publishing an individual article (contributor action, §0.6).
      const kbId =
        input.knowledgeBaseId ?? (await knowledgeBaseIdForArticle(ctx.db, input.id, organizationId))
      ctx.capabilities.assertEditInstance('kb', kbId)
      const featureService = new FeaturePermissionService(ctx.db)
      const articleLimit = await featureService.getLimit(
        organizationId,
        FeatureKey.kbPublishedArticles
      )
      if (typeof articleLimit === 'number' && articleLimit >= 0) {
        const [currentRow] = await ctx.db
          .select({ value: count() })
          .from(schema.Article)
          .where(
            and(
              eq(schema.Article.organizationId, organizationId),
              eq(schema.Article.status, ArticleStatus.PUBLISHED)
            )
          )
        const cascadeTotal = input.ancestorIds.length + 1
        if ((currentRow?.value ?? 0) + cascadeTotal > articleLimit) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `You have reached your published article limit (${articleLimit}). Upgrade your plan to publish more articles.`,
          })
        }
      }
      const result = await getKBService(ctx).publishArticle(
        input.id,
        ctx.session.user.id,
        input.ancestorIds,
        input.knowledgeBaseId
      )
      await onCacheEvent('article.published', { orgId: organizationId })
      await revalidateForArticle(ctx, input.knowledgeBaseId, input.id)
      for (const ancestorId of input.ancestorIds) {
        await revalidateForArticle(ctx, input.knowledgeBaseId, ancestorId)
      }
      return result
    }),

  unpublishArticle: capabilityProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .use(notDemo('unpublish knowledge base articles'))
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      // Write — unpublishing an individual article (contributor action, §0.6).
      const kbId =
        input.knowledgeBaseId ?? (await knowledgeBaseIdForArticle(ctx.db, input.id, organizationId))
      ctx.capabilities.assertEditInstance('kb', kbId)
      const result = await getKBService(ctx).unpublishArticle(input.id, input.knowledgeBaseId)
      await onCacheEvent('article.unpublished', { orgId: organizationId })
      await revalidateForArticle(ctx, input.knowledgeBaseId, input.id)
      return result
    }),

  archiveArticle: capabilityProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .use(notDemo('archive knowledge base articles'))
    .mutation(async ({ ctx, input }) => {
      // Write — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ??
        (await knowledgeBaseIdForArticle(ctx.db, input.id, getUserOrganizationId(ctx.session)))
      ctx.capabilities.assertEditInstance('kb', kbId)
      const result = await getKBService(ctx).archiveArticle(input.id)
      await revalidateForArticle(ctx, input.knowledgeBaseId, input.id)
      return result
    }),

  unarchiveArticle: capabilityProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Write — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ??
        (await knowledgeBaseIdForArticle(ctx.db, input.id, getUserOrganizationId(ctx.session)))
      ctx.capabilities.assertEditInstance('kb', kbId)
      return await getKBService(ctx).unarchiveArticle(input.id)
    }),

  discardArticleDraft: capabilityProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Write — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ??
        (await knowledgeBaseIdForArticle(ctx.db, input.id, getUserOrganizationId(ctx.session)))
      ctx.capabilities.assertEditInstance('kb', kbId)
      return await getKBService(ctx).discardArticleDraft(input.id)
    }),

  restoreArticleVersion: capabilityProcedure
    .input(z.object({ versionId: z.string() }))
    .use(notDemo('restore knowledge base article version'))
    .mutation(async ({ ctx, input }) => {
      // Write — resolve version → article → home KB (§3.1).
      const kbId = await knowledgeBaseIdForArticleVersion(
        ctx.db,
        input.versionId,
        getUserOrganizationId(ctx.session)
      )
      ctx.capabilities.assertEditInstance('kb', kbId)
      return await getKBService(ctx).restoreArticleVersion(input.versionId, ctx.session.user.id)
    }),

  /**
   * Revert an article to its pre-Kopilot-turn snapshot. Backs the per-
   * turn Undo button on assistant messages. The optional `turnId`
   * pin scopes the revert to a specific turn — if a newer turn has
   * superseded it, this returns "turn_mismatch" and no-ops.
   */
  revertKopilotTurn: capabilityProcedure
    .input(z.object({ articleId: z.string(), turnId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      // Write — reviewing (undoing) a Kopilot turn's edits (§0.8).
      const kbId = await knowledgeBaseIdForArticle(ctx.db, input.articleId, organizationId)
      ctx.capabilities.assertEditInstance('kb', kbId)
      const { revertKopilotKbTurn } = await import(
        '@auxx/lib/ai/kopilot/capabilities/kb/tools/write-helpers'
      )
      const result = await revertKopilotKbTurn({
        db: ctx.db,
        organizationId,
        userId: ctx.session.user.id,
        articleId: input.articleId,
        expectedTurnId: input.turnId,
      })
      return result
    }),

  /**
   * Recover a pending Kopilot turn review for an article. Returns the pre-turn
   * snapshot's `base` content (the diff's "before" side; the editor already has
   * the current draft as the "after") or `null` when nothing is pending. Backs
   * the post-turn banner — both the live signal and recovery-on-mount after a
   * refresh (the snapshot survives reload, the agent event does not).
   */
  getKopilotTurnReview: capabilityProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      // Read — reviewing a Kopilot turn's pre-edit snapshot (§0.8). Snapshots are
      // keyed by articleId alone in Redis, so resolve → home KB and gate Read (a
      // guessed id can't read another org's / another KB's draft content).
      const kbId = await knowledgeBaseIdForArticle(ctx.db, input.articleId, organizationId)
      ctx.capabilities.assertViewInstance('kb', kbId)
      const article = await ctx.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, input.articleId),
          eq(schema.Article.organizationId, organizationId)
        ),
        columns: { id: true },
      })
      if (!article) return null
      const { readKopilotSnapshot } = await import('@auxx/lib/kb')
      const snapshot = await readKopilotSnapshot(input.articleId)
      if (!snapshot) return null
      return {
        turnId: snapshot.turnId,
        base: snapshot.contentJson,
        capturedAt: snapshot.capturedAt,
      }
    }),

  /**
   * Commit a Kopilot turn — the user is happy with the edits. Clears the
   * pre-turn snapshot (removes the Undo affordance); the lock was already
   * released by `finalizeKopilotKbTurn`. Turn-pinned: a stale Keep button won't
   * clobber a newer turn's snapshot.
   */
  keepKopilotTurn: capabilityProcedure
    .input(z.object({ articleId: z.string(), turnId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      // Write — committing (keeping) a Kopilot turn's edits (§0.8).
      const kbId = await knowledgeBaseIdForArticle(ctx.db, input.articleId, organizationId)
      ctx.capabilities.assertEditInstance('kb', kbId)
      const article = await ctx.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, input.articleId),
          eq(schema.Article.organizationId, organizationId)
        ),
        columns: { id: true },
      })
      if (!article) return { ok: false as const, reason: 'not_found' as const }
      const { readKopilotSnapshot, clearKopilotSnapshot } = await import('@auxx/lib/kb')
      const snapshot = await readKopilotSnapshot(input.articleId, input.turnId)
      if (!snapshot) {
        return {
          ok: false as const,
          reason: input.turnId ? ('turn_mismatch' as const) : ('no_snapshot' as const),
        }
      }
      await clearKopilotSnapshot(input.articleId)
      return { ok: true as const }
    }),

  moveArticle: capabilityProcedure
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
      // Write on the KB being reorganized; if the article's home KB differs
      // (a linked article), require Write on both (§3.3 "both KBs").
      ctx.capabilities.assertEditInstance('kb', knowledgeBaseId)
      const homeKbId = await knowledgeBaseIdForArticle(
        ctx.db,
        input.id,
        getUserOrganizationId(ctx.session)
      )
      if (homeKbId !== knowledgeBaseId) ctx.capabilities.assertEditInstance('kb', homeKbId)
      const result = await getKBService(ctx).moveArticle(knowledgeBaseId, rest)
      void fireKBRevalidate(knowledgeBaseId)
      return result
    }),

  updateArticlesBatch: capabilityProcedure
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
      // Write — batch article edits within the target KB.
      ctx.capabilities.assertEditInstance('kb', input.knowledgeBaseId)
      return await getKBService(ctx).updateArticlesBatch(
        input.knowledgeBaseId,
        input.articles as Parameters<ReturnType<typeof getKBService>['updateArticlesBatch']>[1]
      )
    }),

  deleteArticle: capabilityProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      // Write — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ?? (await knowledgeBaseIdForArticle(ctx.db, input.id, organizationId))
      ctx.capabilities.assertEditInstance('kb', kbId)
      const result = await getKBService(ctx).deleteArticle(input.id, input.knowledgeBaseId)
      await onCacheEvent('article.deleted', { orgId: organizationId })
      if (input.knowledgeBaseId) void fireKBRevalidate(input.knowledgeBaseId)
      return result
    }),

  getArticleVersions: capabilityProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Read — resolve → home KB (§3.1).
      const kbId = await knowledgeBaseIdForArticle(
        ctx.db,
        input.articleId,
        getUserOrganizationId(ctx.session)
      )
      ctx.capabilities.assertViewInstance('kb', kbId)
      return await getKBService(ctx).getArticleVersions(input.articleId)
    }),

  getArticleDiff: capabilityProcedure
    .input(
      z.object({
        articleId: z.string(),
        // Older side and newer side. Sentinels 'draft'/'published' or a revision id.
        base: z.string(),
        compare: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Read — resolve → home KB (§3.1).
      const kbId = await knowledgeBaseIdForArticle(
        ctx.db,
        input.articleId,
        getUserOrganizationId(ctx.session)
      )
      ctx.capabilities.assertViewInstance('kb', kbId)
      return await getKBService(ctx).getArticleDiff(input.articleId, input.base, input.compare)
    }),

  exportArticleMarkdown: capabilityProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Read — gate on the placement KB if supplied, else the article's home KB.
      const kbId =
        input.knowledgeBaseId ??
        (await knowledgeBaseIdForArticle(ctx.db, input.id, getUserOrganizationId(ctx.session)))
      ctx.capabilities.assertViewInstance('kb', kbId)
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

  renameArticleVersion: capabilityProcedure
    .input(z.object({ versionId: z.string(), label: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      // Write — resolve version → article → home KB (§3.1).
      const kbId = await knowledgeBaseIdForArticleVersion(
        ctx.db,
        input.versionId,
        getUserOrganizationId(ctx.session)
      )
      ctx.capabilities.assertEditInstance('kb', kbId)
      await getKBService(ctx).renameArticleVersion(input.versionId, input.label ?? null)
      return { success: true }
    }),
})
