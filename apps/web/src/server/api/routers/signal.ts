// apps/web/src/server/api/routers/signal.ts
// tRPC surface for the communications-view read (client-notifications plan §4.8/Phase 4) —
// thin wrapper over `@auxx/lib/signals`' `listSignalsForRecordKeys`; the router only resolves
// org via `ctx.session` and unwraps the domain layer's `Result`.

import { listSuppressedEmails } from '@auxx/lib/sequences'
import {
  getSignalById,
  getSignalRollup,
  listSignals,
  listSignalsForRecordKeys,
  SIGNAL_RECORD_KEYS_MAX,
} from '@auxx/lib/signals'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

export const signalRouter = createTRPCRouter({
  /**
   * All `EntitySignal`s linked to any of `recordKeys` (e.g. `work_order:<id>`, `visit:<id>`,
   * `invoice:<id>`, `quote:<id>`, `contact:<id>`), newest `occurredAt` first — the job/contact
   * "Communications" view's one query.
   */
  listForRecordKeys: protectedProcedure
    .input(
      z.object({
        recordKeys: z.array(z.string()).min(1).max(SIGNAL_RECORD_KEYS_MAX),
        limit: z.number().int().min(1).max(200).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listSignalsForRecordKeys(
        ctx.db,
        ctx.session.organizationId,
        input.recordKeys,
        input.limit
      )
      if (!result.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }
      return result.value
    }),

  /**
   * General-purpose, keyset-paginated signal feed — optionally scoped to `recordKeys` and/or
   * filtered by kind/subtype/date range — the read surface behind a future signals inbox/filter
   * view (plans/signals/01-signal-store.md "Read surfaces (v1)").
   */
  list: protectedProcedure
    .input(
      z.object({
        recordKeys: z.array(z.string()).max(SIGNAL_RECORD_KEYS_MAX).optional(),
        filters: z
          .object({
            kinds: z.array(z.string()).optional(),
            subtypes: z.array(z.string()).optional(),
            occurredAfter: z.date().optional(),
            occurredBefore: z.date().optional(),
            includeBot: z.boolean().optional(),
            contactEntityInstanceId: z.string().optional(),
          })
          .optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listSignals({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        recordKeys: input.recordKeys,
        filters: input.filters,
        cursor: input.cursor,
        limit: input.limit,
      })
      if (!result.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }
      return result.value
    }),

  /**
   * One signal by id — the task origin line's "created by rule X after <signal>" context
   * (follow-ups plan Step 7). `null` when the row was pruned by retention; the client
   * degrades to rule-name-only copy.
   */
  byId: protectedProcedure
    .input(z.object({ signalId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getSignalById(ctx.db, ctx.session.organizationId, input.signalId)
      if (!result.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }
      return result.value
    }),

  /**
   * Batched suppression check for the composer warning banner (follow-ups plan decision 9) —
   * returns only the suppressed subset of `emails` with reasons. Reads `SequenceSuppression`
   * directly (authoritative, unlike the rollup).
   */
  checkSuppression: protectedProcedure
    .input(z.object({ emails: z.array(z.string()).min(1).max(100) }))
    .query(({ ctx, input }) =>
      listSuppressedEmails(ctx.db, ctx.session.organizationId, input.emails)
    ),

  /**
   * The `EntitySignalRollup` row for one entity instance (header chips/digest renderer/
   * suppression checks) — `null` when no signal has ever been recorded for it.
   */
  rollup: protectedProcedure
    .input(z.object({ entityInstanceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getSignalRollup(ctx.session.organizationId, input.entityInstanceId)
      if (!result.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }
      return result.value
    }),
})
