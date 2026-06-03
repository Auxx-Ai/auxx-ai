// apps/web/src/server/api/routers/knowledge-sources.ts
// tRPC surface for Knowledge Sources. Manual connector (Phase 1) + the website crawler:
// discovery procedures (checkUrl/getSitemapTree/findSubdomains) back the wizard, and
// `create` accepts a website source whose config holds the crawl selection.

import { getUserOrganizationId } from '@auxx/lib/email'
import { detachArticleFromSource } from '@auxx/lib/kb'
import {
  createSource,
  deleteSource,
  enqueueSourceSync,
  getCrawlProvider,
  getSource,
  linkSourceToKb,
  listSourceLinks,
  listSources,
  pauseSource,
  resumeSource,
  unlinkSourceFromKb,
  updateSource,
} from '@auxx/lib/knowledge-sources'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

function requireOrgId(session: Parameters<typeof getUserOrganizationId>[0]): string {
  const organizationId = getUserOrganizationId(session)
  if (!organizationId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found' })
  }
  return organizationId
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

// Optional: link the new source's content into these user-facing KBs right after create.
const linkKnowledgeBaseIds = z.array(z.string().min(1)).optional()

const manualSourceSchema = z.object({
  name: z.string().min(1),
  type: z.literal('manual'),
  linkKnowledgeBaseIds,
  surface: surfaceSchema,
  config: z.object({ items: z.array(manualItemSchema).default([]) }).default({ items: [] }),
  ...scheduleFields,
})

const websiteSourceSchema = z.object({
  name: z.string().min(1),
  type: z.literal('website'),
  linkKnowledgeBaseIds,
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
  list: protectedProcedure.query(async ({ ctx }) => {
    return listSources(ctx.db, requireOrgId(ctx.session))
  }),

  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return getSource(ctx.db, requireOrgId(ctx.session), input.id)
  }),

  getStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const source = await getSource(ctx.db, requireOrgId(ctx.session), input.id)
      return {
        status: source.status,
        lastSyncedAt: source.lastSyncedAt,
        itemCount: source.itemCount,
        error: source.error,
      }
    }),

  create: protectedProcedure.input(createSchema).mutation(async ({ ctx, input }) => {
    if (input.surface === 'ai-only') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'AI-only sources are not available yet (Phase 4)',
      })
    }
    const organizationId = requireOrgId(ctx.session)
    const source = await createSource(ctx.db, organizationId, {
      name: input.name,
      type: input.type,
      surface: input.surface,
      config: input.config,
      syncBehavior: input.syncBehavior,
      scheduleConfig: input.scheduleConfig,
      createdById: ctx.session.user.id,
    })
    // Pre-link into chosen KBs (content materializes on the first sync's reconcile pass).
    for (const kbId of input.linkKnowledgeBaseIds ?? []) {
      await linkSourceToKb(ctx.db, organizationId, source.id, kbId)
    }
    return source
  }),

  update: protectedProcedure
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
      // Selecting "Manual only" clears the cadence so the scheduler is removed.
      const scheduleConfig =
        patch.syncBehavior === 'manual' ? null : (patch.scheduleConfig ?? undefined)
      return updateSource(ctx.db, requireOrgId(ctx.session), id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.config !== undefined ? { config: patch.config } : {}),
        ...(patch.syncBehavior !== undefined ? { syncBehavior: patch.syncBehavior } : {}),
        ...(scheduleConfig !== undefined ? { scheduleConfig } : {}),
      })
    }),

  // ── Linking a source's content into user-facing KBs ───────────────────────

  listLinks: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return listSourceLinks(ctx.db, requireOrgId(ctx.session), input.id)
    }),

  linkToKnowledgeBases: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseIds: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      for (const kbId of input.knowledgeBaseIds) {
        await linkSourceToKb(ctx.db, organizationId, input.id, kbId)
      }
      return { success: true }
    }),

  unlinkFromKnowledgeBase: protectedProcedure
    .input(z.object({ id: z.string(), knowledgeBaseId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return unlinkSourceFromKb(ctx.db, requireOrgId(ctx.session), input.id, input.knowledgeBaseId)
    }),

  pause: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    return pauseSource(ctx.db, requireOrgId(ctx.session), input.id)
  }),

  resume: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return resumeSource(ctx.db, requireOrgId(ctx.session), input.id)
    }),

  // ── Website crawler discovery (wizard backend) ────────────────────────────
  // These call the crawl provider directly — discovery happens before a source exists.

  checkUrl: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      return getCrawlProvider().checkUrl(input.url)
    }),

  findSubdomains: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const provider = getCrawlProvider()
      return provider.findSubdomains ? provider.findSubdomains(input.url) : []
    }),

  getSitemapTree: protectedProcedure
    .input(z.object({ url: z.string().url(), includeSubdomains: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      return getCrawlProvider().getSitemapTree(input.url, {
        includeSubdomains: input.includeSubdomains,
      })
    }),

  syncNow: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = requireOrgId(ctx.session)
      // Authz: ensures the source belongs to this org before enqueuing.
      await getSource(ctx.db, organizationId, input.id)
      await enqueueSourceSync({ sourceId: input.id, organizationId })
      return { success: true }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deleteSource(ctx.db, requireOrgId(ctx.session), input.id)
    }),

  detachArticle: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return detachArticleFromSource(
        { db: ctx.db, organizationId: requireOrgId(ctx.session) },
        input.articleId
      )
    }),
})
