// apps/web/src/server/api/routers/inventory-bridge.ts
// tRPC surface for the v9 inventory→part bridge: org-level source config (admin) + per-part
// record linking + the part console. Thin validated edge over @auxx/lib/data-connectors; all
// logic lives in lib. Configuring a source = admin (provisions the managed rule); linking a
// record to a configured source = member.

import { getCachedCustomFields, getCachedResources } from '@auxx/lib/cache'
import {
  applyPendingInventoryDelta,
  linkInventorySource,
  listInventoryBridgeSources,
  listPartInventoryLinks,
  listSyncedDefIds,
  provisionInventoryBridge,
  removeInventoryDeductionRule,
  unlinkInventorySource,
  updateInventoryLinkMode,
} from '@auxx/lib/data-connectors'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const modeSchema = z.enum(['auto', 'confirm'])

export const inventoryBridgeRouter = createTRPCRouter({
  /** Configured inventory sources for the org, enriched with def + field labels. */
  sources: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.organizationId
    const sources = await listInventoryBridgeSources(ctx.db, organizationId)
    const resources = await getCachedResources(organizationId)
    const defLabel = new Map(resources.map((r) => [r.entityDefinitionId, r.label]))
    return Promise.all(
      sources.map(async (s) => {
        const fields = await getCachedCustomFields(organizationId, s.sourceDefId)
        const field = fields.find((f) => f.id === s.quantityFieldId)
        return {
          ...s,
          defLabel: defLabel.get(s.sourceDefId) ?? 'Resource',
          fieldLabel: field?.name ?? s.quantityFieldId,
        }
      })
    )
  }),

  /** Entity defs the org syncs via a connector — the candidate inventory sources (for the picker). */
  syncedDefIds: protectedProcedure.query(({ ctx }) =>
    listSyncedDefIds(ctx.db, ctx.session.organizationId)
  ),

  /**
   * Provision an inventory source (admin): creates the source→part edge + the managed
   * deduction rule for `(sourceDefId, quantityFieldId)`. Returns `{ provisioned:false,
   * reason:'no-part-def' }` when the org has no `part` def to link to.
   */
  provisionSource: adminProcedure
    .input(z.object({ sourceDefId: z.string().min(1), quantityFieldId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await provisionInventoryBridge(ctx.db, ctx.session.organizationId, {
        sourceDefId: input.sourceDefId,
        quantityFieldId: input.quantityFieldId,
      })
      if (!result) return { provisioned: false as const, reason: 'no-part-def' as const }
      return { provisioned: true as const, relationshipFieldId: result.relationshipFieldId }
    }),

  /** Remove an inventory source (admin): deletes its managed deduction rule. */
  removeSource: adminProcedure
    .input(z.object({ sourceDefId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      removeInventoryDeductionRule(ctx.db, ctx.session.organizationId, {
        sourceDefId: input.sourceDefId,
      })
    ),

  /** Every inventory link on a part, with current level + pending delta (source label resolved client-side). */
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
