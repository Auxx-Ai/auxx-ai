// apps/web/src/server/api/routers/dataset.ts

import { schema } from '@auxx/database'
import {
  ChunkingStrategyValues,
  DatasetStatusValues,
  VectorDbTypeValues,
} from '@auxx/database/enums'
import { DatasetService } from '@auxx/lib/datasets'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, sum } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

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
})
export const datasetRouter = createTRPCRouter({
  /**
   * Create a new dataset
   */
  create: protectedProcedure.input(createDatasetSchema).mutation(async ({ ctx, input }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    const userId = ctx.session.user.id
    if (!organizationId) {
      throw new Error('No organization found')
    }

    // Feature gate: check datasets access + limit
    await new FeaturePermissionService(ctx.db).requireAccessAndLimit(
      organizationId,
      FeatureKey.datasets,
      FeatureKey.datasetsLimit,
      async () => {
        const [{ value }] = await ctx.db
          .select({ value: count() })
          .from(schema.Dataset)
          .where(eq(schema.Dataset.organizationId, organizationId))
        return value
      }
    )

    logger.info('Creating dataset', { organizationId, userId, name: input.name })
    const datasetService = new DatasetService(ctx.db)
    const dataset = await datasetService.create(organizationId, userId, input)
    logger.info('Dataset created successfully', { datasetId: dataset.id })
    return dataset
  }),
  /**
   * Get a dataset by ID
   */
  getById: protectedProcedure
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
  getProcessingStatus: protectedProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
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
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetService = new DatasetService(ctx.db)
      await datasetService.delete(input.id, organizationId)
      logger.info('Dataset deleted', { datasetId: input.id, organizationId })
      return { success: true }
    }),
  /**
   * Archive a dataset
   */
  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetService = new DatasetService(ctx.db)
      await datasetService.update(input.id, organizationId, { status: 'INACTIVE' })
      logger.info('Dataset archived', { datasetId: input.id, organizationId })
      return { success: true }
    }),
  /**
   * List datasets for the organization
   */
  list: protectedProcedure.input(listDatasetsSchema).query(async ({ ctx, input }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      return { datasets: [], totalCount: 0, hasMore: false }
    }
    const datasetService = new DatasetService(ctx.db)
    const filters = {
      status: input.status,
      search: input.search,
      createdById: input.createdById,
      dateRange: input.dateRange,
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
  update: protectedProcedure
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
      logger.info('Updating dataset', { datasetId: input.id, organizationId })
      const datasetService = new DatasetService(ctx.db)
      const dataset = await datasetService.update(input.id, organizationId, input.data)
      logger.info('Dataset updated successfully', { datasetId: dataset.id })
      return dataset
    }),
  /**
   * Get dataset statistics
   */
  getStats: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      throw new Error('No organization found')
    }
    const datasetService = new DatasetService(ctx.db)
    return await datasetService.getStats(input.id, organizationId)
  }),
  /**
   * Update dataset metrics (document count, size, etc.)
   */
  updateMetrics: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetService = new DatasetService(ctx.db)
      await datasetService.updateMetrics(input.id, organizationId)
      return { success: true }
    }),
  /**
   * Get organization-level dataset statistics
   */
  getOrganizationStats: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      throw new Error('No organization found')
    }
    // Get overall counts and stats from the database
    const [{ totalCount }] = await ctx.db
      .select({ totalCount: count() })
      .from(schema.Dataset)
      .where(eq(schema.Dataset.organizationId, organizationId))
    const statusCounts = await ctx.db
      .select({ status: schema.Dataset.status, cnt: count() })
      .from(schema.Dataset)
      .where(eq(schema.Dataset.organizationId, organizationId))
      .groupBy(schema.Dataset.status)
    const [{ docSum }] = await ctx.db
      .select({ docSum: sum(schema.Dataset.documentCount).mapWith(Number) })
      .from(schema.Dataset)
      .where(eq(schema.Dataset.organizationId, organizationId))
    const [{ sizeSum }] = await ctx.db
      .select({ sizeSum: sum(schema.Dataset.totalSize).mapWith(Number) })
      .from(schema.Dataset)
      .where(eq(schema.Dataset.organizationId, organizationId))
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
   * Get available embedding options for organization
   */
  getAvailableEmbeddingOptions: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      throw new Error('No organization found')
    }
    const datasetService = new DatasetService(ctx.db)
    return await datasetService.getAvailableEmbeddingOptions(organizationId)
  }),
  /**
   * Get recommended search configuration for a dataset
   */
  getRecommendedSearchConfig: protectedProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
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
          fuzzySearch: true,
          phraseSearch: true,
          rankingMode: 'bm25',
          minScore: 0.1,
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
        textOptions: {
          fuzzySearch: true,
          rankingMode: 'bm25',
        },
      }
    }),
  /**
   * Test search configuration with sample query
   */
  testSearchConfig: protectedProcedure
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
