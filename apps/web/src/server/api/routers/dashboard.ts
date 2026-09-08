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
  hashLayoutDoc,
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
import {
  readDashboardTurnLock,
  readDashboardTurnSnapshot,
  revertDashboardTurn,
} from '@auxx/lib/dashboards/draft-edit'
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
 * Widgets across every tab. The unit the turn-review card can honestly prove:
 * the snapshot stores the pre-turn DOCUMENT, never a tool-call log, so "eleven
 * edits were applied" is not derivable from it.
 */
function countWidgets(doc: DashboardLayoutDoc): number {
  return doc.tabs.reduce((total, tab) => total + tab.widgets.length, 0)
}

/**
 * Stamp the CAS token for the next draft write onto a `get` result.
 *
 * Computed HERE rather than in `dashboard-queries.ts`: the hash is a
 * transport-layer concern of this one procedure (the browser's auto-save is its
 * only consumer), and every other reader of `getDashboard` would pay for a hash
 * it never looks at.
 *
 * `null` — not the hash of the published `layout` — when the row carries no
 * stored draft. `saveDraft`'s CAS compares against `parseDraftLayoutDoc(row
 * .draftLayout)`, which is `undefined` for such a row, so any non-null token
 * would be a guaranteed false mismatch. The client omits `expectedLayoutHash`
 * entirely in that case, which is the same unguarded first write the draft-edit
 * module's `loadDraftContext` performs for the identical reason.
 */
function withDraftLayoutHash<T extends { draftLayout: DashboardLayoutDoc | null }>(
  dashboard: T
): T & { draftLayoutHash: string | null } {
  return {
    ...dashboard,
    draftLayoutHash: dashboard.draftLayout ? hashLayoutDoc(dashboard.draftLayout) : null,
  }
}

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
        return withDraftLayoutHash(
          unwrap(await getDashboard(ctx.db, ctx.session.organizationId, { id: input.id }))
        )
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
      if (!dashboard) return null
      ctx.capabilities.assertViewInstance('dashboard', dashboard.id)
      return withDraftLayoutHash(dashboard)
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

  /**
   * Auto-save: persist the editable draft (permissive schema; no version
   * created).
   *
   * `expectedLayoutHash` is the compare-and-set token: the hash of the draft
   * this client last saw from `get` (or the one its own previous save returned).
   * The browser flushes the WHOLE document on a debounce, so without it a flush
   * holding a pre-Kopilot doc silently overwrites everything a mid-flight agent
   * turn wrote, and two tabs last-write-wins each other with no signal anywhere.
   * A mismatch comes back as a `ConflictError`, which the auto-save hook handles
   * by refetching and adopting rather than retrying the same stale doc.
   *
   * OPTIONAL, and its absence skips the check entirely: a row that has never
   * held a draft has no stored hash to compare against, so `get` hands back a
   * `null` token and the first write proceeds unguarded.
   */
  saveDraft: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        doc: draftLayoutDocSchema,
        expectedLayoutHash: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Edit — auto-saving draft widget/layout edits.
      ctx.capabilities.assertEditInstance('dashboard', input.id)
      return unwrap(
        await saveDraft(
          ctx.db,
          ctx.session.organizationId,
          input.id,
          input.doc as DashboardLayoutDoc,
          input.expectedLayoutHash !== undefined
            ? { expectedLayoutHash: input.expectedLayoutHash }
            : undefined
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

  /**
   * Is a Kopilot turn holding this dashboard's draft right now?
   *
   * The client's re-derive on mount and on every socket (re)subscribe. A
   * release published while the socket was down is never replayed, so after a
   * reconnect the local flag cannot be trusted in either direction: the canvas
   * could be stranded read-only, or editable underneath a live turn.
   *
   * `view`, not `edit`: a read-only member's page still has to know a turn is
   * running so its pill is honest, and it grants nothing.
   */
  kopilotTurnStatus: capabilityProcedure
    .input(z.object({ dashboardId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      ctx.capabilities.assertViewInstance('dashboard', input.dashboardId)
      const lock = await readDashboardTurnLock(input.dashboardId)
      return {
        active: lock !== null,
        turnId: lock?.turnId ?? null,
        startedAt: lock?.startedAt ?? null,
      }
    }),

  /**
   * Is there anything to undo on this dashboard, which turn left it, and what
   * would undoing cost?
   *
   * THE SNAPSHOT'S EXISTENCE *IS* THE SIGNAL, and the `turnId` is DERIVED here
   * rather than taken as input. That is not a detail: the outcome that most
   * often leaves a revertible snapshot is `aborted`, and `aborted` IS a reload
   * or a navigate-away, so the single most common case for this offer is
   * exactly the one where the client never saw the `ended` event and cannot
   * name a turn. A turn-pinned input would withhold the offer precisely when
   * it is most needed.
   *
   * `readDashboardTurnSnapshot` with no expected turn returns whatever is in
   * the slot, which is what "the last turn that stopped early" means: the
   * capability never reverts automatically and finalises only on a COMPLETED
   * turn, so a surviving snapshot has exactly one cause. Every other path
   * clears it (success finalises, a manual save clears it, the next turn's
   * first write overwrites the slot, Redis expires it after 24h).
   *
   * `revertKopilotTurn` still takes `turnId` as an input, pinned to the one
   * this returned: THAT one must stay turn-checked so a banner left up across a
   * newer turn cannot revert work the user never saw.
   *
   * Instance `edit`, not `view`, unlike the workflow twin: the only thing this
   * answer is for is the Undo button beside it, and that button is `edit`. A
   * viewer who cannot take the offer is not shown it.
   *
   * Withheld while a turn still HOLDS the lock: a turn mid-write has not
   * "stopped early", and offering its snapshot would let the user roll the
   * canvas back underneath a running agent.
   *
   * `null` is the common answer and costs one Redis GET with no query at all.
   */
  kopilotTurnReview: capabilityProcedure
    .input(z.object({ dashboardId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      ctx.capabilities.assertEditInstance('dashboard', input.dashboardId)

      const snapshot = await readDashboardTurnSnapshot(input.dashboardId)
      if (!snapshot) return null

      const lock = await readDashboardTurnLock(input.dashboardId)
      if (lock?.turnId === snapshot.turnId) return null

      // Org-scoped, so a foreign id can never get past this into real data.
      const dashboard = unwrap(
        await getDashboard(ctx.db, ctx.session.organizationId, { id: input.dashboardId })
      )
      // The DRAFT is what a turn writes and what a revert restores; the
      // published layout is only the fallback for a row that has never held one.
      const liveDoc = dashboard.draftLayout ?? dashboard.layout

      return {
        /** Pin the revert to this: it is turn-checked and this is the proof. */
        turnId: snapshot.turnId,
        capturedAt: snapshot.capturedAt,
        /**
         * How the turn ended, as stamped on the snapshot. `null` is a real
         * answer (a snapshot from before the field existed, a turn that died
         * before its turn-end hook ran, a stamp whose Redis write failed) and
         * must fall back to generic wording rather than withhold the offer.
         */
        endedAs: snapshot.endedAs ?? null,
        /** Widgets on the canvas the moment before the turn's first write. */
        preTurnWidgetCount: countWidgets(snapshot.doc),
        /** Widgets on the draft now: what the stopped turn left behind. */
        currentWidgetCount: countWidgets(liveDoc),
        /**
         * The draft no longer hashes to what the turn left. `revertDashboardTurn`
         * will refuse with a `ConflictError`; knowing it up front lets the card
         * say so instead of offering a button that cannot work. Both sides hash
         * the PARSED doc (`getDashboard` parses through `parseDraftLayoutDoc`,
         * exactly as the draft-edit module's `loadDraftContext` does), so this
         * is the same exact comparison the revert makes.
         *
         * Fails OPEN on an absent post-turn hash, matching the revert: unknown
         * must not turn a legitimate Undo into a refusal.
         */
        canvasChangedSinceTurn:
          snapshot.postTurnLayoutHash !== undefined &&
          hashLayoutDoc(liveDoc) !== snapshot.postTurnLayoutHash,
      }
    }),

  /**
   * Take the offer above: restore the exact pre-turn layout.
   *
   * `turnId` is an INPUT here, unlike the query, and is expected to be the one
   * `kopilotTurnReview` returned. `revertDashboardTurn` re-checks it against the
   * slot, so a banner left open across a newer turn fails with a 404 rather
   * than reverting a turn the user never saw.
   *
   * No try/catch. `revertDashboardTurn`'s two refusals are DIFFERENT sentences
   * the card has to be able to show (`NotFoundError` "nothing to undo" versus
   * `ConflictError` "the dashboard changed since that turn"), and wrapping them
   * here would flatten both into a 500 and take the message with them. The
   * `AuxxError` travels as-is and `auxxErrorMiddleware` maps 404/409.
   */
  revertKopilotTurn: capabilityProcedure
    .input(z.object({ dashboardId: z.string().min(1), turnId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assertEditInstance('dashboard', input.dashboardId)
      const reverted = await revertDashboardTurn(
        ctx.db,
        { dashboardId: input.dashboardId, organizationId: ctx.session.organizationId },
        input.turnId
      )
      if (reverted.isErr()) throw reverted.error
      return { reverted: true as const }
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
