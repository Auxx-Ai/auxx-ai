// apps/web/src/server/api/routers/dashboard.ts

import type { Database } from '@auxx/database'
import { getUserCache } from '@auxx/lib/cache'
import {
  archiveDashboard,
  createDashboard,
  dashboardLayoutDocSchema,
  duplicateDashboard,
  getDashboard,
  getVersion,
  globalFiltersSchema,
  listDashboards,
  listVersions,
  publishLayout,
  renameVersion,
  restoreVersion,
  updateDashboard,
  widgetConfigurationSchema,
} from '@auxx/lib/dashboards'
import type { DashboardLayoutDoc, WidgetConfiguration } from '@auxx/lib/dashboards/client'
import { isChartWidget } from '@auxx/lib/dashboards/client'
import { UnprocessableEntityError } from '@auxx/lib/errors'
import {
  buildAggregateQueryForWidget,
  resolveDateRangePreset,
  runAggregate,
  runKpi,
  trendSpecForWidget,
} from '@auxx/lib/resources/aggregate'
import { TRPCError } from '@trpc/server'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** Throw the neverthrow error (an AuxxError) so `auxxErrorMiddleware` maps it. */
function unwrap<V>(result: Result<V, Error>): V {
  if (result.isErr()) {
    const e = result.error
    throw e instanceof Error
      ? e
      : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unknown error' })
  }
  return result.value
}

const iconSchema = z.object({ iconId: z.string(), color: z.string() })
const visibilitySchema = z.enum(['private', 'org'])

/**
 * Input for chartData/kpiData. Carries the CONFIGURATION (not just a widget
 * id) so the config panel can preview unsaved drafts through the same
 * endpoint; `widgetId` is informational. `globalOverrides` is the viewer's
 * live date-range/condition state from the URL.
 */
const widgetDataInputSchema = z.object({
  dashboardId: z.string(),
  widgetId: z.string().optional(),
  configuration: widgetConfigurationSchema,
  globalOverrides: globalFiltersSchema.optional(),
})

type WidgetDataInput = z.infer<typeof widgetDataInputSchema>

/**
 * Shared prep for the data procedures: assert the dashboard is viewable, narrow
 * the configuration to a metric-bearing chart widget, and resolve the viewer's
 * global filters in THEIR timezone (buckets follow the viewer, not the org).
 */
async function prepareWidgetQuery(
  ctx: { db: Database; session: { organizationId: string; userId: string } },
  input: WidgetDataInput
) {
  unwrap(
    await getDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, input.dashboardId)
  )
  const cfg = input.configuration as WidgetConfiguration
  if (!isChartWidget(cfg)) {
    throw new UnprocessableEntityError('Configuration is not a chart/KPI widget')
  }
  const profile = await getUserCache().get(ctx.session.userId, 'userProfile')
  const timezone = profile?.preferredTimezone || 'UTC'
  const query = buildAggregateQueryForWidget(cfg, {
    conditions: input.globalOverrides?.conditions,
    dateRange: resolveDateRangePreset(input.globalOverrides?.dateRange, timezone),
    timezone,
  })
  return { cfg, query }
}

export const dashboardRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return unwrap(await listDashboards(ctx.db, ctx.session.organizationId, ctx.session.userId))
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return unwrap(
      await getDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, input.id)
    )
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().nullable().optional(),
        icon: iconSchema.optional(),
        visibility: visibilitySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return unwrap(
        await createDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, input)
      )
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().nullable().optional(),
        icon: iconSchema.nullable().optional(),
        visibility: visibilitySchema.optional(),
        position: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      return unwrap(
        await updateDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, id, patch)
      )
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return unwrap(
        await archiveDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, input.id)
      )
    }),

  duplicate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return unwrap(
        await duplicateDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, input.id)
      )
    }),

  save: protectedProcedure
    .input(z.object({ id: z.string(), doc: dashboardLayoutDocSchema }))
    .mutation(async ({ ctx, input }) => {
      return unwrap(
        await publishLayout(
          ctx.db,
          ctx.session.organizationId,
          ctx.session.userId,
          input.id,
          input.doc as DashboardLayoutDoc
        )
      )
    }),

  listVersions: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return unwrap(
        await listVersions(ctx.db, ctx.session.organizationId, ctx.session.userId, input.id)
      )
    }),

  getVersion: protectedProcedure
    .input(z.object({ id: z.string(), versionNumber: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return unwrap(
        await getVersion(
          ctx.db,
          ctx.session.organizationId,
          ctx.session.userId,
          input.id,
          input.versionNumber
        )
      )
    }),

  restoreVersion: protectedProcedure
    .input(z.object({ id: z.string(), versionNumber: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      return unwrap(
        await restoreVersion(
          ctx.db,
          ctx.session.organizationId,
          ctx.session.userId,
          input.id,
          input.versionNumber
        )
      )
    }),

  renameVersion: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        versionNumber: z.number().int().positive(),
        label: z.string().max(120).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return unwrap(
        await renameVersion(
          ctx.db,
          ctx.session.organizationId,
          ctx.session.userId,
          input.id,
          input.versionNumber,
          input.label
        )
      )
    }),

  chartData: protectedProcedure.input(widgetDataInputSchema).query(async ({ ctx, input }) => {
    const { query } = await prepareWidgetQuery(ctx, input)
    return unwrap(await runAggregate(ctx.db, ctx.session.organizationId, ctx.session.userId, query))
  }),

  kpiData: protectedProcedure.input(widgetDataInputSchema).query(async ({ ctx, input }) => {
    const { cfg, query } = await prepareWidgetQuery(ctx, input)
    return unwrap(
      await runKpi(ctx.db, ctx.session.organizationId, ctx.session.userId, {
        base: query,
        trend: trendSpecForWidget(cfg),
      })
    )
  }),
})
