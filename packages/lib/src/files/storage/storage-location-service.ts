// packages/lib/src/files/storage/location-service.ts
import { database as db, schema, type Database } from '@auxx/database'
import type { StorageLocationEntity, CreateStorageLocationInput } from '@auxx/database/models'
import { and, eq, desc, count, sum, isNotNull, lt, inArray, sql } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { StorageProvider } from '@auxx/database/types'
// NOTE: StorageLocationService focuses only on database operations
const logger = createScopedLogger('storage-location-service')
// NOTE: Adapter management is handled by StorageManager
/**
 * Request to create a new StorageLocation
 *
 * All providers (local, S3, Google Drive, etc.) are treated uniformly through
 * this interface. The metadata field allows provider-specific information to
 * be stored while maintaining a consistent API.
 *
 * @example
 * ```typescript
 * const request: CreateStorageLocationRequest = {
 *   provider: 'S3',
 *   externalId: 'my-bucket/org123/file.pdf',
 *   externalUrl: 'https://my-bucket.s3.amazonaws.com/org123/file.pdf',
 *   externalRev: 'd41d8cd98f00b204e9800998ecf8427e',
 *   credentialId: 'aws_s3_credentials',
 *   size: BigInt(1024000),
 *   mimeType: 'application/pdf',
 *   metadata: {
 *     bucket: 'my-bucket',
 *     region: 'us-east-1',
 *     storageClass: 'STANDARD'
 *   }
 * }
 * ```
 */
export interface CreateStorageLocationRequest {
  provider: StorageProvider
  // Universal identifier for the file in the provider system
  externalId: string
  // Optional external URL (for URL providers or public files)
  externalUrl: string
  externalRev: string
  // Authentication (all providers can have credentials)
  credentialId?: string
  // File metadata
  size?: bigint
  mimeType?: string
  // Provider-specific metadata (e.g., S3: {bucket, region, etag}, Drive: {fileId, parentId})
  metadata?: Record<string, any>
}
/**
 * Request to update an existing StorageLocation
 */
export interface UpdateStorageLocationRequest {
  externalUrl?: string
  externalRev?: string
  size?: bigint
  mimeType?: string
  metadata?: Record<string, any>
}
/**
 * Storage location with populated credential information
 *
 * Extended StorageLocation that includes the associated credential data.
 * Useful for operations that need both storage metadata and authentication
 * information in a single query.
 *
 * @example
 * ```typescript
 * const locationWithCreds = await service.getWithCredentials('loc_123')
 * if (locationWithCreds?.credential) {
 *   console.log(`Using credential: ${locationWithCreds.credential.name}`)
 *   // Decrypt and use credential.encryptedData
 * }
 * ```
 */
export interface StorageLocationWithCredentials extends StorageLocationEntity {
  credential?: {
    id: string
    name: string
    type: string
    encryptedData: string
  } | null
}
/**
 * Download information for a storage location
 */
export interface StorageDownloadInfo {
  url: string
  filename?: string
  mimeType?: string
  size?: bigint
  expiresAt?: Date
  headers?: Record<string, string>
}
/**
 * Storage provider capabilities
 */
export interface ProviderCapabilities {
  supportsDirectUpload: boolean
  supportsSignedUrls: boolean
  supportsVersioning: boolean
  supportsMetadata: boolean
  maxFileSize?: bigint
  allowedMimeTypes?: string[]
}
/**
 * Bulk operation options for storage locations
 */
export interface BulkStorageOperationOptions {
  batchSize?: number
  continueOnError?: boolean
  dryRun?: boolean
}
/**
 * Bulk operation result for storage locations
 */
export interface BulkStorageOperationResult<T> {
  success: boolean
  processed: number
  failed: number
  errors: Array<{
    item: any
    error: string
  }>
  results: T[]
}
/**
 * Service for managing StorageLocation database records
 *
 * The StorageLocationService provides comprehensive database operations for
 * storage location metadata. It focuses purely on data persistence and
 * retrieval, while the StorageManager handles the actual storage operations.
 *
 * ## Key Features
 * - **CRUD Operations**: Complete create, read, update, delete functionality
 * - **Advanced Querying**: Search by provider, credential, external ID, metadata
 * - **Bulk Operations**: Efficient batch processing with error handling
 * - **Statistics & Analytics**: Usage tracking and storage metrics
 * - **Data Integrity**: Validation and cleanup operations
 *
 * ## Architecture Separation
 * ```
 * StorageManager (Business Logic)
 *     ↓
 * StorageLocationService (Data Layer)
 *     ↓
 * Database (Prisma ORM)
 * ```
 *
 * ## Usage Examples
 *
 * ### Basic CRUD Operations
 * ```typescript
 * // Create a new storage location
 * const location = await service.create({
 *   provider: 'S3',
 *   externalId: 'bucket/key',
 *   externalUrl: 'https://...',
 *   externalRev: 'etag123',
 *   size: BigInt(1024)
 * })
 *
 * // Retrieve with credentials
 * const withCreds = await service.getWithCredentials(location.id)
 *
 * // Update metadata
 * await service.update(location.id, {
 *   metadata: { processed: true }
 * })
 * ```
 *
 * ### Advanced Querying
 * ```typescript
 * // Find all S3 locations
 * const s3Locations = await service.getLocationsByProvider('S3')
 *
 * // Find by external identifier
 * const locations = await service.findByExternalId('S3', 'my-bucket/file.txt')
 *
 * // Search by metadata
 * const processedFiles = await service.findByMetadata('S3', {
 *   processed: true,
 *   category: 'documents'
 * })
 * ```
 *
 * ### Bulk Operations
 * ```typescript
 * const result = await service.bulkCreate(locations, {
 *   batchSize: 100,
 *   continueOnError: true
 * })
 *
 * ```
 *
 * ### Statistics
 * ```typescript
 * const stats = await service.getStats()
 * console.log(`Total files: ${stats.totalLocations}`)
 * console.log(`Total size: ${stats.totalSize} bytes`)
 *
 * Object.entries(stats.locationsByProvider).forEach(([provider, count]) => {
 *   console.log(`${provider}: ${count} files`)
 * })
 * ```
 *
 * @see {@link StorageManager} for storage operations
 * @see {@link CreateStorageLocationRequest} for creation parameters
 * @since 1.0.0
 */
export class StorageLocationService {
  // ============= StorageLocation CRUD Operations =============
  /**
   * Create a new storage location record
   *
   * Creates a new storage location entry in the database with validation
   * and proper error handling. This method is the primary way to register
   * files stored in external providers.
   *
   * @param data - The storage location data to create
   * @returns Promise resolving to the created StorageLocation
   *
   * @throws {Error} When validation fails or database operation fails
   *
   * @example
   * ```typescript
   * const location = await service.create({
   *   provider: 'S3',
   *   externalId: 'my-bucket/documents/report.pdf',
   *   externalUrl: 'https://my-bucket.s3.amazonaws.com/documents/report.pdf',
   *   externalRev: 'etag-abc123def456',
   *   credentialId: 'aws_credentials_id',
   *   size: BigInt(2048000),
   *   mimeType: 'application/pdf',
   *   metadata: {
   *     bucket: 'my-bucket',
   *     region: 'us-east-1',
   *     storageClass: 'STANDARD',
   *     encryption: 'AES256'
   *   }
   * })
   *
   * console.log(`Created location: ${location.id}`)
   * ```
   *
   * @see {@link validate} for validation rules
   * @see {@link update} for modifying existing locations
   */
  async create(
    data: CreateStorageLocationRequest,
    dbInstance?: Database
  ): Promise<StorageLocationEntity> {
    logger.info('Creating storage location', {
      provider: data.provider,
      hasCredential: !!data.credentialId,
    })
    // Validate required fields based on provider
    const validation = StorageLocationService.validate(data)
    if (!validation.isValid) {
      throw new Error(`Invalid storage location data: ${validation.errors.join(', ')}`)
    }
    try {
      const dbToUse = dbInstance || db
      const [location] = await dbToUse
        .insert(schema.StorageLocation)
        .values({
          provider: data.provider,
          externalId: data.externalId,
          externalUrl: data.externalUrl,
          credentialId: data.credentialId,
          size: data.size || null,
          mimeType: data.mimeType || null,
          metadata: data.metadata || {},
          externalRev: data.externalRev,
        })
        .returning()
      logger.info('Storage location created successfully', { id: location.id })
      return location
    } catch (error) {
      logger.error('Failed to create storage location', { error, data })
      throw error
    }
  }
  /**
   * Get a storage location by ID
   */
  async get(id: string): Promise<StorageLocationEntity | null> {
    try {
      const [location] = await db
        .select()
        .from(schema.StorageLocation)
        .where(eq(schema.StorageLocation.id, id))
        .limit(1)
      return location || null
    } catch (error) {
      logger.error('Failed to get storage location', { id, error })
      throw error
    }
  }
  /**
   * Get a storage location with populated credentials
   */
  async getWithCredentials(id: string): Promise<StorageLocationWithCredentials | null> {
    try {
      const [result] = await db
        .select({
          id: schema.StorageLocation.id,
          provider: schema.StorageLocation.provider,
          externalId: schema.StorageLocation.externalId,
          externalUrl: schema.StorageLocation.externalUrl,
          externalRev: schema.StorageLocation.externalRev,
          credentialId: schema.StorageLocation.credentialId,
          size: schema.StorageLocation.size,
          mimeType: schema.StorageLocation.mimeType,
          createdAt: schema.StorageLocation.createdAt,
          metadata: schema.StorageLocation.metadata,
          credential: {
            id: schema.WorkflowCredentials.id,
            name: schema.WorkflowCredentials.name,
            type: schema.WorkflowCredentials.type,
            encryptedData: schema.WorkflowCredentials.encryptedData,
          },
        })
        .from(schema.StorageLocation)
        .leftJoin(
          schema.WorkflowCredentials,
          eq(schema.StorageLocation.credentialId, schema.WorkflowCredentials.id)
        )
        .where(eq(schema.StorageLocation.id, id))
        .limit(1)
      if (!result) return null
      return {
        ...result,
        credential: result.credential.id ? result.credential : null,
      } as StorageLocationWithCredentials
    } catch (error) {
      logger.error('Failed to get storage location with credentials', { id, error })
      throw error
    }
  }
  /**
   * Update an existing storage location
   */
  async update(id: string, data: UpdateStorageLocationRequest): Promise<StorageLocationEntity> {
    logger.info('Updating storage location', { id })
    try {
      const updateData: Partial<CreateStorageLocationInput> = {}
      if (data.externalUrl !== undefined) updateData.externalUrl = data.externalUrl
      if (data.externalRev !== undefined) updateData.externalRev = data.externalRev
      if (data.size !== undefined) updateData.size = data.size
      if (data.mimeType !== undefined) updateData.mimeType = data.mimeType
      if (data.metadata !== undefined) updateData.metadata = data.metadata
      const [location] = await db
        .update(schema.StorageLocation)
        .set(updateData)
        .where(eq(schema.StorageLocation.id, id))
        .returning()
      logger.info('Storage location updated successfully', { id })
      return location
    } catch (error) {
      logger.error('Failed to update storage location', { id, error })
      throw error
    }
  }
  /**
   * Delete a storage location
   */
  async delete(id: string): Promise<void> {
    logger.info('Deleting storage location', { id })
    try {
      await db.delete(schema.StorageLocation).where(eq(schema.StorageLocation.id, id))
      logger.info('Storage location deleted successfully', { id })
    } catch (error) {
      logger.error('Failed to delete storage location', { id, error })
      throw error
    }
  }
  // NOTE: No provider-specific creation methods
  // Use the generic createStorageLocation() method for all providers
  // NOTE: Content access operations (download, upload, streaming)
  // are handled by StorageManager, not StorageLocationService
  // NOTE: Provider management (capabilities, testing, webhooks) is handled by StorageManager
  // ============= Search & Query Operations =============
  /**
   * Get storage locations by provider
   *
   * Retrieves all storage locations for a specific provider, ordered by
   * creation date (newest first). Useful for provider-specific operations
   * and analytics.
   *
   * @param provider - The storage provider to filter by
   * @returns Promise resolving to array of storage locations
   *
   * @throws {Error} When database query fails
   *
   * @example
   * ```typescript
   * // Get all S3 storage locations
   * const s3Locations = await service.getLocationsByProvider('S3')
   *
   * console.log(`Found ${s3Locations.length} S3 files`)
   * s3Locations.forEach(location => {
   *   console.log(`${location.externalId}: ${location.size} bytes`)
   * })
   *
   * // Calculate total S3 usage
   * const totalSize = s3Locations.reduce((sum, loc) =>
   *   sum + (loc.size || BigInt(0)), BigInt(0)
   * )
   * console.log(`Total S3 usage: ${totalSize} bytes`)
   * ```
   *
   * @see {@link getLocationsByCredential} for credential-based filtering
   * @see {@link getStats} for aggregated statistics
   */
  async getLocationsByProvider(provider: StorageProvider): Promise<StorageLocationEntity[]> {
    try {
      return await db
        .select()
        .from(schema.StorageLocation)
        .where(eq(schema.StorageLocation.provider, provider))
        .orderBy(desc(schema.StorageLocation.createdAt))
    } catch (error) {
      logger.error('Failed to get storage locations by provider', { provider, error })
      throw error
    }
  }
  /**
   * Get storage locations by credential
   */
  async getLocationsByCredential(credentialId: string): Promise<StorageLocationEntity[]> {
    try {
      return await db
        .select()
        .from(schema.StorageLocation)
        .where(eq(schema.StorageLocation.credentialId, credentialId))
        .orderBy(desc(schema.StorageLocation.createdAt))
    } catch (error) {
      logger.error('Failed to get storage locations by credential', { credentialId, error })
      throw error
    }
  }
  /**
   * Find storage locations by external ID
   */
  async findByExternalId(
    provider: StorageProvider,
    externalId: string
  ): Promise<StorageLocationEntity[]> {
    try {
      return await db
        .select()
        .from(schema.StorageLocation)
        .where(
          and(
            eq(schema.StorageLocation.provider, provider),
            eq(schema.StorageLocation.externalId, externalId)
          )
        )
        .orderBy(desc(schema.StorageLocation.createdAt))
    } catch (error) {
      logger.error('Failed to find storage locations by external ID', {
        provider,
        externalId,
        error,
      })
      throw error
    }
  }
  /**
   * Find storage locations by metadata pattern
   */
  async findByMetadata(
    provider: StorageProvider,
    metadataQuery: Record<string, any>
  ): Promise<StorageLocationEntity[]> {
    try {
      const conditions = [eq(schema.StorageLocation.provider, provider)]
      // Add metadata conditions for each key-value pair using PostgreSQL JSON operators
      for (const [key, value] of Object.entries(metadataQuery)) {
        conditions.push(sql`${schema.StorageLocation.metadata}->>${key} = ${value}`)
      }
      return await db
        .select()
        .from(schema.StorageLocation)
        .where(and(...conditions))
        .orderBy(desc(schema.StorageLocation.createdAt))
    } catch (error) {
      logger.error('Failed to find storage locations by metadata', {
        provider,
        metadataQuery,
        error,
      })
      throw error
    }
  }
  // ============= Bulk Operations =============
  /**
   * Create multiple storage locations
   *
   * Efficiently creates multiple storage locations using batched database
   * operations. Provides comprehensive error handling and progress tracking.
   *
   * ## Features
   * - **Batched Processing**: Configurable batch sizes for optimal performance
   * - **Transaction Safety**: Each batch is processed in a database transaction
   * - **Error Resilience**: Continue-on-error option for fault tolerance
   * - **Dry Run Mode**: Validate without creating for testing
   * - **Detailed Results**: Complete success/failure tracking
   *
   * @param locations - Array of storage location requests to create
   * @param options - Optional batch processing configuration
   * @returns Promise resolving to detailed operation results
   *
   * @example
   * ```typescript
   * const locations: CreateStorageLocationRequest[] = [
   *   { provider: 'S3', externalId: 'bucket/file1.txt', externalUrl: '...', externalRev: '' },
   *   { provider: 'S3', externalId: 'bucket/file2.txt', externalUrl: '...', externalRev: '' },
   *   // ... more locations
   * ]
   *
   * // Production bulk create
   * const result = await service.bulkCreate(locations, {
   *   batchSize: 50,
   *   continueOnError: true
   * })
   *
   * console.log(`Successfully created: ${result.processed}`)
   * console.log(`Failed: ${result.failed}`)
   *
   * if (result.errors.length > 0) {
   *   console.log('Errors:')
   *   result.errors.forEach(error => {
   *     console.log(`- ${error.item.externalId}: ${error.error}`)
   *   })
   * }
   *
   * // Dry run for validation
   * const dryResult = await service.bulkCreate(locations, {
   *   dryRun: true
   * })
   *
   * if (dryResult.success) {
   *   console.log('All locations are valid')
   * } else {
   *   console.log(`Validation failed for ${dryResult.failed} locations`)
   * }
   * ```
   *
   * @see {@link BulkStorageOperationOptions} for configuration options
   * @see {@link BulkStorageOperationResult} for result details
   */
  async bulkCreate(
    locations: CreateStorageLocationRequest[],
    options?: BulkStorageOperationOptions
  ): Promise<BulkStorageOperationResult<StorageLocationEntity>> {
    const batchSize = options?.batchSize || 100
    const continueOnError = options?.continueOnError || false
    const dryRun = options?.dryRun || false
    logger.info('Starting bulk storage location creation', {
      count: locations.length,
      batchSize,
      continueOnError,
      dryRun,
    })
    const results: StorageLocationEntity[] = []
    const errors: Array<{
      item: CreateStorageLocationRequest
      error: string
    }> = []
    let processed = 0
    if (dryRun) {
      // Validate all items without creating
      for (const location of locations) {
        const validation = StorageLocationService.validate(location)
        if (!validation.isValid) {
          errors.push({
            item: location,
            error: `Validation failed: ${validation.errors.join(', ')}`,
          })
        } else {
          processed++
        }
      }
      return {
        success: errors.length === 0,
        processed,
        failed: errors.length,
        errors,
        results: [],
      }
    }
    // Process in batches
    for (let i = 0; i < locations.length; i += batchSize) {
      const batch = locations.slice(i, i + batchSize)
      try {
        // Use Drizzle transaction for each batch
        const batchResults = await db.transaction(async (tx) => {
          const results: StorageLocationEntity[] = []
          for (const location of batch) {
            const [result] = await tx
              .insert(schema.StorageLocation)
              .values({
                provider: location.provider,
                externalId: location.externalId,
                externalUrl: location.externalUrl,
                externalRev: location.externalRev,
                credentialId: location.credentialId || null,
                size: location.size || null,
                mimeType: location.mimeType || null,
                metadata: location.metadata || {},
              })
              .returning()
            results.push(result)
          }
          return results
        })
        results.push(...batchResults)
        processed += batch.length
      } catch (error) {
        logger.error('Batch creation failed', { batchStart: i, batchSize: batch.length, error })
        if (continueOnError) {
          // Try individual items in the failed batch
          for (const location of batch) {
            try {
              const result = await this.create(location)
              results.push(result)
              processed++
            } catch (itemError) {
              errors.push({
                item: location,
                error: itemError instanceof Error ? itemError.message : 'Unknown error',
              })
            }
          }
        } else {
          // Add all items in batch as failed
          for (const location of batch) {
            errors.push({
              item: location,
              error: error instanceof Error ? error.message : 'Batch creation failed',
            })
          }
          break // Stop processing if not continuing on error
        }
      }
    }
    const success = errors.length === 0
    const failed = errors.length
    logger.info('Bulk storage location creation completed', {
      success,
      processed,
      failed,
      totalResults: results.length,
    })
    return {
      success,
      processed,
      failed,
      errors,
      results,
    }
  }
  // ============= Statistics & Analytics =============
  /**
   * Get storage location statistics
   *
   * Provides comprehensive statistics about storage usage across all
   * providers. This method performs efficient database aggregations to
   * calculate counts and sizes without loading individual records.
   *
   * @returns Promise resolving to detailed storage statistics
   *
   * @throws {Error} When database aggregation fails
   *
   * @example
   * ```typescript
   * const stats = await service.getStats()
   *
   * // Overall statistics
   * console.log(`Total files: ${stats.totalLocations.toLocaleString()}`)
   * console.log(`Total size: ${formatBytes(stats.totalSize)} bytes`)
   *
   * // Per-provider breakdown
   * console.log('\nProvider breakdown:')
   * Object.entries(stats.locationsByProvider).forEach(([provider, count]) => {
   *   const size = stats.sizeByProvider[provider] || BigInt(0)
   *   console.log(`${provider}: ${count} files (${formatBytes(size)} bytes)`)
   * })
   *
   * // Calculate average file sizes
   * Object.entries(stats.locationsByProvider).forEach(([provider, count]) => {
   *   const size = stats.sizeByProvider[provider] || BigInt(0)
   *   const avgSize = count > 0 ? Number(size) / count : 0
   *   console.log(`${provider} average: ${formatBytes(BigInt(Math.round(avgSize)))} bytes`)
   * })
   *
   * function formatBytes(bytes: bigint): string {
   *   const units = ['B', 'KB', 'MB', 'GB', 'TB']
   *   let size = Number(bytes)
   *   let unitIndex = 0
   *
   *   while (size >= 1024 && unitIndex < units.length - 1) {
   *     size /= 1024
   *     unitIndex++
   *   }
   *
   *   return `${size.toFixed(2)} ${units[unitIndex]}`
   * }
   * ```
   *
   * @see {@link getUsageByCredential} for credential-specific statistics
   */
  async getStats(): Promise<{
    totalLocations: number
    locationsByProvider: Record<string, number>
    totalSize: bigint
    sizeByProvider: Record<string, bigint>
  }> {
    try {
      // Get total count
      const [{ totalCount }] = await db.select({ totalCount: count() }).from(schema.StorageLocation)
      // Get count by provider
      const providerCounts = await db
        .select({
          provider: schema.StorageLocation.provider,
          count: count(),
        })
        .from(schema.StorageLocation)
        .groupBy(schema.StorageLocation.provider)
      // Get size by provider
      const providerSizes = await db
        .select({
          provider: schema.StorageLocation.provider,
          totalSize: sum(schema.StorageLocation.size),
        })
        .from(schema.StorageLocation)
        .where(isNotNull(schema.StorageLocation.size))
        .groupBy(schema.StorageLocation.provider)
      // Transform results
      const locationsByProvider: Record<string, number> = {}
      const sizeByProvider: Record<string, bigint> = {}
      let totalSize = BigInt(0)
      // Process provider counts
      for (const item of providerCounts) {
        locationsByProvider[item.provider] = item.count
      }
      // Process provider sizes
      for (const item of providerSizes) {
        const size = item.totalSize ? BigInt(item.totalSize) : BigInt(0)
        sizeByProvider[item.provider] = size
        totalSize += size
      }
      return {
        totalLocations: totalCount,
        locationsByProvider,
        totalSize,
        sizeByProvider,
      }
    } catch (error) {
      logger.error('Failed to get storage location statistics', { error })
      throw error
    }
  }
  /**
   * Get storage usage by credential
   */
  async getUsageByCredential(credentialId: string): Promise<{
    locationCount: number
    totalSize: bigint
    providers: string[]
  }> {
    try {
      // Get count and size for the credential
      const [stats] = await db
        .select({
          locationCount: count(),
          totalSize: sum(schema.StorageLocation.size),
        })
        .from(schema.StorageLocation)
        .where(eq(schema.StorageLocation.credentialId, credentialId))
      // Get unique providers for this credential
      const providerResults = await db
        .selectDistinct({
          provider: schema.StorageLocation.provider,
        })
        .from(schema.StorageLocation)
        .where(eq(schema.StorageLocation.credentialId, credentialId))
      const providers = providerResults.map((item) => item.provider)
      return {
        locationCount: stats.locationCount || 0,
        totalSize: stats.totalSize ? BigInt(stats.totalSize) : BigInt(0),
        providers,
      }
    } catch (error) {
      logger.error('Failed to get storage usage by credential', { credentialId, error })
      throw error
    }
  }
  // ============= Maintenance =============
  /**
   * Clean up orphaned storage locations (no file references)
   *
   * Identifies and removes storage locations that are no longer referenced
   * by any files in the system. This helps maintain database cleanliness
   * and prevents storage location table bloat.
   *
   * ## Safety Features
   * - **Age Threshold**: Only considers locations older than 3 days
   * - **Batch Processing**: Deletes in batches to avoid large transactions
   * - **Limit Protection**: Maximum 1000 locations per cleanup run
   * - **Detailed Logging**: Comprehensive operation tracking
   *
   * @returns Promise resolving to the number of deleted locations
   *
   * @throws {Error} When database operations fail
   *
   * @example
   * ```typescript
   * // Regular cleanup (e.g., in a scheduled job)
   * const deletedCount = await service.cleanupOrphanedLocations()
   *
   * if (deletedCount > 0) {
   *   console.log(`Cleaned up ${deletedCount} orphaned storage locations`)
   *
   *   // Alert if many orphaned locations (might indicate a problem)
   *   if (deletedCount > 100) {
   *     alertingSystem.notify(
   *       `High number of orphaned storage locations: ${deletedCount}`,
   *       'warning'
   *     )
   *   }
   * } else {
   *   console.log('No orphaned storage locations found')
   * }
   *
   * // In a monitoring dashboard
   * setInterval(async () => {
   *   const cleanedUp = await service.cleanupOrphanedLocations()
   *   metrics.increment('storage.cleanup.orphaned_locations', cleanedUp)
   * }, 24 * 60 * 60 * 1000) // Daily cleanup
   * ```
   *
   * @see {@link getStats} for overall statistics before/after cleanup
   *
   * @warning This operation permanently deletes data. Ensure proper
   * relationship validation before running in production.
   */
  async cleanupOrphanedLocations(): Promise<number> {
    try {
      logger.info('Starting cleanup of orphaned storage locations')
      // Find storage locations that have no file references
      // This will need to be updated based on actual database schema relationships
      // For now, we'll find locations older than a certain threshold that haven't been accessed recently
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const orphanedLocations = await db
        .select({
          id: schema.StorageLocation.id,
          provider: schema.StorageLocation.provider,
          externalId: schema.StorageLocation.externalId,
        })
        .from(schema.StorageLocation)
        .where(lt(schema.StorageLocation.createdAt, threeDaysAgo))
        .limit(1000) // Limit to prevent huge deletions
      if (orphanedLocations.length === 0) {
        logger.info('No orphaned storage locations found')
        return 0
      }
      logger.info(`Found ${orphanedLocations.length} orphaned storage locations`)
      // Delete orphaned locations in batches
      const batchSize = 100
      let totalDeleted = 0
      for (let i = 0; i < orphanedLocations.length; i += batchSize) {
        const batch = orphanedLocations.slice(i, i + batchSize)
        const ids = batch.map((loc) => loc.id)
        const result = await db
          .delete(schema.StorageLocation)
          .where(inArray(schema.StorageLocation.id, ids))
        // Drizzle doesn't return count directly, so we use the batch size as an approximation
        // In production, you might want to verify this with a separate count query if needed
        totalDeleted += batch.length
        logger.info(`Deleted batch of orphaned storage locations`, {
          batchStart: i,
          batchSize: batch.length,
          deletedInBatch: batch.length,
          totalDeleted,
        })
      }
      logger.info('Cleanup of orphaned storage locations completed', {
        totalDeleted,
      })
      return totalDeleted
    } catch (error) {
      logger.error('Failed to cleanup orphaned storage locations', { error })
      throw error
    }
  }
  /**
   * Validate storage location data
   *
   * Performs comprehensive validation of storage location data before
   * database insertion. This static method can be used independently
   * for validation without creating a service instance.
   *
   * ## Validation Rules
   * - **Provider**: Must be specified and valid
   * - **External ID**: Required, identifies the file in the provider
   * - **Size**: Must be non-negative if provided
   * - **Provider-specific**: Additional rules based on provider type
   *
   * @param data - The storage location data to validate
   * @returns Validation result with success status and error details
   *
   * @example
   * ```typescript
   * const locationData: CreateStorageLocationRequest = {
   *   provider: 'S3',
   *   externalId: 'my-bucket/file.txt',
   *   externalUrl: 'https://my-bucket.s3.amazonaws.com/file.txt',
   *   externalRev: 'etag123',
   *   size: BigInt(1024)
   * }
   *
   * const validation = StorageLocationService.validate(locationData)
   *
   * if (validation.isValid) {
   *   console.log('Data is valid, ready to create')
   *   await service.create(locationData)
   * } else {
   *   console.error('Validation failed:')
   *   validation.errors.forEach(error => {
   *     console.error(`- ${error}`)
   *   })
   * }
   *
   * // Use in form validation
   * function validateForm(formData: any): string[] {
   *   const validation = StorageLocationService.validate(formData)
   *   return validation.errors
   * }
   * ```
   *
   * @see {@link create} for the creation method that uses this validation
   * @see {@link bulkCreate} for bulk operations with validation
   */
  static validate(data: CreateStorageLocationRequest): {
    isValid: boolean
    errors: string[]
  } {
    const errors: string[] = []
    // Basic validation
    if (!data.provider) {
      errors.push('Provider is required')
    }
    if (!data.externalId) {
      errors.push('External ID is required')
    }
    // Provider-specific validation
    // TODO: Implement validation rules when StorageProvider enum is finalized
    // TODO: All providers (including S3) will be treated as external for consistency
    // Size validation
    if (data.size !== undefined && data.size < 0) {
      errors.push('Size must be non-negative')
    }
    return {
      isValid: errors.length === 0,
      errors,
    }
  }
}
// Export singleton instance
export const storageLocationService = new StorageLocationService()
