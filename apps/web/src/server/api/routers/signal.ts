// apps/web/src/server/api/routers/signal.ts
// tRPC surface for the communications-view read (client-notifications plan §4.8/Phase 4) —
// thin wrapper over `@auxx/lib/signals`' `listSignalsForRecordKeys`; the router only resolves
// org via `ctx.session` and unwraps the domain layer's `Result`.

import { listSignalsForRecordKeys, SIGNAL_RECORD_KEYS_MAX } from '@auxx/lib/signals'
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
})
