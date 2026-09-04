// apps/web/src/server/api/routers/data-connectors.ts
// tRPC surface for Data Connectors (sync external structured records into the entity
// system). Management + provisioning + setup AND the connector reads are gated on the
// Layer-2 `connectors.manage` capability (grantable to a non-admin data-ops member; a
// connector provisions entity defs and binds credentials, 05 §1). The lone exception is
// `list`, kept as `protectedProcedure` — it's a member-facing display primitive that
// resolves connector names for the record-grid `ConnectorLockBadge`.
// The backend engine (queue/scheduler/orchestrator/provisioning) lives in
// @auxx/lib/data-connectors — this router is a thin, validated edge over it.

import { getCachedInstalledApps, getCachedResourceFields } from '@auxx/lib/cache'
import { conditionGroupsSchema } from '@auxx/lib/conditions'
import {
  addMapping,
  addStream,
  applyConnectorCatalogUpdate,
  backfillPendingChange,
  countMintedRecords,
  countPendingRelationsByTarget,
  createConnector,
  createConnectorFromAppCatalog,
  createConnectorFromTemplate,
  type DataConnectorType,
  deleteConnector,
  deriveConnectorScheduleInfo,
  enqueueConnectorSync,
  finishConnectorSetup,
  getAllConnectorTemplates,
  getConnector,
  getConnectorCatalogUpdate,
  getConnectorReadiness,
  getConnectorTemplateById,
  listConnectors,
  listRecommendedAppConnectors,
  listRuns,
  listSharedOwnedDefIds,
  listStreams,
  projectConnectorOwnedTargets,
  READINESS_REASON,
  removeMapping,
  removeStream,
  sampleConnectorFetch,
  setConnectorFieldPin,
  setStreamRequestConfig,
  setStreamSchema,
  suggestFieldMappings,
  updateConnector,
  updateMapping,
  updateStream,
} from '@auxx/lib/data-connectors'
import { inferJsonSchema } from '@auxx/lib/json-schema/client'
import { PermissionKey } from '@auxx/lib/permissions'
import { fieldIdSchema, resourceFieldIdSchema } from '@auxx/types/field'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  capabilityProcedure,
  createTRPCRouter,
  permissionProcedure,
  protectedProcedure,
} from '~/server/api/trpc'
import { assertFieldValueHostsWritable } from '~/server/lib/field-value-host-access'

// ── Shared zod shapes ─────────────────────────────────────────────────────────

/** Connector type: the built-in `generic-rest`/`fixture` or an `app:<slug>`. */
const connectorTypeSchema = z
  .string()
  .min(1)
  .refine((t) => t === 'generic-rest' || t === 'fixture' || t.startsWith('app:'), {
    message: 'Unknown connector type',
  })

// Faithful mirror of the engine `PaginationSpec` (@auxx/lib/data-connectors/types).
// Keep the field set in sync — a narrower schema silently strips the enriched
// cursor/next-url fields a detected (Stripe/Salesforce-shaped) spec carries.
const paginationSchema = z.object({
  kind: z.enum(['cursor', 'page', 'offset', 'link-header', 'next-url', 'none']),
  cursorParam: z.string().optional(),
  cursorPath: z.string().optional(),
  cursorFrom: z.enum(['response', 'lastRecord']).optional(),
  cursorRecordField: z.string().optional(),
  recordsPath: z.string().optional(),
  hasMorePath: z.string().optional(),
  nextUrlPath: z.string().optional(),
  pageParam: z.string().optional(),
  offsetBase: z.union([z.literal(0), z.literal(1)]).optional(),
  limitParam: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
})

const connectorConfigSchema = z
  .object({
    endpoint: z
      .object({
        baseUrl: z.string().url(),
        auth: z.enum(['credential', 'none']).optional(),
        pagination: paginationSchema.optional(),
        headers: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    // How far back a backfill crawls (Step 9 §1.2) — plain-language window radio.
    backfillWindowSpan: z.enum(['all', 'last_90_days', 'last_12_months']).optional(),
    // Webhook-sync SIGNAL — which trigger/endpoint drives this connector (v7). One per
    // connector; per-stream topic/token steering lives on the stream's webhookTrigger.
    webhookTrigger: z
      .object({
        triggerId: z.string().optional(),
        webhookEndpointId: z.string().optional(),
      })
      .refine((v) => !!v.triggerId !== !!v.webhookEndpointId, {
        message: 'webhookTrigger requires exactly one of triggerId or webhookEndpointId',
      })
      .optional(),
  })
  .passthrough()

const intervalCount = z.union([z.number(), z.string()]).optional()

/**
 * Connector sync floor — connectors poll third-party APIs, so sub-15-minute
 * cadences burn rate limits for data that rarely changes that fast. Coarser
 * than the generic 5-minute workflow/agent floor (MIN_SCHEDULE_INTERVAL_MINUTES).
 * Raw cron (`triggerInterval: 'custom'`) bypasses this as a power-user escape hatch.
 */
const MIN_CONNECTOR_INTERVAL_MINUTES = 15

/**
 * ScheduledTriggerConfig (shared agent/workflow frequency model). Minutes is floored at
 * 15 (04). `'off'` (v9 §5) is a webhook-mode-only SWEEP cadence — no self-heal; the
 * refinements below reject it outside webhook mode and constrain webhook mode's shape.
 */
const scheduleConfigSchema = z
  .object({
    triggerInterval: z.enum(['minutes', 'hours', 'days', 'weeks', 'custom', 'off']),
    timeBetweenTriggers: z.object({
      minutes: intervalCount,
      hours: intervalCount,
      days: intervalCount,
      weeks: intervalCount,
      isConstant: z.boolean().optional(),
    }),
    customCron: z.string().optional(),
    timezone: z.string().optional(),
  })
  .refine(
    (c) => {
      if (c.triggerInterval !== 'minutes') return true
      const minutes = Number(c.timeBetweenTriggers.minutes)
      return Number.isFinite(minutes) && minutes >= MIN_CONNECTOR_INTERVAL_MINUTES
    },
    { message: `Minimum sync cadence is ${MIN_CONNECTOR_INTERVAL_MINUTES} minutes.` }
  )

const scheduleFields = {
  syncBehavior: z.enum(['manual', 'scheduled', 'webhook']).optional(),
  scheduleConfig: scheduleConfigSchema.nullish(),
}

const requestConfigSchema = z.object({
  path: z.string().optional(),
  method: z.enum(['GET', 'POST']).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  pagination: paginationSchema.optional(),
  // Declares which param carries the backfill-window floor (Step 9 §1.2); set by
  // templates, preserved across stream edits. Distinct from `incremental.sinceParam`.
  backfillWindow: z
    .object({ sinceParam: z.string(), format: z.enum(['iso', 'unix']).optional() })
    .optional(),
  // Per-stream webhook STEERING (generic-REST only): how a matched delivery maps into
  // the request (the SIGNAL — which trigger/endpoint — is connector-level since v7,
  // on config.webhookTrigger). plans/data-connectors/v7.
  webhookTrigger: z
    .object({
      filter: z.record(z.string(), z.unknown()).optional(),
      paths: z.array(z.string()),
      deleteWhen: z
        .union([z.object({ tokenTruthy: z.string() }), z.object({ topicEquals: z.string() })])
        .optional(),
      deleteExternalIdPath: z.string().optional(),
      resultShape: z.enum(['single', 'collection']).optional(),
    })
    .optional(),
})

const mergeStrategySchema = z.enum([
  'overwrite',
  'fill_blank',
  'connector_owned_only',
  'manual_review',
  'ignore',
])

// One binding entry. Identity is the stable `id`; `targetFieldRef` is a canonical
// `ResourceFieldId` (concrete or the late-bound `@app:` form), nullable (a null
// entry is an unassigned draft / provisioned field awaiting its ref — the runtime
// skips it). `mergeStrategy` is folded in (no parallel map).
const fieldMappingSchema = z.object({
  id: z.string(),
  targetFieldRef: resourceFieldIdSchema.nullable(),
  expression: z.string(),
  sourceFields: z.record(z.string(), z.string()),
  // The identity ROLE this field plays (relationship-linking v3 §9.5) — the
  // primary `externalId` anchor (with an optional fallback-chain `order`) or a
  // secondary `match` key. At most one per field (structurally enforced by the union).
  identityRole: z
    .union([
      z.object({ kind: z.literal('externalId'), order: z.number().int().optional() }),
      z.object({
        kind: z.literal('match'),
        normalize: z.enum(['email', 'phone', 'domain', 'none']).optional(),
      }),
    ])
    .optional(),
  mergeStrategy: mergeStrategySchema.optional(),
})

export const dataConnectorRouter = createTRPCRouter({
  // ── Reads (connectors.manage — except `list`) ─────────────────────────────

  // Display-primitive carve-out: `list` stays open to any org member because the
  // record-grid `ConnectorLockBadge` resolves connector names from it for
  // connector-owned/contributing fields. Every other read is gated.
  list: protectedProcedure.query(async ({ ctx }) => {
    return listConnectors(ctx.db, ctx.session.organizationId)
  }),

  /**
   * What the "Connect a source" dialog lists (05c §3): the blank built-in, the
   * first-party templates, and every installed-app connector. The apps section
   * reads the `installedApps` org-cache (already projected with
   * `catalog.dataConnectors`) — no bundle eval, no extra query.
   *
   * `recommended` (v9) is the discovery half: connectors from published, verified
   * apps the org has NOT installed. It is gated on `integrations.manage` — the
   * dialog itself only needs `connectors.manage`, so a data-ops member without
   * install authority would otherwise be shown rows whose only CTA 403s.
   * `ctx.capabilities` is already resolved by `permissionProcedure`, so the check
   * costs nothing.
   */
  catalog: permissionProcedure(PermissionKey.connectorsManage).query(async ({ ctx }) => {
    const installedApps = await getCachedInstalledApps(ctx.session.organizationId)
    const recommended = ctx.capabilities.can(PermissionKey.integrationsManage)
      ? await listRecommendedAppConnectors(ctx.db, ctx.session.organizationId)
      : []
    const apps = installedApps.flatMap((app) =>
      (app.dataConnectors ?? []).map((dc) => ({
        type: `app:${app.app.slug}`,
        connectorId: dc.id,
        label: dc.label,
        // Connector-declared description, falling back to the app's own so a
        // connector that omits one still reads meaningfully in the picker.
        description: dc.description ?? app.app.description ?? '',
        iconKey: dc.iconKey,
        // The app's real logo (raw URL) → rendered via `AppIcon`; falls back to
        // the generic `package` glyph. Same cascade as installed-apps-provider.
        appIconId: app.app.avatarUrl ?? 'package',
        requiresConnection: dc.requiresConnection,
        requestModel: dc.requestModel ?? ('fixed' as const),
      }))
    )
    return {
      builtin: [
        {
          type: 'generic-rest' as const,
          label: 'Custom REST API',
          description: 'Connect any HTTP/JSON endpoint — you define the request and mappings.',
          iconKey: 'globe',
          requestModel: 'builder' as const,
        },
      ],
      templates: getAllConnectorTemplates(),
      apps,
      recommended,
    }
  }),

  /**
   * The bound connector's declared config schema + request model (05c §3). Feeds
   * the source-config panel's app/template branch real fields instead of the
   * `config._schema` placeholder. Built-ins expose the request builder, so they
   * carry no config schema.
   */
  connectorSchema: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      const connector = result.value
      if (!connector.type.startsWith('app:')) {
        return {
          requestModel: 'builder' as const,
          configJsonSchema: null,
          configOptionHints: null,
          requiresConnection: false,
        }
      }
      const slug = connector.type.replace(/^app:/, '')
      const installedApps = await getCachedInstalledApps(ctx.session.organizationId)
      const app =
        installedApps.find((a) => a.installationId === connector.appInstallationId) ??
        installedApps.find((a) => a.app.slug === slug)
      const dc = app?.dataConnectors?.[0] ?? null
      return {
        requestModel: dc?.requestModel ?? ('fixed' as const),
        configJsonSchema: dc?.configJsonSchema ?? null,
        configOptionHints: dc?.configOptionHints ?? null,
        // The app-declared, connector-level connection requirement (the same signal
        // the runtime adapter gates on). The setup wizard's Connect step keys off this
        // — NOT off whether the installed app merely exposes a connection definition.
        requiresConnection: dc?.requiresConnection ?? false,
      }
    }),

  getById: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      const connector = result.value
      // Surface the template's declared connection hint (05c §8) so the connect UI
      // can scope its picker to the provider/app the template expects — instead of
      // the legacy "always mint an API key" path. `null` ⇒ no hint ⇒ open catalog.
      const connectionHint = connector.templateId
        ? (getConnectorTemplateById(connector.templateId)?.connection ?? null)
        : null
      return { ...connector, connectionHint }
    }),

  /**
   * The OWNED record types this connector's app catalog declares (v6 —
   * install-target-defs-via-templates). One entry per owned default-mapping, each
   * carrying its installable `templateId` (`app:<slug>:<ownedKey>`) + the
   * `(streamKey, rootPath)` of the mapping that targets it. The Map step uses this to
   * (1) open the reused `EntityTemplateDialog` with the app's owned templates
   * pre-selected, and (2) bind every owned mapping to the freshly-installed def in the
   * install `onComplete`. Empty for a non-app connector or one whose app declares no
   * owned targets. The owned def's stable identity is its `sourceKey` (== `ownedKey`).
   */
  ownedTargets: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      const connector = result.value
      const empty = { appSlug: null as string | null, appTitle: null as string | null, targets: [] }
      if (!connector.type.startsWith('app:')) return empty

      const slug = connector.type.slice('app:'.length)
      const installedApps = await getCachedInstalledApps(ctx.session.organizationId)
      const app =
        installedApps.find((a) => a.installationId === connector.appInstallationId) ??
        installedApps.find((a) => a.app.slug === slug)
      const catalog = app?.dataConnectors?.[0] ?? null
      if (!catalog) return { ...empty, appSlug: slug, appTitle: app?.app.title ?? slug }

      return {
        appSlug: slug as string | null,
        appTitle: (app?.app.title ?? slug) as string | null,
        targets: projectConnectorOwnedTargets(slug, catalog, app?.entities ?? []),
      }
    }),

  /**
   * Status poll for the in-flight sync UI (4s while syncing). Beyond the raw
   * lifecycle fields it carries everything the client `resolveSyncStatus` resolver +
   * status line need in one round-trip (Step 9 §3.3): the derived next-sync time +
   * human cadence, a projection of the latest run (incl. the transient
   * `rateLimitedUntil` for the live countdown), and per-stream live counts for the
   * backfill view. Per-stream `recordsSeen`/`phase` come straight off the stream
   * states (the source of truth) rather than denormalized onto the run.
   */
  getStatus: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      const c = result.value

      const [runs, streams, pendingLinksResult] = await Promise.all([
        listRuns(ctx.db, ctx.session.organizationId, input.id, 1),
        listStreams(ctx.db, ctx.session.organizationId, input.id),
        countPendingRelationsByTarget(ctx.db, ctx.session.organizationId, input.id),
      ])
      if (pendingLinksResult.isErr()) throw pendingLinksResult.error
      const latest = runs[0] ?? null

      // Per-stream live progress, read off each stream's durable state jsonb. `done`
      // = the stream has flipped to steady (its backfill exhausted).
      const perStream = streams.map((s) => {
        const st = (s.state ?? {}) as { recordsSeen?: number; phase?: 'backfill' | 'steady' }
        return {
          streamKey: s.streamKey ?? '',
          recordsSeen: st.recordsSeen ?? 0,
          phase: st.phase ?? ('backfill' as const),
          done: st.phase === 'steady',
        }
      })
      const recordsSeen = perStream.reduce((n, s) => n + s.recordsSeen, 0)
      // The actively-importing stream (most records this run) names the backfill detail.
      const top = perStream.reduce<(typeof perStream)[number] | null>(
        (a, b) => (a && a.recordsSeen >= b.recordsSeen ? a : b),
        null
      )

      const { nextSyncAt, cadenceLabel } = deriveConnectorScheduleInfo({
        syncBehavior: c.syncBehavior,
        status: c.status,
        scheduleConfig: c.scheduleConfig,
        lastSyncedAt: c.lastSyncedAt,
      })

      const latestRun = latest
        ? {
            id: latest.id,
            status: latest.status,
            phase: latest.phase as 'backfill' | 'steady' | null,
            trigger: latest.trigger,
            mode: latest.mode,
            recordsSeen,
            created: latest.created,
            updated: latest.updated,
            startedAt: latest.startedAt,
            finishedAt: latest.finishedAt,
            rateLimitedUntil:
              (latest.progress as { rateLimited?: { until?: string } } | null)?.rateLimited
                ?.until ?? null,
            // Why the run parked, when it parked (trial-sync / ingest-ceiling). Drives the
            // sample-review banner + the "Sample ready" status; null for a normal run.
            pausedReason:
              (latest.progress as { paused?: { reason?: string } } | null)?.paused?.reason ?? null,
            // Trial-sync §5.2 — set ⇒ a sample run, so the live card reads
            // "Sampling — N of {limit}" instead of "Importing".
            sampleLimit: latest.sampleLimit,
            primaryStreamLabel: top?.streamKey || null,
          }
        : null

      return {
        status: c.status,
        syncBehavior: c.syncBehavior,
        lastSyncedAt: c.lastSyncedAt,
        // Webhook-sync liveness — point writes open no run, so this stamps activity
        // even when `lastSyncedAt`/`latestRun` stay null (sync-bridge §9).
        lastWebhookEventAt: c.lastWebhookEventAt,
        itemCount: c.itemCount,
        error: c.error,
        // Pending mapping-edit re-sync marker (Layer 2) — drives the page banner.
        // Null once a full backfill of the affected streams clears it.
        resyncPending: c.resyncPending,
        nextSyncAt,
        cadenceLabel,
        latestRun,
        perStream,
        // Relationship edges still to wire, per (source def, target def). Non-empty
        // after a parked run whose targets have not synced yet; the runs panel shows
        // them under the stream cards (plans/money/tasks/39 §3.6).
        pendingLinks: pendingLinksResult.value,
      }
    }),

  /**
   * Pause or resume a contributing connector for ONE field on ONE record
   * (plans/money/tasks/40 §8). Gated on record write access, the same gate a
   * field-value write passes, not on `connectors.manage`: the person editing
   * the cell is the one who needs to keep their edit. The pin lands on every
   * live `DataConnectorItem` of the connector on that instance; the sink skips
   * the field and the drift query ignores it until the pin is removed.
   */
  setFieldPin: capabilityProcedure
    .input(
      z.object({
        recordId: z.string(),
        fieldId: fieldIdSchema,
        connectorId: z.string(),
        pinned: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertFieldValueHostsWritable({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        hosts: [input.recordId as RecordId],
      })
      const { entityInstanceId } = parseRecordId(input.recordId as RecordId)
      const result = await setConnectorFieldPin(ctx.db, {
        organizationId: ctx.session.organizationId,
        entityInstanceId,
        fieldId: input.fieldId,
        connectorId: input.connectorId,
        pinned: input.pinned,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  listRuns: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string(), limit: z.number().int().positive().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      return listRuns(ctx.db, ctx.session.organizationId, input.id, input.limit)
    }),

  listStreams: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Authz: ensures the connector belongs to this org before listing. Each
      // stream carries its mapping rows nested (no separate listMappings query).
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      return listStreams(ctx.db, ctx.session.organizationId, input.id)
    }),

  // ── Management (admin) ────────────────────────────────────────────────────

  create: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        name: z.string().min(1),
        type: connectorTypeSchema,
        // When set, seed the connector from a first-party template (05c). The
        // `type` is always 'generic-rest' for a template instance.
        templateId: z.string().nullish(),
        config: connectorConfigSchema.optional(),
        credentialId: z.string().nullish(),
        appInstallationId: z.string().nullish(),
        ...scheduleFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.templateId) {
        const template = getConnectorTemplateById(input.templateId)
        if (!template) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unknown connector template: ${input.templateId}`,
          })
        }
        return createConnectorFromTemplate(
          ctx.db,
          ctx.session.organizationId,
          {
            name: input.name,
            credentialId: input.credentialId,
            appInstallationId: input.appInstallationId,
            syncBehavior: input.syncBehavior,
            scheduleConfig: input.scheduleConfig,
            createdById: ctx.session.userId,
          },
          template
        )
      }

      // App connector (`app:<slug>`) — seed its streams from the installed app's
      // catalog declaration (create-sync-flow §3.1, Tier 1) so setup arrives with
      // the source schema pre-filled, like a template. Falls through to a bare
      // connector if the app declares no data connector.
      if (input.type.startsWith('app:')) {
        const slug = input.type.slice('app:'.length)
        const installedApps = await getCachedInstalledApps(ctx.session.organizationId)
        const app =
          installedApps.find((a) => a.installationId === input.appInstallationId) ??
          installedApps.find((a) => a.app.slug === slug)
        const catalog = app?.dataConnectors?.[0] ?? null
        if (catalog) {
          return createConnectorFromAppCatalog(
            ctx.db,
            ctx.session.organizationId,
            {
              name: input.name,
              type: input.type as DataConnectorType,
              credentialId: input.credentialId,
              // Stamp the resolved installation so the connector is pinned to the exact
              // app install (keeps token refresh wired) AND the auto-link can count that
              // install's connections. Falls back to a client-supplied id, then null.
              appInstallationId: input.appInstallationId ?? app?.installationId ?? null,
              syncBehavior: input.syncBehavior,
              scheduleConfig: input.scheduleConfig,
              createdById: ctx.session.userId,
            },
            catalog,
            app?.entities ?? []
          )
        }
      }

      return createConnector(ctx.db, ctx.session.organizationId, {
        name: input.name,
        type: input.type as DataConnectorType,
        config: input.config,
        credentialId: input.credentialId,
        appInstallationId: input.appInstallationId,
        syncBehavior: input.syncBehavior,
        scheduleConfig: input.scheduleConfig,
        createdById: ctx.session.userId,
      })
    }),

  update: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z
        .object({
          id: z.string(),
          name: z.string().min(1).optional(),
          config: connectorConfigSchema.optional(),
          credentialId: z.string().nullish(),
          appInstallationId: z.string().nullish(),
          // Lifecycle toggle (pause/resume). Other statuses are engine-owned.
          status: z.enum(['paused', 'live']).optional(),
          ...scheduleFields,
        })
        // v9 §5: scheduleConfig is mode-scoped — 'off' is a webhook-only SWEEP cadence,
        // and webhook mode only writes 'off'/'custom' (the UI's Daily/Weekly Selects
        // write a customCron — see schedule-section.tsx). Both refinements only fire
        // when `syncBehavior` is present in THIS call — a cadence-only edit (mode
        // unchanged) has no syncBehavior in the payload to cross-check against; the
        // persistence rule in `updateConnector` is the actual source of truth there.
        .refine(
          (v) =>
            v.scheduleConfig?.triggerInterval !== 'off' ||
            v.syncBehavior === undefined ||
            v.syncBehavior === 'webhook',
          {
            message: "'off' is only a valid cadence in webhook mode.",
            path: ['scheduleConfig'],
          }
        )
        .refine(
          (v) =>
            v.syncBehavior !== 'webhook' ||
            !v.scheduleConfig ||
            v.scheduleConfig.triggerInterval === 'off' ||
            v.scheduleConfig.triggerInterval === 'custom',
          {
            message: "Webhook-mode cadence must be 'off' or a custom cron.",
            path: ['scheduleConfig'],
          }
        )
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      return updateConnector(ctx.db, ctx.session.organizationId, id, patch)
    }),

  /**
   * Owned-def ids of this connector that another connector ALSO maps to — a `delete`
   * KEEPS them (reassigns ownership) instead of tearing them down. The detail view joins
   * these against the cached resource labels to spell out "shared → kept" in the confirm.
   */
  sharedOwnedDefs: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return listSharedOwnedDefIds(ctx.db, ctx.session.organizationId, input.id)
    }),

  /**
   * How many records an `archive`/`delete` teardown would remove, per definition.
   * The confirm dialog names the definitions being destroyed but never said how
   * many rows — which is the number that decides whether to press the button.
   */
  mintedRecordCounts: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return countMintedRecords(ctx.db, ctx.session.organizationId, input.id)
    }),

  delete: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        id: z.string(),
        // keep → leave synced records; archive → soft-delete; delete → hard-delete.
        syncedData: z.enum(['keep', 'archive', 'delete']).default('keep'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return deleteConnector(
        ctx.db,
        ctx.session.organizationId,
        ctx.session.userId,
        input.id,
        input.syncedData
      )
    }),

  syncNow: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        id: z.string(),
        // Trial-sync §4.1 — a SAMPLE run caps each stream's backfill at `sampleLimit`
        // records, then parks `partial`/`paused` for review. Omitted ⇒ a full sync
        // (and the "Sync everything" resume of a parked sample passes nothing here).
        sampleLimit: z.number().int().positive().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Authz: ensures the connector belongs to this org before enqueuing.
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      // Readiness backstop — block a half-built config from enqueuing a run that
      // would quietly do nothing (the worker's silent no-op). Authoritative gate.
      const streams = await listStreams(ctx.db, ctx.session.organizationId, input.id)
      const readiness = getConnectorReadiness(result.value, streams)
      if (!readiness.canSync) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: READINESS_REASON[readiness.problems[0] ?? 'no-endpoint'],
        })
      }
      await enqueueConnectorSync({
        connectorId: input.id,
        organizationId: ctx.session.organizationId,
        trigger: 'manual',
        sampleLimit: input.sampleLimit,
      })
      return { success: true }
    }),

  /**
   * Finish first-run setup WITHOUT syncing — flip `pending → ready` (optional-first-sync
   * §3.4). The connector leaves setup configured-but-idle; a later manual Sync now or a
   * scheduled fire advances it `ready → syncing → live`. Idempotent (no-op past pending).
   */
  finishSetup: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return finishConnectorSetup(ctx.db, ctx.session.organizationId, input.id)
    }),

  /**
   * "Backfill now" — trigger the deferred full re-crawl for a pending mapping-edit
   * change (the banner action). Resets the affected streams to a fresh backfill so
   * history is re-projected + re-bound, then enqueues a sync; `resyncPending` clears
   * when that backfill finalizes. The only place a `rebackfill`/`rebind` edit's
   * expensive re-crawl is requested.
   */
  backfillPendingChange: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      // Same gate as `syncNow` — this is the OTHER manual door onto
      // `enqueueConnectorSync` (task 44 §7.11), and it had no readiness check at all.
      // A re-crawl is a sync, so it needs `canSync`, not just a connector that exists.
      const streams = await listStreams(ctx.db, ctx.session.organizationId, input.id)
      const readiness = getConnectorReadiness(result.value, streams)
      if (!readiness.canSync) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: READINESS_REASON[readiness.problems[0] ?? 'no-endpoint'],
        })
      }
      await backfillPendingChange(ctx.db, ctx.session.organizationId, input.id)
      return { success: true }
    }),

  // ── Stream setup (admin) ──────────────────────────────────────────────────

  /**
   * Live test-fetch → the RAW source records (each `ConnectorRecord.fields`, not
   * the envelope). The source schema and all mapping paths are expressed against
   * the raw record, so inference + the picker must see the raw record — the
   * connector's derived `externalId`/`displayName` are sync-time lineage, not
   * part of the authored source shape. Capped small. App connectors aren't wired
   * yet (phase 4) — guarded.
   */
  sampleFetch: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        id: z.string(),
        // Nullish: a blank stream can be test-fetched before it's named (the key
        // isn't used by generic-rest; app connectors derive their own).
        streamKey: z.string().min(1).nullish(),
        requestConfig: requestConfigSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      // Test-fetch only needs an endpoint (canSample) — it discovers the schema
      // before any stream/mapping exists, so streams are irrelevant here.
      const readiness = getConnectorReadiness(result.value, [])
      if (!readiness.canSample) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: READINESS_REASON[readiness.problems[0] ?? 'no-endpoint'],
        })
      }
      // Test-fetch reuses the exact fetch path the scheduled sync runs (same
      // definition + resolved credential), stopping at the first raw page — so
      // the two can never diverge on auth. All logic lives in lib.
      try {
        return await sampleConnectorFetch(
          ctx.db,
          ctx.session.organizationId,
          ctx.session.userId,
          result.value,
          { streamKey: input.streamKey, requestConfig: input.requestConfig }
        )
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Test-fetch failed',
        })
      }
    }),

  /**
   * Tier 2 mapping suggestions for a bare custom-REST stream (create-sync-flow §3.2).
   * Reuses the stream's already-detected `sourceSchema` (the setup stepper's Map step
   * runs after Sample, so a schema exists) — else falls back to a live `sampleFetch`
   * + inference — then heuristically proposes source→field bindings against the target
   * entity def's fields (read from the org cache). Returns the editable `FieldMapping`
   * entry shape; the UI drops them in as pre-checked rows the user confirms/edits.
   */
  suggestMappings: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        id: z.string(),
        streamKey: z.string().min(1).nullish(),
        entityDefinitionId: z.string(),
        // The stream's detected source schema (Layer A). Passed by the UI to avoid a
        // redundant live fetch; when omitted, a sample fetch infers it.
        sourceSchema: z.record(z.string(), z.unknown()).nullish(),
        requestConfig: requestConfigSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }

      let schema = input.sourceSchema ?? null
      if (!schema) {
        try {
          const sample = await sampleConnectorFetch(
            ctx.db,
            ctx.session.organizationId,
            ctx.session.userId,
            result.value,
            { streamKey: input.streamKey, requestConfig: input.requestConfig }
          )
          const record = Array.isArray(sample.response) ? sample.response[0] : sample.response
          schema = record != null ? (inferJsonSchema(record) as Record<string, unknown>) : null
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : 'Could not sample the source',
          })
        }
      }
      if (!schema) return { proposals: [] }

      const targetFields = await getCachedResourceFields(
        ctx.session.organizationId,
        input.entityDefinitionId
      )
      const proposals = suggestFieldMappings(input.entityDefinitionId, schema, targetFields)
      return { proposals }
    }),

  addStream: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        id: z.string(),
        // Omitted for a blank stream — named inline later via `updateStream`.
        streamKey: z.string().min(1).nullish(),
        sourceSchema: z.record(z.string(), z.unknown()).nullish(),
        schemaSource: z.enum(['catalog', 'inferred', 'manual']).optional(),
        syncMode: z.enum(['snapshot', 'incremental']).optional(),
        requestConfig: requestConfigSchema.nullish(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      // Authz: ensures the connector belongs to this org.
      const result = await getConnector(ctx.db, ctx.session.organizationId, id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      return addStream(ctx.db, ctx.session.organizationId, id, rest)
    }),

  setStreamSchema: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        streamId: z.string(),
        sourceSchema: z.record(z.string(), z.unknown()),
        schemaSource: z.enum(['catalog', 'inferred', 'manual']),
        sampleRunId: z.string().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { streamId, ...rest } = input
      return setStreamSchema(ctx.db, ctx.session.organizationId, streamId, rest)
    }),

  setStreamRequestConfig: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        streamId: z.string(),
        requestConfig: requestConfigSchema,
        syncMode: z.enum(['snapshot', 'incremental']).optional(),
        enabled: z.boolean().optional(),
        /**
         * Per-stream record filter (v11), evaluated against the RAW SOURCE record
         * before mapping. Condition `fieldId`s are SOURCE PATHS, not
         * `ResourceFieldId`s — this filters the payload, not the target record.
         * Absent ⇒ untouched; `null` ⇒ cleared. NOT folded into `requestConfig`:
         * that bag is generic-rest-only, and the filter must work for app
         * connectors too.
         */
        recordFilter: conditionGroupsSchema.nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { streamId, ...rest } = input
      return setStreamRequestConfig(ctx.db, ctx.session.organizationId, streamId, rest)
    }),

  updateStream: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        streamId: z.string(),
        streamKey: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { streamId, ...rest } = input
      return updateStream(ctx.db, ctx.session.organizationId, streamId, rest)
    }),

  removeStream: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ streamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return removeStream(ctx.db, ctx.session.organizationId, input.streamId)
    }),

  // ── Mapping setup (admin) ─────────────────────────────────────────────────

  addMapping: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        dataConnectorStreamId: z.string(),
        rootPath: z.string().optional(),
        linkMode: z.enum(['upsert', 'reference']).optional(),
        targetMode: z.enum(['owned', 'contributing']),
        entityDefinitionId: z.string(),
        parentMappingId: z.string().nullish(),
        // The drilled relationship edge as a serialized FieldReference (§9.5).
        relationshipFieldKey: z.string().nullish(),
        fieldMappings: z.array(fieldMappingSchema).optional(),
        orphanBehavior: z.enum(['archive', 'mark_deleted', 'ignore']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return addMapping(ctx.db, ctx.session.organizationId, input)
    }),

  // The single mapping write surface: any subset of a mapping's columns
  // (structural + target binding + per-field policy) in one patch.
  updateMapping: permissionProcedure(PermissionKey.connectorsManage)
    .input(
      z.object({
        mappingId: z.string(),
        rootPath: z.string().optional(),
        linkMode: z.enum(['upsert', 'reference']).optional(),
        parentMappingId: z.string().nullish(),
        relationshipFieldKey: z.string().nullish(),
        orphanBehavior: z.enum(['archive', 'mark_deleted', 'ignore']).optional(),
        entityDefinitionId: z.string().nullish(),
        targetMode: z.enum(['owned', 'contributing']).optional(),
        fieldMappings: z.array(fieldMappingSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { mappingId, ...patch } = input
      return updateMapping(ctx.db, ctx.session.organizationId, mappingId, patch)
    }),

  removeMapping: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ mappingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return removeMapping(ctx.db, ctx.session.organizationId, input.mappingId)
    }),

  // ── Catalog update (plans/money/tasks/41) ──────────────────────────────────

  /**
   * "Update available" for an app connector: whether the installation's current
   * deployment carries a different connector section than the one the rows were seeded
   * from, and the per-row diff the dialog renders. Derived at read time (D2).
   */
  catalogUpdate: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getConnectorCatalogUpdate(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Apply the accepted diff entries through the existing stream/mapping mutations (D4),
   * stamp the new catalog hashes and move `catalogDeploymentId` forward. The client
   * omits a conflict entry to keep its own version.
   */
  applyCatalogUpdate: permissionProcedure(PermissionKey.connectorsManage)
    .input(z.object({ id: z.string(), entryIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyConnectorCatalogUpdate(
        ctx.db,
        ctx.session.organizationId,
        input.id,
        { entryIds: input.entryIds }
      )
      if (result.isErr()) throw result.error
      return result.value
    }),
})
