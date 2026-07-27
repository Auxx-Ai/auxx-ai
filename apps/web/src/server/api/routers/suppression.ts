// apps/web/src/server/api/routers/suppression.ts
// Admin surface for the org-wide sequence suppression list (machine-mail Phase 4
// slice 2 — Suppressions tab on Channels settings). A row blocks all sequence
// enrollment for that address; removing it resubscribes.

import { PermissionKey } from '@auxx/lib/permissions'
import { deleteSuppression, listSuppressions, upsertSuppression } from '@auxx/lib/sequences'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

const PAGE_SIZE = 50

export const suppressionRouter = createTRPCRouter({
  /** Newest-first page of suppression rows, optional email substring search. */
  list: permissionProcedure(PermissionKey.channelsManage)
    .input(z.object({ search: z.string().trim().optional(), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await listSuppressions(ctx.db, {
        organizationId: ctx.session.organizationId,
        search: input.search || undefined,
        limit: PAGE_SIZE + 1,
        before: input.cursor ? new Date(input.cursor) : undefined,
      })
      const hasMore = rows.length > PAGE_SIZE
      const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
      const nextCursor = hasMore ? page[page.length - 1]?.createdAt.toISOString() : undefined
      return { rows: page, nextCursor }
    }),

  /** Manually suppress an address (reason `manual`). Idempotent. */
  add: permissionProcedure(PermissionKey.channelsManage)
    .input(z.object({ email: z.string().trim().toLowerCase().email() }))
    .mutation(async ({ ctx, input }) => {
      await upsertSuppression(ctx.db, {
        organizationId: ctx.session.organizationId,
        email: input.email,
        reason: 'manual',
      })
    }),

  /** Remove a suppression row (= resubscribe the address). */
  remove: permissionProcedure(PermissionKey.channelsManage)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const removed = await deleteSuppression(ctx.db, ctx.session.organizationId, input.id)
      if (!removed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Suppression not found' })
      }
    }),
})
