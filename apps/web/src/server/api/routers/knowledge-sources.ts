// apps/web/src/server/api/routers/knowledge-sources.ts
// tRPC surface for Knowledge Sources. Phase 1: manual connector only; the website
// crawler discovery procedures (checkUrl/getSitemapTree) land in Phase 2.

import { getUserOrganizationId } from '@auxx/lib/email'
import { detachArticleFromSource } from '@auxx/lib/kb'
import {
  createSource,
  deleteSource,
  enqueueSourceSync,
  getSource,
  listSources,
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

const createSchema = z.object({
  name: z.string().min(1),
  // Phase 1 ships the manual connector only; other types arrive per-phase.
  type: z.literal('manual'),
  targetKnowledgeBaseId: z.string().min(1),
  surface: z.enum(['publishable', 'ai-only']).default('publishable'),
  config: z.object({ items: z.array(manualItemSchema).default([]) }).default({ items: [] }),
})

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
    return createSource(ctx.db, requireOrgId(ctx.session), {
      name: input.name,
      type: input.type,
      targetKnowledgeBaseId: input.targetKnowledgeBaseId,
      surface: input.surface,
      config: input.config,
      createdById: ctx.session.user.id,
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
