// apps/web/src/server/api/routers/dataset.ts

import { schema } from '@auxx/database'
import {
  ChunkingStrategyValues,
  DatasetStatusValues,
  VectorDbTypeValues,
} from '@auxx/database/enums'
import { onCacheEvent } from '@auxx/lib/cache'
import { DatasetService } from '@auxx/lib/datasets'
import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, inArray, notInArray, sum } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

const logger = createScopedLogger('api/dataset')

/** Preprocessing options schema for chunk settings */
const chunkPreprocessingSchema = z.object({
  normalizeWhitespace: z.boolean().default(true),
  removeUrlsAndEmails: z.boolean().default(false),
})

/** Chunk settings schema */
const chunkSettingsSchema = z.object({
  strategy: z.enum(ChunkingStrategyValues).default('FIXED_SIZE'),
  size: z.number().min(100).max(5000).default(1000),
  overlap: z.number().min(0).max(1000).default(200),
  delimiter: z.string().max(50).nullable().optional(),
  preprocessing: chunkPreprocessingSchema.default({
    normalizeWhitespace: true,
    removeUrlsAndEmails: false,
  }),
})

// Input validation schemas
const createDatasetSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  chunkSettings: chunkSettingsSchema.optional(),
  vectorDbType: z.enum(VectorDbTypeValues).default('POSTGRESQL'),
  vectorDbConfig: z.record(z.string(), z.any()).optional(),
  embeddingModel: z.string().optional(), // "provider:model" format, optional (uses system default)
  vectorDimension: z.number().min(128).max(4096).optional(), // Optional, derived from model
})
const updateDatasetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(DatasetStatusValues).optional(),
  chunkSettings: chunkSettingsSchema.partial().optional(),
  vectorDbType: z.enum(VectorDbTypeValues).optional(),
  vectorDbConfig: z.record(z.string(), z.any()).optional(),
  // Embedding configuration - embeddingModel uses "provider:model" format (e.g., "openai:text-embedding-3-large")
  embeddingModel: z.string().optional(),
  vectorDimension: z.number().min(128).max(4096).optional(),
  // Search configuration field
  searchConfig: z
    .object({
      searchType: z.enum(['vector', 'text', 'hybrid']).optional(),
    })
    .and(z.record(z.string(), z.any()))
    .optional(),
})
const listDatasetsSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  sortBy: z.string().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z.enum(DatasetStatusValues).optional(),
  search: z.string().optional(),
  createdById: z.string().optional(),
  dateRange: z
    .object({
      start: z.date(),
      end: z.date(),
    })
    .optional(),
  /** Pass false to include managed datasets (e.g. KB-backed). Default hides them. */
  hideManaged: z.boolean().optional(),
})
export const datasetRouter = createTRPCRouter({
  /**
   * Create a new dataset
   */
  create: capabilityProcedure.input(createDatasetSchema).mutation(async ({ ctx, input }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    const userId = ctx.session.user.id
    if (!organizationId) {
      throw new Error('No organization found')
    }

    // L2 area gate: creating a dataset requires `datasets` Full (no instance
    // exists yet to key on). Plan-AND with the Layer-1 feature/limit gate below.
    ctx.capabilities.assert(PermissionKey.datasetsManage)

    // Feature gate: check datasets access + limit
    // Exclude managed datasets (e.g. KB-synced private datasets) — they don't count toward plan limits.
    await new FeaturePermissionService(ctx.db).requireAccessAndLimit(
      organizationId,
      FeatureKey.datasets,
      FeatureKey.datasetsLimit,
      async () => {
        const [{ value }] = await ctx.db
          .select({ value: count() })
          .from(schema.Dataset)
          .where(
            and(
              eq(schema.Dataset.organizationId, organizationId),
              eq(schema.Dataset.isManaged, false)
            )
          )
        return value
      }
    )

    logger.info('Creating dataset', { organizationId, userId, name: input.name })
    const datasetService = new DatasetService(ctx.db)
    const dataset = await datasetService.create(organizationId, userId, input)
    logger.info('Dataset created successfully', { datasetId: dataset.id })
    await onCacheEvent('dataset.created', { orgId: organizationId })
    return dataset
  }),
  /**
   * Get a dataset by ID
   */
  getById: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        includeStats: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        return null
      }
      ctx.capabilities.assertViewInstance('dataset', input.id)
      const datasetService = new DatasetService(ctx.db)
      const dataset = await datasetService.getById(input.id, organizationId)
      if (!dataset) return null
      // Include additional stats if requested
      if (input.includeStats) {
        const [{ dc, ts }] = await ctx.db
          .select({ dc: count(), ts: sum(schema.Document.size).mapWith(Number) })
          .from(schema.Document)
          .where(
            and(
              eq(schema.Document.datasetId, input.id),
              eq(schema.Document.organizationId, organizationId)
            )
          )
        return {
          ...dataset,
          documentCount: Number(dc || 0),
          totalSize: BigInt(Math.floor((ts as number) || 0)),
        }
      }
      return dataset
    }),
  /**
   * Get processing status for a dataset
   */
  getProcessingStatus: capabilityProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      ctx.capabilities.assertViewInstance('dataset', input.datasetId)
      // Get document processing statistics
      const [{ total }] = await ctx.db
        .select({ total: count() })
        .from(schema.Document)
        .where(
          and(
            eq(schema.Document.datasetId, input.datasetId),
            eq(schema.Document.organizationId, organizationId)
          )
        )
      const [{ processed }] = await ctx.db
        .select({ processed: count() })
        .from(schema.Document)
        .where(
          and(
            eq(schema.Document.datasetId, input.datasetId),
            eq(schema.Document.organizationId, organizationId),
            eq(schema.Document.status, 'INDEXED' as any)
          )
        )
      const docsByStatus = await ctx.db
        .select({ status: schema.Document.status, cnt: count() })
        .from(schema.Document)
        .where(
          and(
            eq(schema.Document.datasetId, input.datasetId),
            eq(schema.Document.organizationId, organizationId)
          )
        )
        .groupBy(schema.Document.status)
      const statusCounts = docsByStatus.reduce(
        (acc, item) => {
          acc[item.status as unknown as string] = Number(item.cnt || 0)
          return acc
        },
        {} as Record<string, number>
      )
      return {
        queuedJobs: statusCounts.UPLOADED || 0,
        activeJobs: statusCounts.PROCESSING || 0,
        completedJobs: statusCounts.INDEXED || 0,
        failedJobs: statusCounts.FAILED || 0,
        totalDocuments: Number(total || 0),
        processedDocuments: Number(processed || 0),
        estimatedTimeRemaining: statusCounts.PROCESSING > 0 ? '5-10 minutes' : null,
      }
    }),
  /**
   * Delete a dataset
   */
  delete: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      ctx.capabilities.assertAdminInstance('dataset', input.id)
      const datasetService = new DatasetService(ctx.db)
      await datasetService.delete(input.id, organizationId)
      logger.info('Dataset deleted', { datasetId: input.id, organizationId })
      await onCacheEvent('dataset.deleted', { orgId: organizationId })
      return { success: true }
    }),
  /**
   * Archive a dataset
   */
  archive: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      ctx.capabilities.assertAdminInstance('dataset', input.id)
      const datasetService = new DatasetService(ctx.db)
      await datasetService.update(input.id, organizationId, { status: 'INACTIVE' })
      logger.info('Dataset archived', { datasetId: input.id, organizationId })
      return { success: true }
    }),
  /**
   * List datasets for the organization
   */
  list: capabilityProcedure.input(listDatasetsSchema).query(async ({ ctx, input }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      return { datasets: [], totalCount: 0, hasMore: false }
    }
    // No coarse assert — narrow to the datasets the member may view (a
    // `datasets: None` member gets an empty list rather than a 403, which
    // matters because this feeds passive UI like the permission grids).
    //
    // The filter is computed UP FRONT and handed to the query, so `limit`,
    // `page`, `totalCount` and `hasMore` all describe the FILTERED set.
    // Filtering the returned page instead (what this did originally) leaves
    // `totalCount`/`hasMore` describing the unfiltered page, returns short
    // pages, and can hand back an EMPTY page with `hasMore: true` — which
    // breaks any client that stops on an empty page.
    //
    // Two shapes, because `instanceListScope` is the list-side twin of
    // `canViewInstance` and that gate now has two regimes (plan 25 §2):
    //  - open `datasets` area → `exclude`, near-empty in practice (`dataset` is
    //    `baselineAtCreate: false`, so the ONLY exclusions are explicitly
    //    restricted datasets);
    //  - `datasets: None` + explicit grants → `include`, naming exactly the
    //    datasets shared with this member. Returning an empty list here instead
    //    would contradict `getById`, which lets them open it.
    const scope = ctx.capabilities.instanceListScope('dataset')
    if (scope.kind === 'none') return { datasets: [], totalCount: 0, hasMore: false }

    const datasetService = new DatasetService(ctx.db)
    const filters = {
      status: input.status,
      search: input.search,
      createdById: input.createdById,
      dateRange: input.dateRange,
      hideManaged: input.hideManaged,
      excludeIds: scope.excludeIds,
      includeIds: scope.includeIds,
    }
    const pagination = {
      page: input.page,
      limit: input.limit,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    }
    return await datasetService.list(organizationId, filters, pagination)
  }),
  /**
   * Update a dataset
   */
  update: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateDatasetSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      // Full — updating a dataset's metadata / embedding / search settings.
      ctx.capabilities.assertAdminInstance('dataset', input.id)
      logger.info('Updating dataset', { datasetId: input.id, organizationId })
      const datasetService = new DatasetService(ctx.db)
      const dataset = await datasetService.update(input.id, organizationId, input.data)
      logger.info('Dataset updated successfully', { datasetId: dataset.id })
      return dataset
    }),
  /**
   * Get dataset statistics
   */
  getStats: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      ctx.capabilities.assertViewInstance('dataset', input.id)
      const datasetService = new DatasetService(ctx.db)
      return await datasetService.getStats(input.id, organizationId)
    }),
  /**
   * Update dataset metrics (document count, size, etc.)
   */
  updateMetrics: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      // Write — content-metrics churn (document count / size), not settings.
      ctx.capabilities.assertEditInstance('dataset', input.id)
      const datasetService = new DatasetService(ctx.db)
      await datasetService.updateMetrics(input.id, organizationId)
      return { success: true }
    }),
  /**
   * Get organization-level dataset statistics
   */
  getOrganizationStats: capabilityProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      throw new Error('No organization found')
    }
    // NOT a coarse `datasetsView` assert. The area Read rung is now SYNTHESIZED
    // from a member's instance grants (`UserCapabilities.instanceDerivedKeys`),
    // so a member shared exactly ONE dataset holds `datasets.view` — and this
    // is an org-wide aggregate, which under that key would have handed them
    // counts, document totals and byte sizes for every dataset in the org.
    //
    // Scoped instead, the same way `list` is: the totals describe exactly the
    // datasets the member may open, so the stat tiles agree with the grid
    // beneath them. A member with no datasets at all gets zeros rather than a
    // 403, matching `list`'s empty page (the landing page owns the "No Access"
    // surface).
    const scope = ctx.capabilities.instanceListScope('dataset')
    if (scope.kind === 'none') {
      return { total: 0, byStatus: {} as Record<string, number>, totalDocuments: 0, totalSize: 0n }
    }
    // Get overall counts and stats from the database.
    // Managed datasets (KB-synced private datasets) are hidden from /app/datasets and
    // excluded here so the totals match what the user actually sees and can manage.
    const userDatasetFilter = and(
      eq(schema.Dataset.organizationId, organizationId),
      eq(schema.Dataset.isManaged, false),
      scope.excludeIds?.length ? notInArray(schema.Dataset.id, scope.excludeIds) : undefined,
      scope.includeIds ? inArray(schema.Dataset.id, scope.includeIds) : undefined
    )
    const [{ totalCount }] = await ctx.db
      .select({ totalCount: count() })
      .from(schema.Dataset)
      .where(userDatasetFilter)
    const statusCounts = await ctx.db
      .select({ status: schema.Dataset.status, cnt: count() })
      .from(schema.Dataset)
      .where(userDatasetFilter)
      .groupBy(schema.Dataset.status)
    const [{ docSum }] = await ctx.db
      .select({ docSum: sum(schema.Dataset.documentCount).mapWith(Number) })
      .from(schema.Dataset)
      .where(userDatasetFilter)
    const [{ sizeSum }] = await ctx.db
      .select({ sizeSum: sum(schema.Dataset.totalSize).mapWith(Number) })
      .from(schema.Dataset)
      .where(userDatasetFilter)
    // Transform status counts into a more usable format
    const byStatus = statusCounts.reduce(
      (acc, item) => {
        acc[item.status as unknown as string] = Number(item.cnt || 0)
        return acc
      },
      {} as Record<string, number>
    )
    return {
      total: Number(totalCount || 0),
      byStatus,
      totalDocuments: Number(docSum || 0),
      totalSize: BigInt(Math.floor((sizeSum as number) || 0)),
    }
  }),
  /**
   * Get the org's default embedding model, for one dataset's settings form.
   *
   * Takes a `datasetId` and asserts per instance. It used to be an instance-LESS
   * query gated on the coarse `datasetsView` rung, which stopped being a real
   * gate once that rung became derivable from a single instance grant — and this
   * returns org-level AI configuration, not dataset content. Its only caller is
   * the per-dataset Embedding settings section, which always has the dataset in
   * hand, so naming it costs nothing and makes the gate honest.
   */
  getAvailableEmbeddingOptions: capabilityProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      ctx.capabilities.assertViewInstance('dataset', input.datasetId)
      const datasetService = new DatasetService(ctx.db)
      return await datasetService.getAvailableEmbeddingOptions(organizationId)
    }),
  /**
   * Get recommended search configuration for a dataset
   */
  getRecommendedSearchConfig: capabilityProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      ctx.capabilities.assertViewInstance('dataset', input.datasetId)
      // Get dataset info for recommendations
      const [dataset] = await ctx.db
        .select({
          documentCount: schema.Dataset.documentCount,
          totalSize: schema.Dataset.totalSize,
        })
        .from(schema.Dataset)
        .where(
          and(
            eq(schema.Dataset.id, input.datasetId),
            eq(schema.Dataset.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!dataset) {
        throw new Error('Dataset not found')
      }
      // Simple recommendation logic
      const docCount = dataset.documentCount
      const avgDocSize = docCount > 0 ? Number(dataset.totalSize) / docCount : 0
      // Small datasets (< 100 docs) - favor text search
      if (docCount < 100) {
        return {
          searchType: 'text',
        }
      }
      // Large datasets (> 10k docs) - favor vector search
      if (docCount > 10000) {
        return {
          searchType: 'vector',
          similarityThreshold: 0.3,
          maxResults: 20,
          includeMetadata: true,
          searchMode: 'similarity',
        }
      }
      // Medium datasets - hybrid approach
      return {
        searchType: 'hybrid',
        vectorWeight: 0.6,
        textWeight: 0.4,
        combineMethod: 'weighted_sum',
        vectorOptions: {
          similarityThreshold: 0.3,
          maxResults: 15,
        },
      }
    }),
  /**
   * Test search configuration with sample query
   */
  testSearchConfig: capabilityProcedure
    .input(
      z.object({
        datasetId: z.string(),
        testQuery: z.string().min(1).max(500),
        searchConfig: z.record(z.string(), z.any()),
        includeInactive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      const userId = ctx.session.user.id
      if (!organizationId) {
        throw new Error('No organization found')
      }
      // Read — running an ephemeral test search returns nothing a view-level
      // user can't already see via listByDocument (includeInactive only
      // surfaces disabled segments, same view). Saving config (`dataset.update`)
      // stays admin; this just executes a throwaway query.
      ctx.capabilities.assertViewInstance('dataset', input.datasetId)
      logger.info('Testing search configuration', {
        datasetId: input.datasetId,
        testQuery: input.testQuery,
        organizationId,
      })
      try {
        // Import SearchService dynamically to avoid circular dependencies
        const { SearchService } = await import('@auxx/lib/datasets')
        const searchQuery = {
          query: input.testQuery,
          datasetIds: [input.datasetId],
          limit: 10, // Limited results for testing
          searchType: input.searchConfig.searchType || 'hybrid',
          includeInactive: input.includeInactive,
          ...input.searchConfig,
        }
        const results = await SearchService.search(searchQuery as any, organizationId, userId)
        return {
          success: true,
          results: results.results, // Return all results up to the limit
          metrics: {
            totalResults: results.total,
            responseTime: results.responseTime,
            searchType: results.searchType,
          },
        }
      } catch (error) {
        logger.error('Search configuration test failed', {
          error: error instanceof Error ? error.message : error,
          datasetId: input.datasetId,
          organizationId,
        })
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Search test failed',
          results: [],
          metrics: null,
        }
      }
    }),
})
