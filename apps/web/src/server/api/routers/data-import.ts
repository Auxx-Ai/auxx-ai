// apps/web/src/server/api/routers/data-import.ts

import { schema } from '@auxx/database'
import {
  createImportJob,
  deleteJob,
  finalizeUpload,
  getImportableFields,
  getJobByOrg,
  getJobWithMapping,
  getMappablePropertiesWithSamples,
  getMappedColumnsWithStats,
  getPlanErrors,
  getPlanPreviewRows,
  getPlanWithEstimates,
  getResolutionProgress,
  getUniqueValuesWithResolution,
  incrementReceivedChunks,
  listJobsByOrg,
  markJobExecuting,
  markJobPlanning,
  runAutoMap,
  saveMappingProperty,
  storeRawDataChunk,
  updateMappingTitle,
  updateValueResolution,
} from '@auxx/lib/import'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { ResourceRegistryService } from '@auxx/lib/resources'
import { TRPCError } from '@trpc/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Data import tRPC router.
 * Handles CSV import workflow: upload -> map -> resolve -> plan -> execute.
 */
export const dataImportRouter = createTRPCRouter({
  /**
   * Create a new import job.
   * Called at the start of an import to initialize the job and mapping.
   */
  createJob: protectedProcedure
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
   */
  getJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await getJobWithMapping(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      return job
    }),

  /**
   * Upload a chunk of CSV rows.
   */
  uploadChunk: protectedProcedure
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

      // Verify job exists and belongs to org
      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

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
  finalizeUpload: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Get job with mapping (need targetTable for auto-map)
      const job = await getJobWithMapping(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      // Transition to waiting state (ready for mapping)
      await finalizeUpload(ctx.db, input.jobId)

      // Run initial auto-mapping (fallback only, no AI cost)
      try {
        const registry = new ResourceRegistryService(organizationId, ctx.db)
        const resolvedId = await registry.resolveEntityDefId(job.importMapping.entityDefinitionId)
        const resource = await registry.getById(resolvedId)

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
  getImportableFields: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
        includeIdentifiers: z.boolean().optional().default(false),
        includeRelationships: z.boolean().optional().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const registry = new ResourceRegistryService(organizationId, ctx.db)

      // Resolve entity type strings (e.g., "contact") to actual EntityDefinition IDs
      const resolvedId = await registry.resolveEntityDefId(input.entityDefinitionId)
      const resource = await registry.getById(resolvedId)
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
   */
  getMappableProperties: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Verify job access and get mapping ID
      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      return getMappablePropertiesWithSamples(ctx.db, input.jobId, job.importMappingId)
    }),

  /**
   * Save a column mapping.
   */
  saveColumnMapping: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        columnIndex: z.number(),
        targetFieldKey: z.string().nullable(),
        customFieldId: z.string().nullable().optional(),
        resolutionType: z.string(),
        matchField: z.string().optional(),
        relationConfig: z
          .object({
            relatedEntityDefinitionId: z.string(),
            relationshipType: z.enum(['belongs_to', 'has_one', 'has_many', 'many_to_many']),
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Get job and mapping
      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      await saveMappingProperty(ctx.db, {
        mappingId: job.importMappingId,
        columnIndex: input.columnIndex,
        targetFieldKey: input.targetFieldKey,
        customFieldId: input.customFieldId ?? null,
        resolutionType: input.resolutionType,
        matchField: input.matchField,
        relationConfig: input.relationConfig,
        options: input.options,
      })

      return { success: true }
    }),

  /**
   * Auto-map columns to fields based on header names.
   * Uses AI-powered mapping when available, with string-matching fallback.
   */
  autoMapColumns: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        strategy: z.enum(['ai', 'fallback', 'auto']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Get job with mapping
      const job = await getJobWithMapping(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      // Get resource for target entity
      const registry = new ResourceRegistryService(organizationId, ctx.db)
      const resolvedId = await registry.resolveEntityDefId(job.importMapping.entityDefinitionId)
      const resource = await registry.getById(resolvedId)

      if (!resource) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' })
      }

      // Run auto-mapping via lib function
      return runAutoMap(ctx.db, resource, {
        jobId: input.jobId,
        importMappingId: job.importMappingId,
        entityDefinitionId: job.importMapping.entityDefinitionId,
        organizationId,
        userId,
        strategy: input.strategy,
      })
    }),

  /**
   * Get mapped columns with resolution stats.
   */
  getMappedColumns: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

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
  getUniqueValues: protectedProcedure
    .input(z.object({ jobId: z.string(), columnIndex: z.number() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Verify job access
      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      return getUniqueValuesWithResolution(
        ctx.db,
        input.jobId,
        job.importMappingId,
        input.columnIndex
      )
    }),

  /**
   * Trigger value resolution for all mapped columns.
   * Queues a background job to process resolution.
   */
  resolveColumnValues: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

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
  updateValueResolution: protectedProcedure
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

      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      try {
        await updateValueResolution(ctx.db, {
          jobId: input.jobId,
          mappingId: job.importMappingId,
          columnIndex: input.columnIndex,
          hash: input.hash,
          isOverridden: input.isOverridden,
          overrideValues: input.overrideValues,
        })

        return { success: true }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update resolution',
        })
      }
    }),

  /**
   * Get resolution progress.
   */
  getResolutionProgress: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      return getResolutionProgress(ctx.db, input.jobId)
    }),

  /**
   * Generate import plan.
   * Queues a background job to analyze rows and create plan records.
   */
  generatePlan: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

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
  getPlan: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

      return getPlanWithEstimates(ctx.db, input.jobId, job.rowCount)
    }),

  /**
   * Get plan errors.
   */
  getPlanErrors: protectedProcedure
    .input(z.object({ planId: z.string(), limit: z.number().optional().default(10) }))
    .query(async ({ ctx, input }) => {
      return getPlanErrors(ctx.db, input.planId, input.limit)
    }),

  /**
   * Get plan preview rows for displaying in the preview table.
   * Returns paginated rows with resolved field values and strategy.
   */
  getPlanPreview: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        strategy: z.enum(['create', 'update', 'skip']).optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

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
  confirmImport: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const job = await getJobByOrg(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

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
  saveMappingTemplate: protectedProcedure
    .input(z.object({ jobId: z.string(), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const job = await getJobWithMapping(ctx.db, organizationId, input.jobId)

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' })
      }

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
  listJobs: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      return listJobsByOrg(ctx.db, {
        organizationId,
        search: input.search,
      })
    }),

  /**
   * Delete an import job.
   */
  deleteJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

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
