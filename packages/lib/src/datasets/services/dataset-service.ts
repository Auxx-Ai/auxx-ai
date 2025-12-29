// packages/lib/src/datasets/services/dataset-service.ts

import type {
  CreateDatasetInput,
  UpdateDatasetInput,
  DatasetWithRelations,
  DatasetListResponse,
  DatasetFilters,
  PaginationParams,
  DatasetStats,
  ChunkSettings,
} from '../types'
import { schema, type Database } from '@auxx/database'
import { DEFAULT_CHUNK_SETTINGS } from '@auxx/database/types'
import {
  and,
  asc,
  avg,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm'

import { DatasetError } from '../types'
import { DatasetEmbeddingValidator } from './dataset-embedding-validator'
import { DocumentService } from './document-service'
import { createScopedLogger } from '@auxx/logger'
import { SystemModelService } from '../../ai/providers/system-model-service'
import { ModelType } from '../../ai/providers/types'

const logger = createScopedLogger('dataset-service')

/**
 * Service for managing datasets
 */
export class DatasetService {
  constructor(private db: Database) {}

  /**
   * Create a new dataset with validated embedding configuration
   */
  async create(
    organizationId: string,
    userId: string,
    input: CreateDatasetInput
  ): Promise<DatasetWithRelations> {
    try {
      // Check if dataset name already exists in organization
      const existing = await this.db.query.Dataset.findFirst({
        where: and(
          eq(schema.Dataset.organizationId, organizationId),
          eq(schema.Dataset.name, input.name)
        ),
        columns: { id: true },
      })

      if (existing) {
        throw new DatasetError('Dataset name already exists', 'DATASET_NAME_EXISTS')
      }

      // Resolve embedding configuration using provided values or organization defaults
      const embeddingConfig = await DatasetEmbeddingValidator.resolveEmbeddingConfig(
        input.embeddingModel, // "provider:model" format or undefined
        input.vectorDimension,
        organizationId
      )

      // Merge input chunk settings with defaults
      const chunkSettings: ChunkSettings = {
        ...DEFAULT_CHUNK_SETTINGS,
        ...input.chunkSettings,
        preprocessing: {
          ...DEFAULT_CHUNK_SETTINGS.preprocessing,
          ...input.chunkSettings?.preprocessing,
        },
      }

      logger.info('Creating dataset with resolved embedding configuration', {
        datasetName: input.name,
        embeddingConfig,
        chunkSettings,
        organizationId,
      })

      const timestamp = new Date()

      const [createdDataset] = await this.db
        .insert(schema.Dataset)
        .values({
          name: input.name,
          description: input.description,
          chunkSettings,
          vectorDbType: input.vectorDbType ?? 'POSTGRESQL',
          vectorDbConfig: input.vectorDbConfig ?? {},
          embeddingModel: embeddingConfig.modelId, // Store full "provider:model" format
          vectorDimension: embeddingConfig.dimensions,
          organizationId,
          createdById: userId,
          updatedAt: timestamp,
        })
        .returning({ id: schema.Dataset.id })

      if (!createdDataset) {
        throw new DatasetError('Failed to create dataset', 'CREATE_DATASET_ERROR')
      }

      const dataset = await this.fetchDatasetWithRelations(createdDataset.id, organizationId)

      if (!dataset) {
        throw new DatasetError('Failed to load dataset after creation', 'CREATE_DATASET_ERROR')
      }

      logger.info('Dataset created successfully with embedding configuration', {
        datasetId: dataset.id,
        datasetName: dataset.name,
        embeddingModel: embeddingConfig.modelId,
        vectorDimension: embeddingConfig.dimensions,
        organizationId,
      })

      return dataset
    } catch (error) {
      if (error instanceof DatasetError) throw error
      logger.error('Failed to create dataset', {
        error: error instanceof Error ? error.message : error,
        input,
        organizationId,
        userId,
      })
      throw new DatasetError('Failed to create dataset', 'CREATE_DATASET_ERROR', { error })
    }
  }

  /**
   * Get a dataset by ID
   */
  async getById(datasetId: string, organizationId: string): Promise<DatasetWithRelations | null> {
    try {
      return await this.fetchDatasetWithRelations(datasetId, organizationId, 10)
    } catch (error) {
      throw new DatasetError('Failed to get dataset', 'GET_DATASET_ERROR', { error })
    }
  }

  /**
   * List datasets for an organization
   */
  async list(
    organizationId: string,
    filters?: DatasetFilters,
    pagination?: PaginationParams
  ): Promise<DatasetListResponse> {
    try {
      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = pagination || {}
      const offset = (page - 1) * limit

      const whereClause = this.buildDatasetWhereClause(organizationId, filters)
      const orderColumn = this.getDatasetSortColumn(sortBy)
      const orderExpression = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn)

      const [datasets, totalResult] = await Promise.all([
        this.db.query.Dataset.findMany({
          where: whereClause,
          orderBy: orderExpression,
          limit,
          offset,
          with: {
            organization: {
              columns: { id: true, name: true },
            },
            createdBy: {
              columns: { id: true, name: true, email: true },
            },
            documents: {
              orderBy: (document, { desc }) => [desc(document.createdAt)],
              limit: 5,
            },
          },
          extras: {
            documentsCount:
              sql<number>`(SELECT COUNT(*) FROM "Document" WHERE "datasetId" = ${schema.Dataset.id})`.as(
                'documentsCount'
              ),
            searchQueriesCount:
              sql<number>`(SELECT COUNT(*) FROM "DatasetSearchQuery" WHERE "datasetId" = ${schema.Dataset.id})`.as(
                'searchQueriesCount'
              ),
          },
        }),
        this.db.select({ value: count() }).from(schema.Dataset).where(whereClause),
      ])

      const totalCount = Number(totalResult[0]?.value ?? 0)
      const mappedDatasets = datasets.map((dataset) => this.transformDatasetRow(dataset))

      return {
        datasets: mappedDatasets,
        totalCount,
        hasMore: totalCount > offset + mappedDatasets.length,
      }
    } catch (error) {
      throw new DatasetError('Failed to list datasets', 'LIST_DATASETS_ERROR', { error })
    }
  }

  /**
   * Update a dataset
   */
  async update(
    datasetId: string,
    organizationId: string,
    input: UpdateDatasetInput
  ): Promise<DatasetWithRelations> {
    try {
      // Check if new name conflicts (if name is being changed)
      if (input.name) {
        const existing = await this.db.query.Dataset.findFirst({
          where: and(
            eq(schema.Dataset.organizationId, organizationId),
            eq(schema.Dataset.name, input.name),
            ne(schema.Dataset.id, datasetId)
          ),
          columns: { id: true },
        })

        if (existing) {
          throw new DatasetError('Dataset name already exists', 'DATASET_NAME_EXISTS')
        }
      }

      // Validate embedding model if being updated
      if (input.embeddingModel) {
        const validation = await DatasetEmbeddingValidator.validateEmbeddingConfig(
          input.embeddingModel,
          organizationId
        )

        if (!validation.isValid) {
          throw new DatasetError(
            `Invalid embedding configuration: ${validation.errors.join(', ')}`,
            'INVALID_EMBEDDING_CONFIG',
            { validation }
          )
        }

        // If vectorDimension not provided, get default for model
        if (!input.vectorDimension) {
          const [, ...modelParts] = input.embeddingModel.split(':')
          const modelName = modelParts.join(':')
          input.vectorDimension = DatasetEmbeddingValidator.getModelDimensions(modelName)
        }
      }

      const updatePayload: Record<string, unknown> = {
        ...input,
        updatedAt: new Date(),
      }

      for (const key of Object.keys(updatePayload)) {
        if (updatePayload[key] === undefined) {
          delete updatePayload[key]
        }
      }

      const [updated] = await this.db
        .update(schema.Dataset)
        .set(updatePayload)
        .where(
          and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
        )
        .returning({ id: schema.Dataset.id })

      if (!updated) {
        throw new DatasetError('Dataset not found', 'DATASET_NOT_FOUND')
      }

      const dataset = await this.fetchDatasetWithRelations(updated.id, organizationId)

      if (!dataset) {
        throw new DatasetError('Dataset not found', 'DATASET_NOT_FOUND')
      }

      logger.info('Dataset updated successfully', {
        datasetId: dataset.id,
        datasetName: dataset.name,
        embeddingModel: input.embeddingModel,
        vectorDimension: input.vectorDimension,
        organizationId,
      })

      return dataset
    } catch (error) {
      if (error instanceof DatasetError) throw error
      throw new DatasetError('Failed to update dataset', 'UPDATE_DATASET_ERROR', { error })
    }
  }

  /**
   * Delete a dataset
   */
  async delete(datasetId: string, organizationId: string): Promise<void> {
    try {
      await this.db
        .delete(schema.Dataset)
        .where(
          and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
        )
    } catch (error) {
      throw new DatasetError('Failed to delete dataset', 'DELETE_DATASET_ERROR', { error })
    }
  }

  /**
   * Get dataset statistics
   */
  async getStats(datasetId: string, organizationId: string): Promise<DatasetStats> {
    try {
      const dataset = await this.db.query.Dataset.findFirst({
        where: and(
          eq(schema.Dataset.id, datasetId),
          eq(schema.Dataset.organizationId, organizationId)
        ),
        columns: {
          id: true,
          name: true,
          documentCount: true,
          totalSize: true,
          lastIndexedAt: true,
          status: true,
        },
        extras: {
          searchQueriesCount:
            sql<number>`(SELECT COUNT(*) FROM "DatasetSearchQuery" WHERE "datasetId" = ${schema.Dataset.id})`.as(
              'searchQueriesCount'
            ),
        },
      })

      if (!dataset) {
        throw new DatasetError('Dataset not found', 'DATASET_NOT_FOUND')
      }

      // Get additional stats
      const [avgProcessingTimeResult, avgSearchTimeResult] = await Promise.all([
        this.db
          .select({ value: avg(schema.Document.processingTime) })
          .from(schema.Document)
          .where(
            and(
              eq(schema.Document.datasetId, datasetId),
              eq(schema.Document.organizationId, organizationId),
              isNotNull(schema.Document.processingTime)
            )
          ),
        this.db
          .select({ value: avg(schema.DatasetSearchQuery.responseTime) })
          .from(schema.DatasetSearchQuery)
          .where(
            and(
              eq(schema.DatasetSearchQuery.datasetId, datasetId),
              eq(schema.DatasetSearchQuery.organizationId, organizationId)
            )
          ),
      ])

      const avgProcessingTime =
        avgProcessingTimeResult[0]?.value != null
          ? Number(avgProcessingTimeResult[0]?.value)
          : undefined
      const avgSearchTime =
        avgSearchTimeResult[0]?.value != null ? Number(avgSearchTimeResult[0]?.value) : undefined

      return {
        id: dataset.id,
        name: dataset.name,
        documentCount: dataset.documentCount,
        totalSize: dataset.totalSize,
        lastIndexedAt: dataset.lastIndexedAt ? new Date(dataset.lastIndexedAt) : null,
        status: dataset.status,
        avgProcessingTime,
        totalSearches: Number((dataset as any).searchQueriesCount ?? 0),
        avgSearchTime,
      }
    } catch (error) {
      if (error instanceof DatasetError) throw error
      throw new DatasetError('Failed to get dataset stats', 'GET_DATASET_STATS_ERROR', { error })
    }
  }

  /**
   * Update dataset document count and size
   */
  async updateMetrics(datasetId: string, organizationId: string): Promise<void> {
    try {
      const [stats] = await this.db
        .select({
          count: count(),
          totalSize: sum(schema.Document.size),
        })
        .from(schema.Document)
        .where(
          and(
            eq(schema.Document.datasetId, datasetId),
            eq(schema.Document.organizationId, organizationId)
          )
        )

      await this.db
        .update(schema.Dataset)
        .set({
          documentCount: Number(stats?.count ?? 0),
          totalSize: Number(stats?.totalSize ?? 0),
          lastIndexedAt: new Date(),
        })
        .where(
          and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
        )
    } catch (error) {
      throw new DatasetError('Failed to update dataset metrics', 'UPDATE_METRICS_ERROR', { error })
    }
  }

  /**
   * Get available embedding options for organization
   * Returns the system default for TEXT_EMBEDDING model type
   */
  async getAvailableEmbeddingOptions(organizationId: string) {
    try {
      // Get system default for TEXT_EMBEDDING
      const systemModelService = new SystemModelService(this.db, organizationId)
      const systemDefault = await systemModelService.getDefault(ModelType.TEXT_EMBEDDING)

      return {
        systemDefault: systemDefault
          ? `${systemDefault.provider}:${systemDefault.model}`
          : null,
      }
    } catch (error) {
      logger.error('Failed to get available embedding options', {
        error: error instanceof Error ? error.message : error,
        organizationId,
      })
      throw new DatasetError(
        'Failed to get available embedding options',
        'GET_EMBEDDING_OPTIONS_ERROR',
        { error }
      )
    }
  }

  /**
   * Ensure dataset has valid embedding configuration (for existing datasets)
   */
  async ensureValidEmbeddingConfig(datasetId: string, organizationId: string): Promise<void> {
    try {
      await DatasetEmbeddingValidator.ensureValidEmbeddingConfig(datasetId, organizationId)
    } catch (error) {
      logger.error('Failed to ensure valid embedding configuration', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        organizationId,
      })
      throw new DatasetError(
        'Failed to ensure valid embedding configuration',
        'ENSURE_EMBEDDING_CONFIG_ERROR',
        { error }
      )
    }
  }

  /**
   * Create dataset from file uploads
   * Creates a dataset and processes uploaded files automatically
   */
  async createFromFileUploads(
    organizationId: string,
    userId: string,
    input: CreateDatasetInput,
    fileIds: string[],
    options?: {
      autoProcessDocuments?: boolean
      documentProcessingPriority?: number
      chunkingOptions?: {
        strategy?: string
        chunkSize?: number
        chunkOverlap?: number
        preserveFormatting?: boolean
      }
    }
  ): Promise<{
    dataset: DatasetWithRelations
    documents: any[]
    processingJobs: any[]
  }> {
    const { DocumentProcessingQueue } = await import('../workers/document-processing-queue')

    try {
      // Create the dataset first
      const dataset = await this.create(organizationId, userId, input)

      logger.info('Dataset created, now processing file uploads', {
        datasetId: dataset.id,
        datasetName: dataset.name,
        fileCount: fileIds.length,
        organizationId,
      })

      // Get file records
      const files = fileIds.length
        ? await this.db.query.File.findMany({
            where: and(
              eq(schema.File.organizationId, organizationId),
              inArray(schema.File.id, fileIds)
            ),
          })
        : []

      if (files.length !== fileIds.length) {
        throw new DatasetError(
          'Some files not found or do not belong to the organization',
          'FILES_NOT_FOUND',
          { requestedFiles: fileIds.length, foundFiles: files.length }
        )
      }

      // Create document records for each file
      const documents = []
      const processingJobs = []

      const documentService = new DocumentService(this.db)

      for (const file of files) {
        try {
          // Get chunk settings from dataset
          const datasetChunkSettings = dataset.chunkSettings as ChunkSettings

          // Create document record via DocumentService
          const document = await documentService.createFromFileUpload(
            {
              title: this.extractTitleFromFilename(file.name || 'Untitled'),
              filename: file.name || 'untitled',
              mimeType: file.mimeType ?? undefined,
              size: file.size,
              datasetId: dataset.id,
              uploadedById: userId,
              fileId: file.id,
              checksum: file.checksum ?? '',
              originalPath: undefined, // No original path for file uploads
              processingOptions: {
                chunkSettings: datasetChunkSettings,
                embeddingModel: dataset.embeddingModel ?? undefined, // Already in "provider:model" format
                skipParsing: false,
                skipEmbedding: false,
              },
            },
            organizationId
          )

          documents.push(document)

          // Queue document for processing if auto-processing is enabled
          if (options?.autoProcessDocuments !== false) {
            const job = await DocumentProcessingQueue.queueDocumentProcessing(
              document.id,
              dataset.id,
              organizationId,
              userId,
              {
                priority: options?.documentProcessingPriority || 1,
                fileId: file.id,
                fileName: file.name || 'untitled',
                filePath: file.storageKey,
                fileSize: file.size,
                mimeType: file.mimeType,
                documentType,
                chunkingOptions: options?.chunkingOptions
                  ? {
                      strategy:
                        (options.chunkingOptions.strategy as any) || datasetChunkSettings.strategy,
                      chunkSize: options.chunkingOptions.chunkSize || datasetChunkSettings.size,
                      chunkOverlap: options.chunkingOptions.chunkOverlap || datasetChunkSettings.overlap,
                      preserveFormatting: options.chunkingOptions.preserveFormatting || false,
                    }
                  : {
                      strategy: datasetChunkSettings.strategy,
                      chunkSize: datasetChunkSettings.size,
                      chunkOverlap: datasetChunkSettings.overlap,
                      preserveFormatting: false,
                    },
              }
            )

            processingJobs.push(job)
          }
        } catch (error) {
          logger.error('Failed to create document for file', {
            error: error instanceof Error ? error.message : error,
            fileId: file.id,
            fileName: file.name,
            datasetId: dataset.id,
          })

          // Continue processing other files, but log the error
          continue
        }
      }

      // Update dataset metrics
      await this.updateMetrics(dataset.id, organizationId)

      logger.info('Dataset created with file uploads successfully', {
        datasetId: dataset.id,
        datasetName: dataset.name,
        documentsCreated: documents.length,
        processingJobsQueued: processingJobs.length,
        organizationId,
      })

      return {
        dataset,
        documents,
        processingJobs,
      }
    } catch (error) {
      if (error instanceof DatasetError) throw error
      logger.error('Failed to create dataset from file uploads', {
        error: error instanceof Error ? error.message : error,
        input,
        fileIds,
        organizationId,
        userId,
      })
      throw new DatasetError(
        'Failed to create dataset from file uploads',
        'CREATE_DATASET_FROM_FILES_ERROR',
        { error }
      )
    }
  }

  /**
   * Build reusable where clause for dataset queries
   */
  private buildDatasetWhereClause(organizationId: string, filters?: DatasetFilters): SQL<unknown> {
    const conditions: SQL[] = [eq(schema.Dataset.organizationId, organizationId)]

    if (filters?.status) {
      conditions.push(eq(schema.Dataset.status, filters.status))
    }

    if (filters?.createdById) {
      conditions.push(eq(schema.Dataset.createdById, filters.createdById))
    }

    if (filters?.search) {
      const trimmedSearch = filters.search.trim()
      if (trimmedSearch) {
        const searchTerm = `%${trimmedSearch}%`
        conditions.push(
          or(ilike(schema.Dataset.name, searchTerm), ilike(schema.Dataset.description, searchTerm))
        )
      }
    }

    if (filters?.dateRange) {
      conditions.push(gte(schema.Dataset.createdAt, filters.dateRange.start))
      conditions.push(lte(schema.Dataset.createdAt, filters.dateRange.end))
    }

    return conditions.length === 1 ? conditions[0]! : and(...conditions)
  }

  /**
   * Resolve the dataset column used for sorting operations
   */
  private getDatasetSortColumn(sortBy: string) {
    switch (sortBy) {
      case 'name':
        return schema.Dataset.name
      case 'status':
        return schema.Dataset.status
      case 'updatedAt':
        return schema.Dataset.updatedAt
      case 'documentCount':
        return schema.Dataset.documentCount
      case 'totalSize':
        return schema.Dataset.totalSize
      default:
        return schema.Dataset.createdAt
    }
  }

  /**
   * Normalize dataset query rows into the DatasetWithRelations shape
   */
  private transformDatasetRow(row: any): DatasetWithRelations {
    const {
      documentsCount,
      searchQueriesCount,
      _count,
      User,
      Organization,
      documents = [],
      organization,
      createdBy,
      ...rest
    } = row ?? {}

    const dataset = {
      ...(rest as DatasetWithRelations),
      organization: (organization ?? Organization) as DatasetWithRelations['organization'],
      createdBy: (createdBy ?? User) as DatasetWithRelations['createdBy'],
      documents: documents as DatasetWithRelations['documents'],
    }

    return {
      ...dataset,
      _count: {
        documents: Number(documentsCount ?? _count?.documents ?? 0),
        searchQueries: Number(searchQueriesCount ?? _count?.searchQueries ?? 0),
      },
    }
  }

  /**
   * Load a dataset with eager relations and aggregated counts
   */
  private async fetchDatasetWithRelations(
    datasetId: string,
    organizationId: string,
    documentsLimit = 10
  ): Promise<DatasetWithRelations | null> {
    const dataset = await this.db.query.Dataset.findFirst({
      where: and(
        eq(schema.Dataset.id, datasetId),
        eq(schema.Dataset.organizationId, organizationId)
      ),
      with: {
        organization: {
          columns: { id: true, name: true },
        },
        createdBy: {
          columns: { id: true, name: true, email: true },
        },
        documents: {
          orderBy: (document, { desc }) => [desc(document.createdAt)],
          limit: documentsLimit,
        },
      },
      extras: {
        documentsCount:
          sql<number>`(SELECT COUNT(*) FROM "Document" WHERE "datasetId" = ${schema.Dataset.id})`.as(
            'documentsCount'
          ),
        searchQueriesCount:
          sql<number>`(SELECT COUNT(*) FROM "DatasetSearchQuery" WHERE "datasetId" = ${schema.Dataset.id})`.as(
            'searchQueriesCount'
          ),
      },
    })

    if (!dataset) {
      return null
    }

    return this.transformDatasetRow(dataset)
  }

  /**
   * Helper method to extract title from filename
   */
  private extractTitleFromFilename(filename: string): string {
    // Remove extension and clean up the filename
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')

    // Replace underscores and hyphens with spaces, capitalize words
    return nameWithoutExt
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim()
  }
}
