// apps/web/src/server/api/routers/mrp.ts

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import {
  draftBuilds,
  draftPurchaseOrders,
  enqueueMrpRun,
  isMrpRunActive,
  listPlanItems,
  listRuns,
  MRP_FLAGS,
  MRP_LIST_SORTS,
  MRP_ORDER_MODES,
  MRP_PLAN_TABS,
  MRP_SUGGESTION_KINDS,
  MRP_SUPPLY_TYPES,
  readPartItem,
  readPartSeries,
  readProductItem,
  readProductSellThrough,
  readProductSeries,
  readSellThrough,
  readSummary,
  readSupplierHorizon,
  readSupplierNextOrders,
  readSupplierPerformance,
  readSupplyHistory,
  readWhereUsed,
  recomputeNextOrderLive,
} from '@auxx/lib/mrp'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

const runId = z.string().min(1).nullish()
const id = z.string().min(1)
const quantity = z.number().positive().optional()

async function requireDefId(organizationId: string, entityType: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) throw new NotFoundError(`This organization has no ${entityType} records yet.`)
  return defId
}

export const mrpRouter = createTRPCRouter({
  summary: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ runId }).optional())
    .query(async ({ ctx, input }) => {
      const result = await readSummary(ctx.db, ctx.session.organizationId, input ?? {})
      if (result.isErr()) throw result.error
      return result.value
    }),

  list: permissionProcedure(PermissionKey.mrpView)
    .input(
      z
        .object({
          runId,
          tab: z.enum(MRP_PLAN_TABS).optional(),
          supplyType: z.array(z.enum(MRP_SUPPLY_TYPES)).optional(),
          suggestionKind: z.array(z.enum(MRP_SUGGESTION_KINDS)).optional(),
          orderMode: z.array(z.enum(MRP_ORDER_MODES)).optional(),
          buffered: z.boolean().optional(),
          flags: z.array(z.enum(MRP_FLAGS)).optional(),
          supplierIds: z.array(id).optional(),
          search: z.string().max(200).optional(),
          sort: z.enum(MRP_LIST_SORTS).optional(),
          // Not `direction`: useInfiniteQuery injects its own `direction: 'forward' | 'backward'`.
          order: z.enum(['asc', 'desc']).optional(),
          limit: z.number().int().min(1).max(2000).optional(),
          cursor: z.number().int().min(0).nullish(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { order, ...rest } = input ?? {}
      const result = await listPlanItems(ctx.db, ctx.session.organizationId, {
        ...rest,
        direction: order,
        cursor: rest.cursor ?? undefined,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  partItem: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ partId: id, runId }))
    .query(async ({ ctx, input }) => {
      const result = await readPartItem(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  partSeries: permissionProcedure(PermissionKey.mrpView)
    .input(
      z.object({
        partId: id,
        window: z.enum(['3m', '6m', '12m']),
        grain: z.enum(['day', 'week', 'month']),
        runId,
        offset: z.number().int().min(0).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await readPartSeries(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  sellThrough: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ partId: id, runId }))
    .query(async ({ ctx, input }) => {
      const result = await readSellThrough(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  productItem: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ productId: id, runId }))
    .query(async ({ ctx, input }) => {
      const result = await readProductItem(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  productSeries: permissionProcedure(PermissionKey.mrpView)
    .input(
      z.object({
        productId: id,
        window: z.enum(['3m', '6m', '12m']),
        grain: z.enum(['day', 'week', 'month']),
        runId,
        offset: z.number().int().min(0).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await readProductSeries(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  productSellThrough: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ productId: id, runId }))
    .query(async ({ ctx, input }) => {
      const result = await readProductSellThrough(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  supplyHistory: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ partId: id }))
    .query(async ({ ctx, input }) => {
      const result = await readSupplyHistory(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  supplierPerformance: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ supplierId: id }))
    .query(async ({ ctx, input }) => {
      const result = await readSupplierPerformance(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  supplierHorizon: permissionProcedure(PermissionKey.mrpView)
    .input(
      z.object({
        supplierId: id,
        window: z.enum(['6m', '12m', '24m']),
        offset: z.number().int().min(0).max(40).optional(),
        runId,
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await readSupplierHorizon(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  whereUsed: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ partId: id, runId }))
    .query(async ({ ctx, input }) => {
      const result = await readWhereUsed(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  supplierNextOrder: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ runId, supplierId: id.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await readSupplierNextOrders(ctx.db, ctx.session.organizationId, input ?? {})
      if (result.isErr()) throw result.error
      return result.value
    }),

  recomputeNextOrder: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ supplierId: id, excludedPartIds: z.array(id).max(500), runId }))
    .query(async ({ ctx, input }) => {
      const result = await recomputeNextOrderLive(ctx.db, ctx.session.organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  runs: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await listRuns(ctx.db, ctx.session.organizationId, input ?? {})
      if (result.isErr()) throw result.error
      return result.value
    }),

  runNow: permissionProcedure(PermissionKey.mrpManage).mutation(async ({ ctx }) => {
    const organizationId = ctx.session.organizationId
    if (await isMrpRunActive(organizationId)) return { queued: false, active: true }
    const { queued } = await enqueueMrpRun(organizationId, { trigger: 'manual' })
    return { queued, active: !queued }
  }),

  runStatus: permissionProcedure(PermissionKey.mrpView).query(async ({ ctx }) => ({
    active: await isMrpRunActive(ctx.session.organizationId),
  })),

  // D41: draft creation also asserts write on the document def the draft lands in.
  createDraftPurchaseOrders: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        runId: runId.optional(),
        items: z
          .array(z.object({ partId: id, quantity, vendorPartId: id.optional() }))
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertWriteEntity(await requireDefId(organizationId, 'purchase_order'))
      const result = await draftPurchaseOrders(ctx.db, organizationId, userId, {
        runId: input.runId ?? undefined,
        items: input.items,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  createDraftBuilds: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        runId: runId.optional(),
        items: z
          .array(z.object({ partId: id, quantity }))
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertWriteEntity(await requireDefId(organizationId, 'build'))
      const result = await draftBuilds(ctx.db, organizationId, userId, {
        runId: input.runId ?? undefined,
        items: input.items,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})
