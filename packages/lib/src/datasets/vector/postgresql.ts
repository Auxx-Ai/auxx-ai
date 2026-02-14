// packages/lib/src/datasets/vector/postgresql.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, max, sql } from 'drizzle-orm'
import type {
  CollectionStats,
  VectorDbSearchOptions,
  VectorDocument,
  VectorSearchResult,
} from '../types/vector.types'
import { VectorDatabase } from '../types/vector.types'
import {
  type EmbeddingDimension,
  getEmbeddingColumnName,
  isSupportedDimension,
} from '../utils/embedding-columns'

const logger = createScopedLogger('postgresql-vector-db')

/**
 * PostgreSQL vector database implementation using pgvector extension
 *
 * Uses the existing DocumentSegment table to store vectors and provides
 * vector similarity search capabilities. Supports multiple embedding dimensions
 * via separate columns (512, 768, 1024, 1536, 3072).
 */
export class PostgreSQLVectorDB extends VectorDatabase {
  private dimension: EmbeddingDimension = 1536

  /**
   * Set the embedding dimension for this collection
   * @param dimension - Must be a supported dimension (512, 768, 1024, 1536, 3072)
   */
  setDimension(dimension: number): void {
    if (!isSupportedDimension(dimension)) {
      throw new Error(`Unsupported dimension: ${dimension}. Supported: 512, 768, 1024, 1536, 3072`)
    }
    this.dimension = dimension
    logger.debug('Dimension set for vector DB', {
      collectionName: this.collectionName,
      dimension,
    })
  }

  /**
   * Get the current embedding dimension
   */
  getDimension(): EmbeddingDimension {
    return this.dimension
  }

  async createCollection(dimension: number = 1536): Promise<void> {
    // For PostgreSQL, collections are managed through DocumentSegment table
    // Ensure vector extension is enabled and indexes exist

    try {
      // Enable pgvector extension if not already enabled
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)

      // Create vector indexes for efficient similarity search
      // Use HNSW index for better performance (if supported)
      try {
        await db.execute(sql`
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_segments_embedding_hnsw
          ON "DocumentSegment" USING hnsw (embedding vector_cosine_ops)
        `)
      } catch (error) {
        // Fall back to IVFFlat if HNSW is not available
        logger.warn('HNSW index creation failed, falling back to IVFFlat', { error })

        await db.execute(sql`
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_segments_embedding_ivfflat
          ON "DocumentSegment" USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 100)
        `)
      }

      // Create filtered index for active, indexed segments
      await db.execute(sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_segments_active_embedding
        ON "DocumentSegment" USING ivfflat (embedding vector_cosine_ops)
        WHERE enabled = true AND "indexStatus" = 'INDEXED' AND embedding IS NOT NULL
        WITH (lists = 100)
      `)

      // Create index for dataset-scoped queries
      await db.execute(sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_segments_dataset_embedding
        ON "DocumentSegment" ("datasetId")
        WHERE enabled = true AND "indexStatus" = 'INDEXED' AND embedding IS NOT NULL
      `)

      logger.info('PostgreSQL vector collection ready', {
        collectionName: this.collectionName,
        dimension,
      })
    } catch (error) {
      logger.error('Failed to create PostgreSQL vector collection', {
        error: error instanceof Error ? error.message : error,
        collectionName: this.collectionName,
      })
      throw error
    }
  }

  async deleteCollection(): Promise<void> {
    // Soft delete all segments in this collection (dataset)
    const datasetId = this.extractDatasetId(this.collectionName)

    try {
      // Use raw SQL to clear all embedding columns and update status
      const result = await db.execute(sql`
        UPDATE "DocumentSegment" ds
        SET
          enabled = false,
          embedding_512 = NULL,
          embedding_768 = NULL,
          embedding_1024 = NULL,
          embedding_1536 = NULL,
          embedding_3072 = NULL,
          "embeddingDimension" = NULL,
          "indexStatus" = 'PENDING',
          "updatedAt" = NOW()
        FROM "Document" d
        WHERE ds."documentId" = d.id
          AND d."datasetId" = ${datasetId}
          AND ds.enabled = true
      `)

      logger.info('PostgreSQL vector collection deleted', {
        collectionName: this.collectionName,
        segmentsAffected: result,
      })
    } catch (error) {
      logger.error('Failed to delete PostgreSQL vector collection', {
        error: error instanceof Error ? error.message : error,
        collectionName: this.collectionName,
      })
      throw error
    }
  }

  async collectionExists(): Promise<boolean> {
    // For PostgreSQL, collection exists if DocumentSegment table exists
    try {
      await db.execute(sql`SELECT 1 FROM "DocumentSegment" LIMIT 1`)
      return true
    } catch {
      return false
    }
  }

  async insertDocuments(documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return

    try {
      const datasetId = this.extractDatasetId(this.collectionName)
      const columnName = getEmbeddingColumnName(this.dimension)

      logger.debug('Inserting documents into PostgreSQL vector collection', {
        collectionName: this.collectionName,
        documentCount: documents.length,
        datasetId,
        dimension: this.dimension,
        columnName,
      })

      // Use transaction for batch insert
      await db.transaction(async (tx) => {
        for (const doc of documents) {
          // Validate embedding dimensions
          if (!doc.embedding || doc.embedding.length === 0) {
            throw new Error(`Document ${doc.id} has invalid embedding`)
          }

          if (doc.embedding.length !== this.dimension) {
            throw new Error(
              `Document ${doc.id} has ${doc.embedding.length} dimensions, ` +
                `expected ${this.dimension}`
            )
          }

          // Update existing DocumentSegment record with vector data
          // Use dynamic column selection based on dimension
          const embeddingArray = `[${doc.embedding.join(',')}]`
          await tx.execute(sql`
            UPDATE "DocumentSegment"
            SET
              ${sql.raw(`"${columnName}"`)} = ${embeddingArray}::vector,
              "embeddingDimension" = ${this.dimension},
              "searchMetadata" = ${JSON.stringify(doc.metadata || {})}::jsonb,
              "indexStatus" = 'INDEXED',
              "updatedAt" = NOW()
            WHERE id = ${doc.id}
          `)
        }
      })

      logger.info('Documents inserted into PostgreSQL vector collection', {
        collectionName: this.collectionName,
        documentCount: documents.length,
        dimension: this.dimension,
      })
    } catch (error) {
      logger.error('Failed to insert documents into PostgreSQL', {
        error: error instanceof Error ? error.message : error,
        collectionName: this.collectionName,
        documentCount: documents.length,
        dimension: this.dimension,
      })
      throw error
    }
  }

  async updateDocument(id: string, document: Partial<VectorDocument>): Promise<void> {
    try {
      if (document.embedding) {
        const columnName = getEmbeddingColumnName(this.dimension)

        if (document.embedding.length !== this.dimension) {
          throw new Error(
            `Embedding has ${document.embedding.length} dimensions, ` + `expected ${this.dimension}`
          )
        }

        const embeddingParam = `[${document.embedding.join(',')}]`

        // Build update query with embedding using dynamic column
        await db.execute(sql`
          UPDATE "DocumentSegment"
          SET
            ${document.content !== undefined ? sql`content = ${document.content},` : sql``}
            ${sql.raw(`"${columnName}"`)} = ${embeddingParam}::vector,
            "embeddingDimension" = ${this.dimension},
            ${document.metadata !== undefined ? sql`"searchMetadata" = ${JSON.stringify(document.metadata)}::jsonb,` : sql``}
            "indexStatus" = 'INDEXED',
            "updatedAt" = NOW()
          WHERE id = ${id}
        `)
      } else {
        // Update without embedding using Drizzle
        const updateData: any = { updatedAt: new Date() }
        if (document.content !== undefined) updateData.content = document.content
        if (document.metadata !== undefined) updateData.searchMetadata = document.metadata

        await db
          .update(schema.DocumentSegment)
          .set(updateData)
          .where(eq(schema.DocumentSegment.id, id))
      }

      logger.info('Document updated in PostgreSQL', {
        id,
        collectionName: this.collectionName,
        hasEmbedding: !!document.embedding,
        dimension: this.dimension,
      })
    } catch (error) {
      logger.error('Failed to update document in PostgreSQL', {
        error: error instanceof Error ? error.message : error,
        id,
        collectionName: this.collectionName,
        dimension: this.dimension,
      })
      throw error
    }
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    try {
      // Use raw SQL to clear all embedding columns and reset status
      const result = await db.execute(sql`
        UPDATE "DocumentSegment"
        SET
          enabled = false,
          embedding_512 = NULL,
          embedding_768 = NULL,
          embedding_1024 = NULL,
          embedding_1536 = NULL,
          embedding_3072 = NULL,
          "embeddingDimension" = NULL,
          "indexStatus" = 'PENDING',
          "updatedAt" = NOW()
        WHERE id = ANY(${ids}::text[])
      `)

      logger.info('Documents deleted from PostgreSQL', {
        ids: ids.length,
        collectionName: this.collectionName,
        documentsAffected: result,
      })
    } catch (error) {
      logger.error('Failed to delete documents from PostgreSQL', {
        error: error instanceof Error ? error.message : error,
        ids: ids.length,
        collectionName: this.collectionName,
      })
      throw error
    }
  }

  async searchByVector(
    queryVector: number[],
    options: VectorDbSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const { topK = 10, scoreThreshold = 0.0, filter = {}, includeMetadata = true } = options

    const datasetId = this.extractDatasetId(this.collectionName)
    const columnName = getEmbeddingColumnName(this.dimension)

    if (!queryVector || queryVector.length === 0) {
      throw new Error('Query vector is required and cannot be empty')
    }

    if (queryVector.length !== this.dimension) {
      throw new Error(
        `Query vector has ${queryVector.length} dimensions, expected ${this.dimension}`
      )
    }

    try {
      // Convert embedding array to pgvector format
      const vectorParam = `[${queryVector.join(',')}]`

      logger.debug('Executing vector search', {
        datasetId,
        vectorDimensions: queryVector.length,
        dimension: this.dimension,
        columnName,
        topK,
        scoreThreshold,
      })

      // Build filter conditions
      const filterConditions = this.buildFilterConditionsSql(filter)

      // Build the complete query using dynamic column based on dimension
      const query = sql`
        SELECT
          ds.id,
          ds.content,
          ${includeMetadata ? sql`ds."searchMetadata"` : sql`'{}'::jsonb`} AS metadata,
          1 - (${sql.raw(`ds."${columnName}"`)} <=> ${vectorParam}::vector) AS score,
          d.title AS document_title,
          d.id AS document_id
        FROM "DocumentSegment" ds
        JOIN "Document" d ON ds."documentId" = d.id
        WHERE
          d."datasetId" = ${datasetId}
          AND ds.enabled = true
          AND ds."indexStatus" = 'INDEXED'
          AND ${sql.raw(`ds."${columnName}"`)} IS NOT NULL
          AND (1 - (${sql.raw(`ds."${columnName}"`)} <=> ${vectorParam}::vector)) >= ${scoreThreshold}
          ${filterConditions}
        ORDER BY ${sql.raw(`ds."${columnName}"`)} <=> ${vectorParam}::vector ASC
        LIMIT ${topK}
      `

      const results = await db.execute(query)
      const rows = results.rows as Array<{
        id: string
        content: string
        metadata: Record<string, unknown> | null
        score: string
        document_id: string
        document_title: string
      }>

      const searchResults = rows.map((row) => ({
        id: row.id,
        content: row.content,
        metadata: {
          ...(row.metadata || {}),
          documentId: row.document_id,
          documentTitle: row.document_title,
        },
        score: parseFloat(row.score),
      }))

      logger.info('Vector search completed', {
        datasetId,
        resultCount: searchResults.length,
        dimension: this.dimension,
        topK,
        scoreThreshold,
      })

      return searchResults
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Vector search failed in PostgreSQL', {
        error: errorMessage,
        collectionName: this.collectionName,
        datasetId,
        dimension: this.dimension,
        topK,
      })
      throw new Error(`Vector search failed: ${errorMessage}`)
    }
  }

  async searchByText(
    query: string,
    options: VectorDbSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const { topK = 10, includeMetadata = true, filter = {} } = options
    const datasetId = this.extractDatasetId(this.collectionName)

    if (!query || query.trim().length === 0) {
      throw new Error('Search query is required and cannot be empty')
    }

    try {
      logger.debug('Executing text search', {
        datasetId,
        query: query.substring(0, 100),
        topK,
      })

      // Build filter conditions
      const filterConditions = this.buildFilterConditionsSql(filter)

      // Build the complete query using sql
      const searchQuery = sql`
        SELECT
          ds.id,
          ds.content,
          ${includeMetadata ? sql`ds."searchMetadata"` : sql`'{}'::jsonb`} as metadata,
          ts_rank(to_tsvector('english', ds.content), plainto_tsquery('english', ${query})) as score,
          d.title as document_title,
          d.id as document_id
        FROM "DocumentSegment" ds
        JOIN "Document" d ON ds."documentId" = d.id
        WHERE
          d."datasetId" = ${datasetId}
          AND ds.enabled = true
          AND to_tsvector('english', ds.content) @@ plainto_tsquery('english', ${query})
          ${filterConditions}
        ORDER BY ts_rank(to_tsvector('english', ds.content), plainto_tsquery('english', ${query})) DESC
        LIMIT ${topK}
      `

      const results = await db.execute(searchQuery)
      const rows = results.rows as Array<{
        id: string
        content: string
        metadata: Record<string, unknown> | null
        score: string
        document_id: string
        document_title: string
      }>

      const searchResults = rows.map((row) => ({
        id: row.id,
        content: row.content,
        metadata: {
          ...(row.metadata || {}),
          documentId: row.document_id,
          documentTitle: row.document_title,
        },
        score: parseFloat(row.score),
      }))

      logger.info('Text search completed', {
        datasetId,
        query: query.substring(0, 50),
        resultCount: searchResults.length,
      })

      return searchResults
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Text search failed in PostgreSQL', {
        error: errorMessage,
        collectionName: this.collectionName,
        datasetId,
        query: query.substring(0, 50),
      })
      throw new Error(`Text search failed: ${errorMessage}`)
    }
  }

  async getCollectionStats(): Promise<CollectionStats> {
    const datasetId = this.extractDatasetId(this.collectionName)
    const columnName = getEmbeddingColumnName(this.dimension)

    try {
      const [documentStats, vectorStats] = await Promise.all([
        // Total segments in dataset
        db
          .select({
            count: count(schema.DocumentSegment.id),
            maxUpdatedAt: max(schema.DocumentSegment.updatedAt),
          })
          .from(schema.DocumentSegment)
          .innerJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
          .where(
            and(eq(schema.Document.datasetId, datasetId), eq(schema.DocumentSegment.enabled, true))
          ),
        // Count indexed vectors using dynamic column name
        db.execute(sql`
          SELECT COUNT(*) as count
          FROM "DocumentSegment" ds
          JOIN "Document" d ON ds."documentId" = d.id
          WHERE d."datasetId" = ${datasetId}
            AND ds.enabled = true
            AND ds."indexStatus" = 'INDEXED'
            AND ${sql.raw(`ds."${columnName}"`)} IS NOT NULL
        `),
      ])

      const [docStats] = documentStats
      const vecStatsRows = vectorStats.rows as Array<{ count: string | number }>
      const [vecStats] = vecStatsRows

      return {
        documentCount: docStats?.count || 0,
        vectorCount: Number(vecStats?.count) || 0,
        indexType: 'hnsw',
        lastUpdated: docStats?.maxUpdatedAt || undefined,
      }
    } catch (error) {
      logger.error('Failed to get collection stats', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        dimension: this.dimension,
        collectionName: this.collectionName,
      })
      throw error
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Test basic database connectivity
      await db.execute(sql`SELECT 1`)

      // Test vector extension availability
      await db.execute(sql`SELECT vector_dims('[1,2,3]'::vector)`)

      return true
    } catch (error) {
      logger.warn('PostgreSQL health check failed', {
        error: error instanceof Error ? error.message : error,
        collectionName: this.collectionName,
      })
      return false
    }
  }

  /**
   * Search across multiple datasets with a specific dimension
   * Returns complete segment/document data to avoid second query
   */
  static async searchByVectorMultiDataset(
    queryVector: number[],
    datasetIds: string[],
    dimension: number,
    options: VectorDbSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const { topK = 20, scoreThreshold = 0.0, includeMetadata = true } = options
    const columnName = getEmbeddingColumnName(dimension)
    const vectorParam = `[${queryVector.join(',')}]`

    if (!queryVector || queryVector.length === 0) {
      throw new Error('Query vector is required and cannot be empty')
    }

    if (queryVector.length !== dimension) {
      throw new Error(`Query vector has ${queryVector.length} dimensions, expected ${dimension}`)
    }

    try {
      logger.debug('Executing multi-dataset vector search', {
        datasetIds: datasetIds.length,
        dimension,
        columnName,
        topK,
        scoreThreshold,
      })

      // Format datasetIds as PostgreSQL array literal
      const datasetIdsArray = `{${datasetIds.join(',')}}`

      const query = sql`
        SELECT
          ds.id,
          ds.content,
          ds.position,
          ds."tokenCount",
          ds."documentId",
          ds."organizationId",
          ${includeMetadata ? sql`ds."searchMetadata"` : sql`'{}'::jsonb`} AS metadata,
          1 - (${sql.raw(`ds."${columnName}"`)} <=> ${vectorParam}::vector) AS score,
          d.id as "docId",
          d.title as "documentTitle",
          d.filename as "documentFilename",
          d."mimeType" as "documentMimeType",
          d.type as "documentType",
          d.size as "documentSize",
          d.status as "documentStatus",
          d.enabled as "documentEnabled",
          d."createdAt" as "documentCreatedAt",
          dt.id as "datasetId",
          dt.name as "datasetName"
        FROM "DocumentSegment" ds
        JOIN "Document" d ON ds."documentId" = d.id
        JOIN "Dataset" dt ON d."datasetId" = dt.id
        WHERE d."datasetId" = ANY(${datasetIdsArray}::text[])
          AND ds.enabled = true
          AND ds."indexStatus" = 'INDEXED'
          AND ${sql.raw(`ds."${columnName}"`)} IS NOT NULL
          AND (1 - (${sql.raw(`ds."${columnName}"`)} <=> ${vectorParam}::vector)) >= ${scoreThreshold}
        ORDER BY ${sql.raw(`ds."${columnName}"`)} <=> ${vectorParam}::vector ASC
        LIMIT ${topK}
      `

      const results = await db.execute(query)
      const rows = results.rows as Array<{
        id: string
        content: string
        position: number
        tokenCount: number
        documentId: string
        organizationId: string
        metadata: Record<string, unknown> | null
        score: string
        docId: string
        documentTitle: string
        documentFilename: string
        documentMimeType: string
        documentType: string
        documentSize: string | number
        documentStatus: string
        documentEnabled: boolean
        documentCreatedAt: string | Date
        datasetId: string
        datasetName: string
      }>

      const searchResults = rows.map((row) => ({
        id: row.id,
        content: row.content,
        metadata: {
          ...(row.metadata || {}),
          documentId: row.docId,
          documentTitle: row.documentTitle,
          position: row.position,
          tokenCount: row.tokenCount,
          documentFilename: row.documentFilename,
          documentMimeType: row.documentMimeType,
          documentType: row.documentType,
          documentSize: row.documentSize,
          documentStatus: row.documentStatus,
          documentEnabled: row.documentEnabled,
          documentCreatedAt: row.documentCreatedAt,
          datasetId: row.datasetId,
          datasetName: row.datasetName,
          organizationId: row.organizationId,
        },
        score: parseFloat(row.score),
      }))

      logger.info('Multi-dataset vector search completed', {
        datasetIds: datasetIds.length,
        resultCount: searchResults.length,
        dimension,
        topK,
        scoreThreshold,
      })

      return searchResults
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Multi-dataset vector search failed', {
        error: errorMessage,
        datasetIds: datasetIds.length,
        dimension,
        topK,
      })
      throw new Error('Vector search failed')
    }
  }

  // Private helper methods

  private extractDatasetId(collectionName: string): string {
    // Convert 'dataset_abc_123_def' back to 'abc-123-def'
    return collectionName.replace('dataset_', '').replace(/_/g, '-')
  }

  /**
   * Build filter conditions using sql for proper SQL composition
   */
  private buildFilterConditionsSql(filter: Record<string, any>) {
    const conditions: ReturnType<typeof sql>[] = []

    if (!filter) return sql``

    for (const [key, value] of Object.entries(filter)) {
      if (value === null || value === undefined) continue

      switch (key) {
        case 'documentId':
          conditions.push(sql`AND d.id = ${value}`)
          break

        case 'documentTitle':
          conditions.push(sql`AND d.title ILIKE ${`%${value}%`}`)
          break

        case 'createdAfter':
          conditions.push(sql`AND ds."createdAt" > ${value}::timestamp`)
          break

        case 'createdBefore':
          conditions.push(sql`AND ds."createdAt" < ${value}::timestamp`)
          break

        default:
          if (key.startsWith('metadata.')) {
            const metadataKey = key.substring(9)
            conditions.push(sql`AND ds."searchMetadata"->>${metadataKey} = ${String(value)}`)
          }
          break
      }
    }

    return conditions.length > 0 ? sql.join(conditions, sql` `) : sql``
  }
}
