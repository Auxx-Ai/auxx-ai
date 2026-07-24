// apps/web/src/server/api/routers/knowledge-sources.ts
// tRPC surface for Knowledge Sources. Manual connector (Phase 1) + the website crawler:
// discovery procedures (checkUrl/getSitemapTree/findSubdomains) back the wizard, and
// `create` accepts a website source whose config holds the crawl selection.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { getUserOrganizationId } from '@auxx/lib/email'
import { ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import { detachArticleFromSource } from '@auxx/lib/kb'
import {
  createSource,
  deleteSource,
  enqueueSourceSync,
  getCrawlProvider,
  getSource,
  listSourceLinks,
  listSources,
  pauseSource,
  resumeSource,
  unlinkSourceArticleFromKb,
  unlinkSourceFromKb,
  updateSource,
} from '@auxx/lib/knowledge-sources'
import { type CapabilitySet, PermissionKey } from '@auxx/lib/permissions'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

function requireOrgId(session: Parameters<typeof getUserOrganizationId>[0]): string {
  const organizationId = getUserOrganizationId(session)
  if (!organizationId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
  }
  return organizationId
}

// ── Knowledge-source → KB(s) access resolution (doc 12 §3.3) ──────────────────
// A source feeds one-or-more user-facing KBs (M:N). Sources have no L2 area of
// their own; they inherit the KBs they link into:
//   reads          → Read on ANY linked KB (link-less → creator/admin)
//   per-link ops   → Write on THAT KB (gated inline at the call site)
//   source-global  → Write on ALL linked KBs (link-less → creator/admin)

/** The user-facing KBs a source links into (excludes its owned hidden KB). */
async function linkedKbIds(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<string[]> {
  const links = await listSourceLinks(db, organizationId, sourceId)
  return links.map((k) => k.id)
}

/** A link-less source falls back to its creator or an org admin/owner. */
function isSourceCreatorOrAdmin(
  capabilities: CapabilitySet,
  userId: string,
  source: { createdById?: string | null }
): boolean {
  return (
    capabilities.role === 'OWNER' ||
    capabilities.role === 'ADMIN' ||
    (source.createdById != null && source.createdById === userId)
  )
}

/** Read visibility for a source: Read on ≥1 linked KB, or (link-less) creator/admin. */
async function canReadSource(
  db: Database,
  capabilities: CapabilitySet,
  userId: string,
  organizationId: string,
  source: { id: string; createdById?: string | null }
): Promise<boolean> {
  const kbIds = await linkedKbIds(db, organizationId, source.id)
  if (kbIds.length === 0) return isSourceCreatorOrAdmin(capabilities, userId, source)
  return kbIds.some((id) => capabilities.canViewInstance('kb', id))
}

/** Throwing read guard — resolves the source (org-scoped) then applies {@link canReadSource}. */
async function assertCanReadSource(
  db: Database,
  capabilities: CapabilitySet,
  userId: string,
  organizationId: string,
  sourceId: string
): Promise<void> {
  const source = await getSource(db, organizationId, sourceId)
  if (await canReadSource(db, capabilities, userId, organizationId, source)) return
  throw new ForbiddenError("You don't have permission to view this knowledge source.")
}

/**
 * Source-global write guard: Write on ALL linked KBs (deny if any lacks it). A
 * link-less source (freshly created, pre-sync) falls back to creator/admin.
 */
async function assertCanManageSource(
  db: Database,
  capabilities: CapabilitySet,
  userId: string,
  organizationId: string,
  sourceId: string
): Promise<void> {
  const source = await getSource(db, organizationId, sourceId)
  const kbIds = await linkedKbIds(db, organizationId, source.id)
  if (kbIds.length === 0) {
    if (isSourceCreatorOrAdmin(capabilities, userId, source)) return
    throw new ForbiddenError("You don't have permission to manage this knowledge source.")
  }
  for (const id of kbIds) capabilities.assertEditInstance('kb', id)
}

/** Resolve an article to its home KB (for `detachArticle`, which carries only an articleId). */
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

const manualItemSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  markdown: z.string(),
  path: z.string().optional(),
})

const surfaceSchema = z.enum(['publishable', 'ai-only']).default('publishable')

const intervalCount = z.union([z.number(), z.string()]).optional()

/**
 * ScheduledTriggerConfig (the shared agent/workflow frequency model). The `minutes`
 * interval is rejected — the floor is hourly so nobody schedules a credit-burning
 * per-minute crawl (custom cron is left to advanced users).
 */
const scheduleConfigSchema = z
  .object({
    triggerInterval: z.enum(['minutes', 'hours', 'days', 'weeks', 'custom']),
    timeBetweenTriggers: z.object({
      minutes: intervalCount,
      hours: intervalCount,
      days: intervalCount,
      weeks: intervalCount,
      isConstant: z.boolean().optional(),
    }),
    customCron: z.string().optional(),
    timezone: z.string().optional(),
  })
  .refine((c) => c.triggerInterval !== 'minutes', {
    message: 'Minimum sync cadence is hourly.',
  })

const scheduleFields = {
  syncBehavior: z.enum(['manual', 'scheduled']).optional(),
  scheduleConfig: scheduleConfigSchema.nullish(),
}

const manualSourceSchema = z.object({
  name: z.string().min(1),
  type: z.literal('manual'),
  surface: surfaceSchema,
  config: z.object({ items: z.array(manualItemSchema).default([]) }).default({ items: [] }),
  ...scheduleFields,
})

const websiteSourceSchema = z.object({
  name: z.string().min(1),
  type: z.literal('website'),
  surface: surfaceSchema,
  config: z.object({
    url: z.string().url(),
    selectedPaths: z.array(z.string()).default([]),
    includeUrls: z.array(z.string()).optional(),
    excludeUrls: z.array(z.string()).optional(),
    mainContentOnly: z.boolean().default(true),
    maxPages: z.number().int().positive().optional(),
  }),
  ...scheduleFields,
})

const createSchema = z.discriminatedUnion('type', [manualSourceSchema, websiteSourceSchema])

export const knowledgeSourceRouter = createTRPCRouter({
  list: capabilityProcedure.query(async ({ ctx }) => {
    const organizationId = requireOrgId(ctx.session)
    const userId = ctx.session.user.id
    const sources = await listSources(ctx.db, organizationId)
    // Filter to sources with ≥1 viewable linked KB (link-less → creator/admin).
    const visible: typeof sources = []
    for (const source of sources) {
      if (await canReadSource(ctx.db, ctx.capabilities, userId, organizationId, source)) {
        visible.push(source)
      }
    }
    return visible
  }),

  getById: capabilityProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const organizationId = requireOrgId(ctx.session)
    await assertCanReadSource(
      ctx.db,
      ctx.capabilities,
      ctx.session.user.id,
      organizationId,
      input.id
    )
    return getSource(ctx.db, organizationId, input.id)
  }),

  getStatus: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      await assertCanReadSource(
        ctx.db,
        ctx.capabilities,
        ctx.session.user.id,
        organizationId,
        input.id
      )
      const source = await getSource(ctx.db, organizationId, input.id)
      return {
        status: source.status,
        lastSyncedAt: source.lastSyncedAt,
        itemCount: source.itemCount,
        error: source.error,
      }
    }),

  create: capabilityProcedure.input(createSchema).mutation(async ({ ctx, input }) => {
    if (input.surface === 'ai-only') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'AI-only sources are not available yet (Phase 4)',
      })
    }
    const organizationId = requireOrgId(ctx.session)
    // A brand-new source names no KB (links happen post-sync from the KB side),
    // so there's no instance to key on. Gate on the coarse source-setup
    // capability: the member must hold `knowledgeBase.edit` (§3.3).
    ctx.capabilities.assert(PermissionKey.knowledgeBaseEdit)
    // Linking is a post-sync, per-article action (from the KB side) — there are no
    // articles to pick until the first sync completes, so create never pre-links.
    return createSource(ctx.db, organizationId, {
      name: input.name,
      type: input.type,
      surface: input.surface,
      config: input.config,
      syncBehavior: input.syncBehavior,
      scheduleConfig: input.scheduleConfig,
      createdById: ctx.session.user.id,
    })
  }),

  update: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        // Connector config (url / selectedPaths / mainContentOnly / …). Replaced
        // wholesale, so the settings form must send the full object.
        config: z.record(z.string(), z.unknown()).optional(),
        ...scheduleFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      const organizationId = requireOrgId(ctx.session)
      // Source-global config change → Write on ALL linked KBs (§3.3).
      await assertCanManageSource(ctx.db, ctx.capabilities, ctx.session.user.id, organizationId, id)
      // Selecting "Manual only" clears the cadence so the scheduler is removed.
      const scheduleConfig =
        patch.syncBehavior === 'manual' ? null : (patch.scheduleConfig ?? undefined)
      return updateSource(ctx.db, organizationId, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.config !== undefined ? { config: patch.config } : {}),
        ...(patch.syncBehavior !== undefined ? { syncBehavior: patch.syncBehavior } : {}),
        ...(scheduleConfig !== undefined ? { scheduleConfig } : {}),
      })
    }),

  // ── Linking a source's content into user-facing KBs ───────────────────────

  listLinks: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      await assertCanReadSource(
        ctx.db,
        ctx.capabilities,
        ctx.session.user.id,
        organizationId,
        input.id
      )
      return listSourceLinks(ctx.db, organizationId, input.id)
    }),

  // Remove one linked article's placement from a KB (source content untouched).
  unlinkArticle: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        knowledgeBaseId: z.string().min(1),
        articleId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Per-link mutation → Write on THAT KB (§3.3).
      ctx.capabilities.assertEditInstance('kb', input.knowledgeBaseId)
      return unlinkSourceArticleFromKb(
        ctx.db,
        requireOrgId(ctx.session),
        input.id,
        input.articleId,
        input.knowledgeBaseId
      )
    }),

  // Bulk-unlink: remove ALL of a source's articles from one KB.
  unlinkFromKnowledgeBase: capabilityProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Per-link mutation → Write on THAT KB (§3.3).
      ctx.capabilities.assertEditInstance('kb', input.knowledgeBaseId)
      return unlinkSourceFromKb(ctx.db, requireOrgId(ctx.session), input.id, input.knowledgeBaseId)
    }),

  pause: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      // Source-global → Write on ALL linked KBs (§3.3).
      await assertCanManageSource(
        ctx.db,
        ctx.capabilities,
        ctx.session.user.id,
        organizationId,
        input.id
      )
      return pauseSource(ctx.db, organizationId, input.id)
    }),

  resume: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      // Source-global → Write on ALL linked KBs (§3.3).
      await assertCanManageSource(
        ctx.db,
        ctx.capabilities,
        ctx.session.user.id,
        organizationId,
        input.id
      )
      return resumeSource(ctx.db, organizationId, input.id)
    }),

  // ── Website crawler discovery (wizard backend) ────────────────────────────
  // These call the crawl provider directly — discovery happens before a source exists.

  checkUrl: capabilityProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      // Pre-create setup probe → source-setup capability (`knowledgeBase.edit`, §3.3).
      ctx.capabilities.assert(PermissionKey.knowledgeBaseEdit)
      return getCrawlProvider().checkUrl(input.url)
    }),

  findSubdomains: capabilityProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      // Pre-create setup probe → source-setup capability (`knowledgeBase.edit`, §3.3).
      ctx.capabilities.assert(PermissionKey.knowledgeBaseEdit)
      const provider = getCrawlProvider()
      return provider.findSubdomains ? provider.findSubdomains(input.url) : []
    }),

  getSitemapTree: capabilityProcedure
    .input(z.object({ url: z.string().url(), includeSubdomains: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Pre-create setup probe → source-setup capability (`knowledgeBase.edit`, §3.3).
      ctx.capabilities.assert(PermissionKey.knowledgeBaseEdit)
      return getCrawlProvider().getSitemapTree(input.url, {
        includeSubdomains: input.includeSubdomains,
      })
    }),

  syncNow: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      // Source-global → Write on ALL linked KBs (§3.3). Also org-scopes the source.
      await assertCanManageSource(
        ctx.db,
        ctx.capabilities,
        ctx.session.user.id,
        organizationId,
        input.id
      )
      await enqueueSourceSync({ sourceId: input.id, organizationId })
      return { success: true }
    }),

  delete: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      // Source-global → Write on ALL linked KBs (§3.3).
      await assertCanManageSource(
        ctx.db,
        ctx.capabilities,
        ctx.session.user.id,
        organizationId,
        input.id
      )
      return deleteSource(ctx.db, organizationId, input.id)
    }),

  detachArticle: capabilityProcedure
    .input(z.object({ articleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      // Per-link mutation → resolve the article's home KB, Write on it (§3.3).
      const kbId = await knowledgeBaseIdForArticle(ctx.db, input.articleId, organizationId)
      ctx.capabilities.assertEditInstance('kb', kbId)
      return detachArticleFromSource({ db: ctx.db, organizationId }, input.articleId)
    }),
})
