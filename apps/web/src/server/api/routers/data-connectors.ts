// apps/web/src/server/api/routers/data-connectors.ts
// tRPC surface for Data Connectors (sync external structured records into the entity
// system). Reads are protectedProcedure; all management + provisioning + setup is
// adminProcedure (a connector provisions entity defs and binds credentials, 05 §1).
// The backend engine (queue/scheduler/orchestrator/provisioning) lives in
// @auxx/lib/data-connectors — this router is a thin, validated edge over it.

import { getCachedInstalledApps } from '@auxx/lib/cache'
import {
  addMapping,
  addStream,
  createConnector,
  createConnectorFromTemplate,
  type DataConnectorType,
  decodeMapping,
  deleteConnector,
  enqueueConnectorSync,
  getAllConnectorTemplates,
  getConnector,
  getConnectorTemplateById,
  listConnectors,
  listRuns,
  listStreams,
  provisionConnectorMappings,
  removeMapping,
  removeStream,
  sampleConnectorFetch,
  setStreamRequestConfig,
  setStreamSchema,
  updateConnector,
  updateMapping,
  updateStream,
} from '@auxx/lib/data-connectors'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

// ── Shared zod shapes ─────────────────────────────────────────────────────────

/** Connector type: the built-in `generic-rest`/`fixture` or an `app:<slug>`. */
const connectorTypeSchema = z
  .string()
  .min(1)
  .refine((t) => t === 'generic-rest' || t === 'fixture' || t.startsWith('app:'), {
    message: 'Unknown connector type',
  })

const paginationSchema = z.object({
  kind: z.enum(['cursor', 'page', 'offset', 'link-header', 'none']),
  cursorPath: z.string().optional(),
  cursorParam: z.string().optional(),
  pageParam: z.string().optional(),
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
      })
      .optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const intervalCount = z.union([z.number(), z.string()]).optional()

/** ScheduledTriggerConfig (shared agent/workflow frequency model). Minutes is rejected — the floor is coarse (04). */
const scheduleConfigSchema = z
  .object({
    triggerInterval: z.enum(['minutes', 'hours', 'days', 'weeks', 'custom']),
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
  .refine((c) => c.triggerInterval !== 'minutes', {
    message: 'Minimum sync cadence is hourly.',
  })

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
})

const mergeStrategySchema = z.enum([
  'overwrite',
  'fill_blank',
  'connector_owned_only',
  'manual_review',
  'ignore',
])

// One binding entry. Identity is the stable `id`; `targetFieldKey` is nullable
// (a null entry is an unassigned draft the runtime skips). `mergeStrategy` is
// folded in (no parallel map).
const fieldMappingSchema = z.object({
  id: z.string(),
  targetFieldKey: z.string().nullable(),
  expression: z.string(),
  sourceFields: z.record(z.string(), z.string()),
  // Present → this bound field is also a secondary identity-match key.
  match: z
    .object({ normalize: z.enum(['email', 'phone', 'domain', 'none']).optional() })
    .optional(),
  mergeStrategy: mergeStrategySchema.optional(),
})

export const dataConnectorRouter = createTRPCRouter({
  // ── Reads (protected) ─────────────────────────────────────────────────────

  list: protectedProcedure.query(async ({ ctx }) => {
    return listConnectors(ctx.db, ctx.session.organizationId)
  }),

  /**
   * What the "Connect a source" dialog lists (05c §3): the blank built-in, the
   * first-party templates, and every installed-app connector. The apps section
   * reads the `installedApps` org-cache (already projected with
   * `catalog.dataConnectors`) — no bundle eval, no extra query.
   */
  catalog: protectedProcedure.query(async ({ ctx }) => {
    const installedApps = await getCachedInstalledApps(ctx.session.organizationId)
    const apps = installedApps.flatMap((app) =>
      (app.dataConnectors ?? []).map((dc) => ({
        type: `app:${app.app.slug}`,
        connectorId: dc.id,
        label: dc.label,
        iconKey: dc.iconKey,
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
    }
  }),

  /**
   * The bound connector's declared config schema + request model (05c §3). Feeds
   * the source-config panel's app/template branch real fields instead of the
   * `config._schema` placeholder. Built-ins expose the request builder, so they
   * carry no config schema.
   */
  connectorSchema: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      const connector = result.value
      if (!connector.type.startsWith('app:')) {
        return { requestModel: 'builder' as const, configJsonSchema: null }
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
      }
    }),

  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
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

  /** Lightweight status poll (in-flight sync UI). */
  getStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      const c = result.value
      return {
        status: c.status,
        lastSyncedAt: c.lastSyncedAt,
        itemCount: c.itemCount,
        error: c.error,
      }
    }),

  listRuns: protectedProcedure
    .input(z.object({ id: z.string(), limit: z.number().int().positive().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      return listRuns(ctx.db, ctx.session.organizationId, input.id, input.limit)
    }),

  listStreams: protectedProcedure
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

  create: adminProcedure
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

  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        config: connectorConfigSchema.optional(),
        credentialId: z.string().nullish(),
        appInstallationId: z.string().nullish(),
        // Lifecycle toggle (pause/resume). Other statuses are engine-owned.
        status: z.enum(['paused', 'live']).optional(),
        ...scheduleFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      return updateConnector(ctx.db, ctx.session.organizationId, id, patch)
    }),

  delete: adminProcedure
    .input(
      z.object({
        id: z.string(),
        // keep → leave synced records; archive → soft-delete; delete → hard-delete.
        syncedData: z.enum(['keep', 'archive', 'delete']).default('keep'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return deleteConnector(ctx.db, ctx.session.organizationId, input.id, input.syncedData)
    }),

  syncNow: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    // Authz: ensures the connector belongs to this org before enqueuing.
    const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
    }
    await enqueueConnectorSync({
      connectorId: input.id,
      organizationId: ctx.session.organizationId,
      trigger: 'manual',
    })
    return { success: true }
  }),

  /**
   * Provision schema for every owned/contributing mapping of a connector
   * (provision the def + the mapped fields, 01 §5). Idempotent — re-running
   * reconciles additively keyed by (dataConnectorId, appFieldKey).
   */
  provision: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const organizationId = ctx.session.organizationId
    const result = await getConnector(ctx.db, organizationId, input.id)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
    }
    // Gather decoded mappings across the connector's streams (untargeted rows —
    // a seeded root with no def yet — can't provision, so skip them).
    const streams = await listStreams(ctx.db, organizationId, input.id)
    const decoded = []
    for (const stream of streams) {
      for (const row of stream.mappings) {
        if (row.entityDefinitionId !== null) decoded.push(decodeMapping(row))
      }
    }
    return provisionConnectorMappings(ctx.db, organizationId, input.id, decoded)
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
  sampleFetch: adminProcedure
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

  addStream: adminProcedure
    .input(
      z.object({
        id: z.string(),
        // Omitted for a blank stream — named inline later via `updateStream`.
        streamKey: z.string().min(1).nullish(),
        sourceSchema: z.record(z.string(), z.unknown()).nullish(),
        schemaSource: z.enum(['catalog', 'inferred', 'manual']).optional(),
        syncMode: z.enum(['snapshot', 'incremental', 'webhook']).optional(),
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

  setStreamSchema: adminProcedure
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

  setStreamRequestConfig: adminProcedure
    .input(
      z.object({
        streamId: z.string(),
        requestConfig: requestConfigSchema,
        syncMode: z.enum(['snapshot', 'incremental', 'webhook']).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { streamId, ...rest } = input
      return setStreamRequestConfig(ctx.db, ctx.session.organizationId, streamId, rest)
    }),

  updateStream: adminProcedure
    .input(z.object({ streamId: z.string(), streamKey: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { streamId, ...rest } = input
      return updateStream(ctx.db, ctx.session.organizationId, streamId, rest)
    }),

  removeStream: adminProcedure
    .input(z.object({ streamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return removeStream(ctx.db, ctx.session.organizationId, input.streamId)
    }),

  // ── Mapping setup (admin) ─────────────────────────────────────────────────

  addMapping: adminProcedure
    .input(
      z.object({
        dataConnectorStreamId: z.string(),
        rootPath: z.string().optional(),
        linkMode: z.enum(['upsert', 'reference']).optional(),
        targetMode: z.enum(['owned', 'contributing']),
        entityDefinitionId: z.string(),
        parentMappingId: z.string().nullish(),
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
  updateMapping: adminProcedure
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

  removeMapping: adminProcedure
    .input(z.object({ mappingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return removeMapping(ctx.db, ctx.session.organizationId, input.mappingId)
    }),
})
