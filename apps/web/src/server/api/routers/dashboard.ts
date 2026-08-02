// apps/web/src/server/api/routers/dashboard.ts

import type { Database } from '@auxx/database'
import { getUserCache } from '@auxx/lib/cache'
import {
  archiveDashboard,
  chartQueryInputSchema,
  createDashboard,
  deleteVersion,
  discardDashboardDraft,
  draftLayoutDocSchema,
  duplicateDashboard,
  getDashboard,
  getVersion,
  globalFiltersSchema,
  listDashboards,
  listVersions,
  loadDashboardRow,
  publishDashboard,
  renameVersion,
  restoreVersion,
  saveDraft,
  updateDashboard,
} from '@auxx/lib/dashboards'
import type { DashboardLayoutDoc } from '@auxx/lib/dashboards/client'
import { type CapabilitySet, PermissionKey } from '@auxx/lib/permissions'
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
import { capabilityProcedure, createTRPCRouter } from '../trpc'

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

/**
 * Input for chartData/kpiData. Carries the data-determining QUERY PROJECTION
 * (`ChartQueryInput`) — NOT the full widget configuration — so display-only
 * edits (color/legend/valueFormat/labelFormat) never reach the query key and
 * can't trigger a re-fetch. The config panel still previews unsaved drafts:
 * `toChartQueryInput(draftConfig)` flows through the same endpoint. `widgetId`
 * is informational; `globalOverrides` is the viewer's live date-range/condition
 * state from the URL. `skipCache` bypasses the server-side aggregate cache
 * READ (still repopulates) — for the refresh button; it must never end up in
 * the client React Query key (refresh via a one-shot fetch/invalidate).
 */
const widgetDataInputSchema = z.object({
  dashboardId: z.string(),
  widgetId: z.string().optional(),
  query: chartQueryInputSchema,
  globalOverrides: globalFiltersSchema.optional(),
  skipCache: z.boolean().optional(),
})

type WidgetDataInput = z.infer<typeof widgetDataInputSchema>

/**
 * Shared prep for the data procedures: assert the dashboard is viewable and
 * build the AggregateQuery from the projected input, resolving the viewer's
 * global filters in THEIR timezone (buckets follow the viewer, not the org).
 */
async function prepareWidgetQuery(
  ctx: {
    db: Database
    session: { organizationId: string; userId: string }
    capabilities: CapabilitySet
  },
  input: WidgetDataInput
) {
  // Read — the dashboard driving this widget, before running the aggregate.
  ctx.capabilities.assertViewInstance('dashboard', input.dashboardId)
  unwrap(await loadDashboardRow(ctx.db, ctx.session.organizationId, input.dashboardId))
  const profile = await getUserCache().get(ctx.session.userId, 'userProfile')
  const timezone = profile?.preferredTimezone || 'UTC'
  const query = buildAggregateQueryForWidget(input.query, {
    conditions: input.globalOverrides?.conditions,
    dateRange: resolveDateRangePreset(input.globalOverrides?.dateRange, timezone),
    timezone,
  })
  return { cfg: input.query, query }
}

export const dashboardRouter = createTRPCRouter({
  list: capabilityProcedure.query(async ({ ctx }) => {
    // No coarse assert — filter the result to dashboards the member may view
    // (`dashboard` is `baselineAtCreate: true`, so an unrestricted-looking row
    // still denies with no explicit row). KB `list` precedent, so a server-warmed
    // page call never 403s.
    const dashboards = unwrap(await listDashboards(ctx.db, ctx.session.organizationId))
    return dashboards.filter((d) => ctx.capabilities.canViewInstance('dashboard', d.id))
  }),

  get: capabilityProcedure
    .input(
      z
        .object({
          id: z.string().min(1).optional(),
          entityDefinitionId: z.string().min(1).optional(),
          slug: z.string().min(1).optional(),
        })
        .refine((i) => i.id || i.entityDefinitionId || i.slug, {
          message: 'Must provide id, entityDefinitionId, or slug',
        })
    )
    .query(async ({ ctx, input }) => {
      // `id` wins when present; otherwise resolve by entity def / apiSlug — that
      // branch's result is nullable (`null` ⇒ empty-state, not an error).
      if (input.id) {
        // Read — gate BEFORE loading; a foreign/garbage id denies here.
        ctx.capabilities.assertViewInstance('dashboard', input.id)
        return unwrap(await getDashboard(ctx.db, ctx.session.organizationId, { id: input.id }))
      }
      // The dashboard id isn't known up front — resolve first, then gate on the
      // resolved instance BEFORE returning. No linked dashboard stays `null`
      // (empty-state), never a 403.
      const dashboard = unwrap(
        await getDashboard(ctx.db, ctx.session.organizationId, {
          entityDefinitionId: input.entityDefinitionId,
          slug: input.slug,
        })
      )
      if (dashboard) ctx.capabilities.assertViewInstance('dashboard', dashboard.id)
      return dashboard
    }),

  create: capabilityProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().nullable().optional(),
        icon: iconSchema.optional(),
        isPrivate: z.boolean().optional(),
        entityDefinitionId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Full — creating a dashboard (no instance exists yet to key on).
      ctx.capabilities.assert(PermissionKey.dashboardsManage)
      return unwrap(
        await createDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, input)
      )
    }),

  update: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().nullable().optional(),
        icon: iconSchema.nullable().optional(),
        position: z.number().optional(),
        entityDefinitionId: z.string().min(1).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      // Full — this patch is entirely CONTAINER metadata (name, description,
      // icon, list position, primary-entity link); widget/layout edits never
      // come through here, they go to `saveDraft`/`publish`. Renaming is a Full
      // act per the dashboards ladder, so the whole patch sits at Full rather
      // than splitting one input across two rungs.
      ctx.capabilities.assertAdminInstance('dashboard', id)
      return unwrap(
        await updateDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, id, patch)
      )
    }),

  delete: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Full — destroying the dashboard container (symmetry with KB/dataset delete).
      ctx.capabilities.assertAdminInstance('dashboard', input.id)
      return unwrap(await archiveDashboard(ctx.db, ctx.session.organizationId, input.id))
    }),

  duplicate: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Read on the source + Full to create the copy.
      ctx.capabilities.assertViewInstance('dashboard', input.id)
      ctx.capabilities.assert(PermissionKey.dashboardsManage)
      return unwrap(
        await duplicateDashboard(ctx.db, ctx.session.organizationId, ctx.session.userId, input.id)
      )
    }),

  // Auto-save: persist the editable draft (permissive schema; no version created).
  saveDraft: capabilityProcedure
    .input(z.object({ id: z.string(), doc: draftLayoutDocSchema }))
    .mutation(async ({ ctx, input }) => {
      // Edit — auto-saving draft widget/layout edits.
      ctx.capabilities.assertEditInstance('dashboard', input.id)
      return unwrap(
        await saveDraft(
          ctx.db,
          ctx.session.organizationId,
          input.id,
          input.doc as DashboardLayoutDoc
        )
      )
    }),

  // Publish: snapshot the row's draft into a new version (strict validation).
  publish: capabilityProcedure
    .input(z.object({ id: z.string(), label: z.string().max(120).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Edit — publishing the widget/layout draft into a new version.
      ctx.capabilities.assertEditInstance('dashboard', input.id)
      return unwrap(
        await publishDashboard(
          ctx.db,
          ctx.session.organizationId,
          ctx.session.userId,
          input.id,
          input.label ?? null
        )
      )
    }),

  // Discard: revert the draft to the active version.
  discardDraft: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Edit — discarding draft widget/layout edits.
      ctx.capabilities.assertEditInstance('dashboard', input.id)
      return unwrap(await discardDashboardDraft(ctx.db, ctx.session.organizationId, input.id))
    }),

  listVersions: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Read — version history.
      ctx.capabilities.assertViewInstance('dashboard', input.id)
      return unwrap(await listVersions(ctx.db, ctx.session.organizationId, input.id))
    }),

  getVersion: capabilityProcedure
    .input(z.object({ id: z.string(), versionNumber: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      // Read — one version's snapshot.
      ctx.capabilities.assertViewInstance('dashboard', input.id)
      return unwrap(
        await getVersion(ctx.db, ctx.session.organizationId, input.id, input.versionNumber)
      )
    }),

  restoreVersion: capabilityProcedure
    .input(z.object({ id: z.string(), versionNumber: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      // Edit — restoring a version onto the draft.
      ctx.capabilities.assertEditInstance('dashboard', input.id)
      return unwrap(
        await restoreVersion(ctx.db, ctx.session.organizationId, input.id, input.versionNumber)
      )
    }),

  deleteVersion: capabilityProcedure
    .input(z.object({ id: z.string(), versionNumber: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      // Edit — deleting a non-live version.
      ctx.capabilities.assertEditInstance('dashboard', input.id)
      return unwrap(
        await deleteVersion(ctx.db, ctx.session.organizationId, input.id, input.versionNumber)
      )
    }),

  renameVersion: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        versionNumber: z.number().int().positive(),
        label: z.string().max(120).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Edit — annotating a VERSION's label (not the dashboard's name).
      ctx.capabilities.assertEditInstance('dashboard', input.id)
      return unwrap(
        await renameVersion(
          ctx.db,
          ctx.session.organizationId,
          input.id,
          input.versionNumber,
          input.label
        )
      )
    }),

  // 🔴 `capabilities` is not optional plumbing on these two. `article` is the
  // one aggregate source with a per-row policy (it inherits its KB's instance
  // grants — plan v3/06 R9), and the engine's convention is
  // `capabilities: undefined` ⇒ UNRESTRICTED, for headless callers. Dropping it
  // here silently restores the org-wide count and, worse, collapses the
  // result-cache fork that keeps one viewer's numbers off another's dashboard.
  chartData: capabilityProcedure.input(widgetDataInputSchema).query(async ({ ctx, input }) => {
    const { query } = await prepareWidgetQuery(ctx, input)
    return unwrap(
      await runAggregate(ctx.db, ctx.session.organizationId, ctx.session.userId, query, {
        skipCache: input.skipCache,
        capabilities: ctx.capabilities,
      })
    )
  }),

  kpiData: capabilityProcedure.input(widgetDataInputSchema).query(async ({ ctx, input }) => {
    const { cfg, query } = await prepareWidgetQuery(ctx, input)
    return unwrap(
      await runKpi(
        ctx.db,
        ctx.session.organizationId,
        ctx.session.userId,
        { base: query, trend: trendSpecForWidget(cfg) },
        { skipCache: input.skipCache, capabilities: ctx.capabilities }
      )
    )
  }),
})
