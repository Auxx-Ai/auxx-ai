// apps/web/src/server/api/routers/data-connectors.ts
// tRPC surface for Data Connectors (sync external structured records into the entity
// system). Reads are protectedProcedure; all management + provisioning + setup is
// adminProcedure (a connector provisions entity defs and binds credentials, 05 §1).
// The backend engine (queue/scheduler/orchestrator/provisioning) lives in
// @auxx/lib/data-connectors — this router is a thin, validated edge over it.

import {
  addMapping,
  addStream,
  connectorFor,
  createConnector,
  type DataConnectorType,
  decodeMapping,
  deleteConnector,
  enqueueConnectorSync,
  getConnector,
  listConnectors,
  listMappings,
  listRuns,
  listStreams,
  provisionConnectorMappings,
  removeMapping,
  removeStream,
  setFieldMappings,
  setIdentityStrategy,
  setMappingTarget,
  setMergeStrategies,
  setStreamRequestConfig,
  setStreamSchema,
  updateConnector,
  updateMapping,
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
  recordsPath: z.string().optional(),
})

const fieldMappingSchema = z.object({
  expression: z.string(),
  sourceFields: z.record(z.string(), z.string()),
})

const mergeStrategySchema = z.enum([
  'overwrite',
  'fill_blank',
  'connector_owned_only',
  'manual_review',
  'ignore',
])

const identityStrategySchema = z.union([
  z.object({ kind: z.literal('connectorExternalId') }),
  z.object({
    kind: z.literal('matchField'),
    connectorFieldKey: z.string(),
    targetFieldId: z.string(),
    normalize: z.enum(['email', 'phone', 'domain', 'none']).optional(),
  }),
  z.object({
    kind: z.literal('composite'),
    rules: z.array(
      z.object({
        connectorFieldKey: z.string(),
        targetFieldId: z.string(),
        normalize: z.enum(['email', 'phone', 'domain', 'none']).optional(),
      })
    ),
  }),
  z.object({ kind: z.literal('manualReview') }),
])

/** Max records to pull for a live sampleFetch (schema-inference test fetch). */
const SAMPLE_FETCH_CAP = 25

export const dataConnectorRouter = createTRPCRouter({
  // ── Reads (protected) ─────────────────────────────────────────────────────

  list: protectedProcedure.query(async ({ ctx }) => {
    return listConnectors(ctx.db, ctx.session.organizationId)
  }),

  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
    }
    return result.value
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
      // Authz: ensures the connector belongs to this org before listing.
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      return listStreams(ctx.db, input.id)
    }),

  listMappings: protectedProcedure
    .input(z.object({ streamId: z.string() }))
    .query(async ({ ctx, input }) => {
      const stream = await ctx.db.query.DataConnectorStream.findFirst({
        where: (s, { and, eq }) =>
          and(eq(s.id, input.streamId), eq(s.organizationId, ctx.session.organizationId)),
        columns: { id: true },
      })
      if (!stream) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Stream not found' })
      }
      return listMappings(ctx.db, input.streamId)
    }),

  // ── Management (admin) ────────────────────────────────────────────────────

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        type: connectorTypeSchema,
        config: connectorConfigSchema.optional(),
        credentialId: z.string().nullish(),
        appInstallationId: z.string().nullish(),
        ...scheduleFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
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
    // Gather decoded mappings across the connector's streams.
    const streams = await listStreams(ctx.db, input.id)
    const decoded = []
    for (const stream of streams) {
      const rows = await listMappings(ctx.db, stream.id)
      for (const row of rows) decoded.push(decodeMapping(row))
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
        streamKey: z.string().min(1),
        requestConfig: requestConfigSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await getConnector(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      const connector = result.value
      if (connector.type.startsWith('app:')) {
        throw new TRPCError({
          code: 'NOT_IMPLEMENTED',
          message: 'Test-fetch for app connectors is not wired yet (phase 4).',
        })
      }
      const definition = connectorFor(connector.type)
      const { records } = await definition.fetch({
        streamKey: input.streamKey,
        mode: 'snapshot',
        state: {},
        credential: null,
        config: connector.config,
        requestConfig: input.requestConfig,
      })
      const sample: unknown[] = []
      try {
        for await (const record of records) {
          sample.push(record.fields)
          if (sample.length >= SAMPLE_FETCH_CAP) break
        }
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Test-fetch failed',
        })
      }
      return { records: sample, count: sample.length }
    }),

  addStream: adminProcedure
    .input(
      z.object({
        id: z.string(),
        streamKey: z.string().min(1),
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
        identityStrategy: identityStrategySchema,
        fieldMappings: z.record(z.string(), fieldMappingSchema).optional(),
        mergeStrategies: z.record(z.string(), mergeStrategySchema).optional(),
        orphanBehavior: z.enum(['archive', 'mark_deleted', 'ignore']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return addMapping(ctx.db, ctx.session.organizationId, input)
    }),

  updateMapping: adminProcedure
    .input(
      z.object({
        mappingId: z.string(),
        rootPath: z.string().optional(),
        linkMode: z.enum(['upsert', 'reference']).optional(),
        parentMappingId: z.string().nullish(),
        relationshipFieldKey: z.string().nullish(),
        orphanBehavior: z.enum(['archive', 'mark_deleted', 'ignore']).optional(),
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

  setMappingTarget: adminProcedure
    .input(
      z.object({
        mappingId: z.string(),
        entityDefinitionId: z.string(),
        targetMode: z.enum(['owned', 'contributing']),
        linkMode: z.enum(['upsert', 'reference']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { mappingId, ...rest } = input
      return setMappingTarget(ctx.db, ctx.session.organizationId, mappingId, rest)
    }),

  setFieldMappings: adminProcedure
    .input(
      z.object({
        mappingId: z.string(),
        fieldMappings: z.record(z.string(), fieldMappingSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return setFieldMappings(
        ctx.db,
        ctx.session.organizationId,
        input.mappingId,
        input.fieldMappings
      )
    }),

  setIdentityStrategy: adminProcedure
    .input(z.object({ mappingId: z.string(), identityStrategy: identityStrategySchema }))
    .mutation(async ({ ctx, input }) => {
      return setIdentityStrategy(
        ctx.db,
        ctx.session.organizationId,
        input.mappingId,
        input.identityStrategy
      )
    }),

  setMergeStrategies: adminProcedure
    .input(
      z.object({
        mappingId: z.string(),
        mergeStrategies: z.record(z.string(), mergeStrategySchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return setMergeStrategies(
        ctx.db,
        ctx.session.organizationId,
        input.mappingId,
        input.mergeStrategies
      )
    }),
})
