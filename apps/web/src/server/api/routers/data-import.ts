// apps/web/src/server/api/routers/data-import.ts

import { schema } from '@auxx/database'
import { findCachedResource } from '@auxx/lib/cache'
import {
  createImportJob,
  deleteJob,
  finalizeUpload,
  getImportableFields,
  getJobByOrg,
  getJobFailureSummary,
  getJobWithMapping,
  getMappablePropertiesWithSamples,
  getMappedColumnsWithStats,
  getNaturalKeyFieldKeys,
  getPlanErrors,
  getPlanPreviewRows,
  getPlanWarnings,
  getPlanWithEstimates,
  getRelationCreateCounts,
  getResolutionProgress,
  getSelectCreateCounts,
  getUniqueValuesWithResolution,
  IMPORT_MERGE_STRATEGIES,
  IMPORT_STRATEGY_MODES,
  incrementReceivedChunks,
  listJobsByOrg,
  markJobExecuting,
  markJobPlanning,
  runAutoMap,
  saveMappingProperty,
  storeRawDataChunk,
  toImportStrategyMode,
  updateImportStrategy,
  updateMappingTitle,
  updateValueResolution,
} from '@auxx/lib/import'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import type { CapabilitySet } from '@auxx/lib/permissions'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { TRPCError } from '@trpc/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, isAuxxError } from '../trpc'

/**
 * The import flow's authorization unit is the TARGET DEFINITION, not the
 * organization.
 *
 * Every procedure here used to be `permissionProcedure(recordsImport)` — the
 * coarse `Full`-rung verb and nothing else. That was wrong in both directions: a
 * member holding `recordsImport` could bulk-write rows into a definition they
 * were explicitly restricted out of, and no per-def grant could ever hand import
 * out for a single definition. Both halves are now `assertImportEntity`, which
 * keeps the coarse verb as one of its two branches (see `canImportRecord`) and so
 * takes nothing away from anyone who could import before.
 *
 * `recordsImport` carries no `featureKey` in `PERMISSION_REGISTRY`, so moving off
 * `permissionProcedure` drops no Layer-1 plan check; `createJob`'s
 * `importRowsLimit` gate is separate and stays.
 */
async function requireImportJob(
  db: Parameters<typeof getJobWithMapping>[0],
  capabilities: CapabilitySet,
  organizationId: string,
  jobId: string
) {
  const job = await getJobWithMapping(db, organizationId, jobId)
  if (!job) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
  }
  capabilities.assertImportEntity(job.importMapping.entityDefinitionId)
  return job
}

/**
 * The identity flag, as the wizard may send it.
 *
 * The connector union carries `normalize?: IdentityNormalize`; this one does
 * NOT, deliberately. The importer already has two normalization authorities that
 * must agree, `normalizeForLookup` (automatic, type-driven) and
 * `checkUniqueValueTyped` (bare `eq`), and a user-settable third is the only
 * one a human can desync by hand. Lib strips it again defensively
 * (`sanitizeIdentityRole`); this schema is what stops it arriving at all.
 */
const identityRoleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('externalId'), order: z.number().int().optional() }),
  z.object({ kind: z.literal('match') }),
])

/**
 * Built from `IMPORT_MERGE_STRATEGIES` rather than a hand-written literal
 * list, so the router's accepted set and the importer's supported set cannot
 * drift. `connector_owned_only` and `manual_review` are connector-only and must
 * never reach an `ImportMappingProperty`.
 */
const mergeStrategySchema = z.enum(IMPORT_MERGE_STRATEGIES)

/** The three job-level import modes, sourced from the same const the lib uses. */
const importStrategyModeSchema = z.enum(IMPORT_STRATEGY_MODES)

/**
 * Data import tRPC router.
 * Handles CSV import workflow: upload -> map -> resolve -> plan -> execute.
 * Every procedure gates on the member's import authority for the job's TARGET
 * definition — see {@link requireImportJob}.
 */
export const dataImportRouter = createTRPCRouter({
  /**
   * Create a new import job.
   * Called at the start of an import to initialize the job and mapping.
   */
  createJob: capabilityProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
        fileName: z.string(),
        headers: z.array(z.object({ index: z.number(), name: z.string() })),
        columnCount: z.number(),
        rowCount: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      // The door: you cannot start an import into a def you may not import into.
      ctx.capabilities.assertImportEntity(input.entityDefinitionId)

      await new FeaturePermissionService().requireLimit(
        organizationId,
        FeatureKey.importRowsLimit,
        async () => input.rowCount
      )

      try {
        const result = await createImportJob(ctx.db, {
          organizationId,
          userId,
          fileName: input.fileName,
          entityDefinitionId: input.entityDefinitionId,
          headers: input.headers,
          columnCount: input.columnCount,
          rowCount: input.rowCount,
        })

        return { id: result.jobId, mappingId: result.mappingId }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create job',
        })
      }
    }),

  /**
   * Get import job details.
   *
   * `importMapping.defaultStrategy` and `.identifierFieldKeys` are normalized
   * on the way out, the columns are plain `text()` / nullable `text[]`, so the
   * wizard would otherwise have to defend against a legacy `'skip'` mode and a
   * NULL key array on every render. These two are what the mode selector and the
   * identity toggles read.
   */
  getJob: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return {
        ...job,
        importMapping: {
          ...job.importMapping,
          defaultStrategy: toImportStrategyMode(job.importMapping.defaultStrategy),
          identifierFieldKeys: job.importMapping.identifierFieldKeys ?? [],
        },
      }
    }),

  /**
   * Upload a chunk of CSV rows.
   */
  uploadChunk: capabilityProcedure
    .input(
      z.object({
        jobId: z.string(),
        chunkIndex: z.number(),
        totalChunks: z.number(),
        rows: z.array(z.array(z.string())),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Verify job exists, belongs to org, and targets an importable def
      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      if (job.status !== 'uploading') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Job is not in uploading state' })
      }

      // Calculate row offset for this chunk
      const startRowIndex = input.chunkIndex * 1000

      // Store raw data using lib function (handles hashing correctly)
      await storeRawDataChunk(ctx.db, input.jobId, input.rows, startRowIndex)

      // Update received chunks count
      await incrementReceivedChunks(ctx.db, input.jobId)

      return { success: true, chunkIndex: input.chunkIndex }
    }),

  /**
   * Finalize the upload and transition to ingesting/waiting state.
   * Also runs initial auto-mapping (fallback only) to pre-populate column mappings.
   */
  finalizeUpload: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Get job with mapping (need targetTable for auto-map)
      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      // Transition to waiting state (ready for mapping)
      await finalizeUpload(ctx.db, input.jobId)

      // Run initial auto-mapping (fallback only, no AI cost)
      try {
        const resource = await findCachedResource(
          organizationId,
          job.importMapping.entityDefinitionId
        )

        if (resource) {
          const result = await runAutoMap(ctx.db, resource, {
            jobId: input.jobId,
            importMappingId: job.importMappingId,
            entityDefinitionId: job.importMapping.entityDefinitionId,
            organizationId,
            userId,
            strategy: 'fallback',
          })

          return { success: true, autoMap: result }
        }
      } catch (error) {
        // Log but don't fail - auto-mapping is nice-to-have
        console.warn('Initial auto-mapping failed:', error)
      }

      return { success: true, autoMap: null }
    }),

  /**
   * Get importable fields for a target table.
   */
  getImportableFields: capabilityProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
        includeIdentifiers: z.boolean().optional().default(false),
        includeRelationships: z.boolean().optional().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Field schema of a def the member may not import into is not theirs to read.
      ctx.capabilities.assertImportEntity(input.entityDefinitionId)
      const resource = await findCachedResource(organizationId, input.entityDefinitionId)
      if (!resource) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' })
      }

      return getImportableFields(resource, {
        includeIdentifiers: input.includeIdentifiers,
        includeRelationships: input.includeRelationships,
      })
    }),

  /**
   * Get mappable properties (column headers) for a job with saved mapping data.
   *
   * The per-column RELATION POLICY (`onNoMatch` / `linkMode`) rides this read
   * rather than a second query key. `saveMappingProperty` rebuilds
   * `resolutionConfig.relationConfig` from its input, so the wizard has to
   * resend the whole config on every write, which means it has to know the
   * stored policy on load — and `getMappablePropertiesWithSamples` already
   * reads and parses the very row it lives on.
   */
  getMappableProperties: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Verify job access, import authority, and get mapping ID
      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return getMappablePropertiesWithSamples(ctx.db, input.jobId, job.importMappingId)
    }),

  /**
   * Save a column mapping.
   */
  saveColumnMapping: capabilityProcedure
    .input(
      z.object({
        jobId: z.string(),
        columnIndex: z.number(),
        targetFieldKey: z.string().nullable(),
        customFieldId: z.string().nullable().optional(),
        resolutionType: z.string(),
        matchField: z.string().optional(),
        /**
         * `matchField` / `onNoMatch` / `linkMode` are per-column POLICY and
         * ride the same call as the target, so a policy change is one mutation.
         * `saveMappingProperty` REBUILDS this object from the input rather than
         * merging it, so the wizard always resends the whole thing, dropping a
         * key here silently reverts that half of the policy.
         */
        relationConfig: z
          .object({
            relatedEntityDefinitionId: z.string(),
            relationshipType: z.enum(['belongs_to', 'has_one', 'has_many', 'many_to_many']),
            matchField: z.string().optional(),
            onNoMatch: z.enum(['create', 'blank', 'fail']).optional(),
            linkMode: z.enum(['add', 'set']).optional(),
          })
          .optional(),
        options: z
          .array(
            z.object({
              value: z.string(),
              label: z.string(),
            })
          )
          .optional(),
        /**
         * Tri-state: omit to leave the stored flag alone, `null` to clear it, a
         * value to set it. Unmapping or retargeting the column clears it
         * regardless, a match key whose field has no mapped column silently
         * reverts the import to create-only.
         */
        identityRole: identityRoleSchema.nullish(),
        /** Same tri-state. Per-column write policy on the update path. */
        mergeStrategy: mergeStrategySchema.nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Get job and mapping, gated on import authority for its target def
      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      // A hand-built or hand-REPAIRED mapping gets the resource's declared
      // natural key defaulted on, exactly like the one auto-map produces —
      // otherwise correcting a mis-mapped key column leaves the job with no
      // match key at all and it silently reverts to create-only.
      const resource = await findCachedResource(
        organizationId,
        job.importMapping.entityDefinitionId
      )

      await saveMappingProperty(ctx.db, {
        mappingId: job.importMappingId,
        columnIndex: input.columnIndex,
        targetFieldKey: input.targetFieldKey,
        customFieldId: input.customFieldId ?? null,
        resolutionType: input.resolutionType,
        matchField: input.matchField,
        relationConfig: input.relationConfig,
        options: input.options,
        identityRole: input.identityRole,
        mergeStrategy: input.mergeStrategy,
        naturalKeyFieldKeys: resource ? getNaturalKeyFieldKeys(resource) : undefined,
      })

      // No mapping row is read back here. The identity toggles and the mode
      // selector do move as a side effect of this per-COLUMN write (the match
      // key is per-JOB), but every caller invalidates `getJob` alongside
      // `getMappableProperties` after the write, so a returned copy would be
      // queried and then thrown away unread.
      return { success: true }
    }),

  /**
   * Set the job-level import mode.
   *
   * The mode ALSO moves on its own, but only when the identifier set crosses
   * between empty and non-empty (`syncMappingIdentity`). A choice made here is
   * never stomped by a later edit to an unrelated column, see that function's
   * docblock for the transition rule.
   */
  setImportStrategy: capabilityProcedure
    .input(z.object({ jobId: z.string(), mode: importStrategyModeSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      await updateImportStrategy(ctx.db, {
        mappingId: job.importMappingId,
        mode: input.mode,
      })

      return { success: true, defaultStrategy: input.mode }
    }),

  /**
   * Auto-map columns to fields based on header names.
   * Uses AI-powered mapping when available, with string-matching fallback.
   */
  autoMapColumns: capabilityProcedure
    .input(
      z.object({
        jobId: z.string(),
        strategy: z.enum(['ai', 'fallback', 'auto']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Get job with mapping
      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      // Get resource for target entity from org cache
      const resource = await findCachedResource(
        organizationId,
        job.importMapping.entityDefinitionId
      )

      if (!resource) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' })
      }

      // Run auto-mapping via lib function
      const result = await runAutoMap(ctx.db, resource, {
        jobId: input.jobId,
        importMappingId: job.importMappingId,
        entityDefinitionId: job.importMapping.entityDefinitionId,
        organizationId,
        userId,
        strategy: input.strategy,
      })

      // Auto-map retargets every column, so it also clears stale identity flags
      // and defaults one back ON — but the wizard re-renders those from the
      // `getJob` invalidation it already runs, not from this payload.
      return result
    }),

  /**
   * Get mapped columns with resolution stats.
   */
  getMappedColumns: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // `getMappedColumnsWithStats` scopes to the org itself, but org scoping is
      // not import authority — the def gate still has to run.
      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      const mappedColumns = await getMappedColumnsWithStats(ctx.db, {
        jobId: input.jobId,
        organizationId,
      })

      if (!mappedColumns) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      return mappedColumns
    }),

  /**
   * Get unique values for a column with resolution status.
   */
  getUniqueValues: capabilityProcedure
    .input(z.object({ jobId: z.string(), columnIndex: z.number() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Verify job access and import authority for its target def
      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return getUniqueValuesWithResolution(ctx.db, {
        jobId: input.jobId,
        mappingId: job.importMappingId,
        columnIndex: input.columnIndex,
        organizationId,
        entityDefinitionId: job.importMapping.entityDefinitionId,
      })
    }),

  /**
   * Trigger value resolution for all mapped columns.
   * Queues a background job to process resolution.
   */
  resolveColumnValues: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      // Queue the resolution job
      const queue = getQueue(Queues.dataImportQueue)
      await queue.add('resolveValuesJob', {
        jobId: input.jobId,
        organizationId,
      })

      return { success: true }
    }),

  /**
   * Update a single value resolution (user override).
   */
  updateValueResolution: capabilityProcedure
    .input(
      z.object({
        jobId: z.string(),
        columnIndex: z.number(),
        hash: z.string(),
        isOverridden: z.boolean(),
        overrideValues: z
          .array(
            z.object({
              type: z.enum(['value', 'create', 'skip']),
              value: z.string(),
              id: z.string().optional(),
            })
          )
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      try {
        await updateValueResolution(ctx.db, {
          jobId: input.jobId,
          mappingId: job.importMappingId,
          columnIndex: input.columnIndex,
          hash: input.hash,
          isOverridden: input.isOverridden,
          overrideValues: input.overrideValues,
          organizationId,
          entityDefinitionId: job.importMapping.entityDefinitionId,
        })

        return { success: true }
      } catch (error) {
        // A typed override that the resolver rejects is a 422 the reviewer has
        // to see, not a 500. Flattening it here is what the `isAuxxError` guard
        // exists to prevent — `auxxErrorMiddleware` maps the status itself.
        if (isAuxxError(error)) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update resolution',
        })
      }
    }),

  /**
   * Get resolution progress.
   */
  getResolutionProgress: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return getResolutionProgress(ctx.db, input.jobId)
    }),

  /**
   * Generate import plan.
   * Queues a background job to analyze rows and create plan records.
   */
  generatePlan: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      // Update job status to planning
      await markJobPlanning(ctx.db, input.jobId)

      // Queue the planning job (async, with SSE progress)
      const queue = getQueue(Queues.dataImportQueue)
      await queue.add('generatePlanJob', {
        jobId: input.jobId,
        organizationId,
      })

      return { success: true }
    }),

  /**
   * Get import plan with estimates.
   */
  getPlan: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return getPlanWithEstimates(ctx.db, input.jobId, job.rowCount)
    }),

  /**
   * How many records `onNoMatch: 'create'` will mint, per relation column.
   *
   * This is what makes defaulting a relation column to *Create* safe: the
   * preview says *"8 companies will be created"* before anything is written.
   * Nothing is minted until execution, so this is a pure read of the pending
   * `relationCreate` markers on the resolutions.
   */
  getRelationCreateCounts: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return getRelationCreateCounts(ctx.db, input.jobId)
    }),

  /**
   * Which OPTIONS a `select:create` column will append to its field, by name.
   *
   * The counterpart to {@link getRelationCreateCounts}, and the safety story
   * for the resolution-type picker: creation is opt-in by CHOOSING
   * `select:create` on the column, so the only thing standing between a typo in
   * row 47 and a permanent option on the field is seeing the list before Import
   * is pressed. Nothing is written until execution — the underlying read folds
   * labels onto existing options through the same `mintOrMatchOptions` dry run
   * the real write uses, so the preview cannot promise options the run will not
   * create.
   */
  getSelectCreateCounts: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return getSelectCreateCounts(ctx.db, input.jobId)
    }),

  /**
   * Get plan errors.
   */
  getPlanErrors: capabilityProcedure
    .input(z.object({ planId: z.string(), limit: z.number().optional().default(10) }))
    .query(async ({ ctx, input }) => {
      // The only procedure keyed on a PLAN rather than a job — and, before this
      // pass, the only one with no org scoping at all: a bare `planId` returned
      // another organization's import errors. Resolve plan → job, then gate.
      const plan = await ctx.db.query.ImportPlan.findFirst({
        where: eq(schema.ImportPlan.id, input.planId),
        columns: { importJobId: true },
      })
      if (!plan) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import plan not found' })
      }
      await requireImportJob(ctx.db, ctx.capabilities, ctx.session.organizationId, plan.importJobId)

      return getPlanErrors(ctx.db, input.planId, input.limit)
    }),

  /**
   * Get a finished job's execution failures, grouped by reason.
   *
   * Keyed on the job, not a plan: the outcome card knows which job it ran, and
   * a job accumulates one plan per mapping revision. Grouped because a systemic
   * failure (one unmapped required field) produces an identical message on
   * every row, and 201 copies of it hide the one fact worth reading.
   */
  getJobFailures: capabilityProcedure
    .input(z.object({ jobId: z.string(), limit: z.number().optional().default(10) }))
    .query(async ({ ctx, input }) => {
      await requireImportJob(ctx.db, ctx.capabilities, ctx.session.organizationId, input.jobId)

      return getJobFailureSummary(ctx.db, input.jobId, input.limit)
    }),

  /**
   * Get plan warnings (rows that imported with non-fatal issues).
   */
  getPlanWarnings: capabilityProcedure
    .input(z.object({ planId: z.string(), limit: z.number().optional().default(10) }))
    .query(async ({ ctx, input }) => {
      // Same plan → job resolution + gate as getPlanErrors.
      const plan = await ctx.db.query.ImportPlan.findFirst({
        where: eq(schema.ImportPlan.id, input.planId),
        columns: { importJobId: true },
      })
      if (!plan) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import plan not found' })
      }
      await requireImportJob(ctx.db, ctx.capabilities, ctx.session.organizationId, plan.importJobId)

      return getPlanWarnings(ctx.db, input.planId, input.limit)
    }),

  /**
   * Get plan preview rows for displaying in the preview table.
   * Returns paginated rows with resolved field values and strategy.
   */
  getPlanPreview: capabilityProcedure
    .input(
      z.object({
        jobId: z.string(),
        // Four row strategies, not three. `skip` is "this row has an error";
        // `unmatched` is "update-only mode found no record", a filter that
        // cannot name the second hides a whole class of unimported rows.
        strategy: z.enum(['create', 'update', 'skip', 'unmatched']).optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      return getPlanPreviewRows(ctx.db, {
        jobId: input.jobId,
        strategy: input.strategy,
        limit: input.limit,
        offset: input.offset,
      })
    }),

  /**
   * Confirm and execute the import.
   */
  confirmImport: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      if (job.status !== 'ready') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Job is not ready for execution' })
      }

      // Fetch the most recent plan for this job
      const plan = await ctx.db.query.ImportPlan.findFirst({
        where: eq(schema.ImportPlan.importJobId, input.jobId),
        orderBy: desc(schema.ImportPlan.createdAt),
      })

      if (!plan) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import plan not found' })
      }

      // Mark job as executing
      await markJobExecuting(ctx.db, input.jobId)

      // Queue the execution job
      const queue = getQueue(Queues.dataImportQueue)
      await queue.add('executePlanJob', {
        jobId: input.jobId,
        planId: plan.id,
        organizationId,
        userId,
      })

      return { success: true }
    }),

  /**
   * Save mapping as a reusable template.
   */
  saveMappingTemplate: capabilityProcedure
    .input(z.object({ jobId: z.string(), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      // Update mapping title if provided
      if (input.title) {
        await updateMappingTitle(ctx.db, {
          mappingId: job.importMappingId,
          title: input.title,
        })
      }

      return { mappingId: job.importMappingId }
    }),

  /**
   * List all import jobs for the organization.
   */
  listJobs: capabilityProcedure
    .input(
      z.object({
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Filtered rather than gated: the history list spans every def in the org,
      // so a single assert has nothing to assert on. `listJobsByOrg` already
      // selects `importMapping.entityDefinitionId`, so this is an in-memory pass
      // over rows already fetched — no extra query, and it reproduces exactly
      // what `getJob` would answer per row.
      const jobs = await listJobsByOrg(ctx.db, {
        organizationId,
        search: input.search,
      })

      return jobs.filter((job) =>
        ctx.capabilities.canImportEntity(job.importMapping.entityDefinitionId)
      )
    }),

  /**
   * Delete an import job.
   */
  deleteJob: capabilityProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Gate BEFORE the delete — `deleteJob` is org-scoped only, so without this
      // a member could discard the import history of a def they cannot touch.
      await requireImportJob(ctx.db, ctx.capabilities, organizationId, input.jobId)

      const deleted = await deleteJob(ctx.db, {
        jobId: input.jobId,
        organizationId,
      })

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      return { success: true }
    }),
})
