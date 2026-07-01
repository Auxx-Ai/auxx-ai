// apps/web/src/server/api/routers/inventory-bridge.ts
// tRPC surface for the v9 inventory→part bridge link picker + part console (Piece B3).
// Thin validated edge over @auxx/lib/data-connectors linking helpers — reads are queries,
// link/unlink/mode/apply are mutations. All logic lives in lib; this only wires ctx.

import {
  applyPendingInventoryDelta,
  linkInventorySource,
  listInventoryBridgeSources,
  listPartInventoryLinks,
  unlinkInventorySource,
  updateInventoryLinkMode,
} from '@auxx/lib/data-connectors'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const modeSchema = z.enum(['auto', 'confirm'])

export const inventoryBridgeRouter = createTRPCRouter({
  /** Configured inventory sources for the org (which defs the picker can link from). */
  sources: protectedProcedure.query(({ ctx }) =>
    listInventoryBridgeSources(ctx.session.organizationId)
  ),

  /** Every inventory link on a part, with watermark + current level + pending delta. */
  linksForPart: protectedProcedure
    .input(z.object({ partInstanceId: z.string() }))
    .query(({ ctx, input }) =>
      listPartInventoryLinks(ctx.db, ctx.session.organizationId, input.partInstanceId)
    ),

  /** Link a source record to a part (sets the edge + baselines the watermark). */
  link: protectedProcedure
    .input(
      z.object({
        partInstanceId: z.string(),
        variantInstanceId: z.string(),
        sourceDefId: z.string(),
        mode: modeSchema.optional(),
        baselineSeed: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      linkInventorySource(ctx.db, ctx.session.organizationId, ctx.session.userId, input)
    ),

  /** Unlink a source (clears the edge + removes the watermark). */
  unlink: protectedProcedure
    .input(z.object({ variantInstanceId: z.string(), sourceDefId: z.string() }))
    .mutation(({ ctx, input }) =>
      unlinkInventorySource(ctx.db, ctx.session.organizationId, ctx.session.userId, input)
    ),

  /** Toggle a link between auto-deduct and confirm. */
  setMode: protectedProcedure
    .input(z.object({ variantInstanceId: z.string(), mode: modeSchema }))
    .mutation(({ ctx, input }) =>
      updateInventoryLinkMode(ctx.db, input.variantInstanceId, input.mode)
    ),

  /** Apply a confirm-mode link's pending consumption delta now. Returns applied magnitude. */
  applyPending: protectedProcedure
    .input(z.object({ variantInstanceId: z.string() }))
    .mutation(({ ctx, input }) =>
      applyPendingInventoryDelta(
        ctx.db,
        ctx.session.organizationId,
        ctx.session.userId,
        input.variantInstanceId
      )
    ),
})
