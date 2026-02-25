// packages/lib/src/files/core/file-service.ts

import { database as db, schema } from '@auxx/database'
import type {
  FileVersionEntity as FileVersion,
  FolderFileEntity as FolderFile,
} from '@auxx/database/types'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { DownloadRef } from '../adapters/base-adapter'
import { BaseService, type DatabaseClient } from './base-service'
import type { ContentAccessible } from './mixins/content-accessible'
import type { Versioned } from './mixins/versioned'
import type {
  CreateFileRequest,
  FileDownloadInfo,
  FileListOptions,
  FileSearchResult,
  FolderFileWithRelations,
  SearchOptions,
  UpdateFileRequest,
} from './types'

/**
 * Enhanced service for managing FolderFile operations
 *
 * This service extends BaseService and implements ContentAccessible and Versioned interfaces
 * to provide comprehensive file management capabilities including:
 * - CRUD operations for files
 * - Version management with checksum optimization
 * - Content access (streaming, download references)
 * - File organization (move, copy, rename)
 * - Advanced search with relevance scoring
 * - Storage integration through adapters
 *
 * @extends BaseService
 * @implements ContentAccessible - Provides content access methods
 * @implements Versioned - Provides version management methods
 */
export class FileService
  extends BaseService<
    FolderFile,
    FolderFileWithRelations,
    CreateFileRequest,
    UpdateFileRequest,
    FileSearchResult
  >
  implements ContentAccessible, Versioned
{
  /** Cached storage manager instance for lazy loading */
  private _storageManager?: any

  /**
   * Creates a new FileService instance
   *
   * @param organizationId - Optional organization ID for scoping operations
   * @param userId - Optional user ID for user-scoped operations
   * @param dbInstance - Database instance (defaults to main db instance)
   */
  constructor(organizationId?: string, userId?: string, dbInstance: typeof db = db) {
    super(organizationId, userId, dbInstance)
  }

  /**
   * Returns the entity name for error messages and logging
   *
   * @returns The string 'file'
   * @protected
   */
  protected getEntityName(): string {
    return 'file'
  }

  /**
   * Process create data with file-specific validation and defaults
   *
   * Validates required fields, ensures folder exists if specified,
   * generates file path, and normalizes extension to lowercase.
   * Note: storageLocationId belongs to versions, not the file record.
   * Use createWithVersion() for creating file + initial version.
   *
   * @param data - File creation request data
   * @returns Processed data ready for database insertion
   * @throws Error if validation fails or target folder not found
   * @protected
   */
  protected async processCreateData(data: CreateFileRequest): Promise<any> {
    // Validate required fields
    if (!data.name) {
      throw new Error('File name is required')
    }

    // storageLocationId belongs to versions, not the file record
    // Use createWithVersion() for creating file + initial version

    // Validate folder exists if specified
    if (data.folderId) {
      const [folder] = await this.db
        .select()
        .from(schema.Folder)
        .where(
          and(
            eq(schema.Folder.id, data.folderId),
            eq(schema.Folder.organizationId, data.organizationId || this.requireOrganization()),
            isNull(schema.Folder.deletedAt)
          )
        )
        .limit(1)

      if (!folder) {
        throw new Error('Target folder not found')
      }
    }

    // Generate path if not provided
    const path =
      data.path ||
      (data.folderId ? await this.generateFilePath(data.folderId, data.name) : `/${data.name}`)

    // Normalize extension to lowercase
    const normalizedExt = data.ext?.toLowerCase()

    const now = new Date()
    const folderId = data.folderId && data.folderId.trim().length > 0 ? data.folderId : null

    return {
      ...data,
      folderId,
      ext: normalizedExt,
      path,
      organizationId: data.organizationId || this.requireOrganization(),
      createdById: data.createdById || this.requireUserId(),
      isArchived: false,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    }
  }

  /**
   * Get field selection for file entities with relations
   *
   * Defines which fields to select when querying files with their relations.
   * This replaces the drizzle include configuration with explicit field selection.
   *
   * @returns Object defining field selection for joins
   * @protected
   */
  protected getFileSelectFields() {
    return {
      // FolderFile fields
      id: schema.FolderFile.id,
      name: schema.FolderFile.name,
      path: schema.FolderFile.path,
      folderId: schema.FolderFile.folderId,
      organizationId: schema.FolderFile.organizationId,
      createdById: schema.FolderFile.createdById,
      createdAt: schema.FolderFile.createdAt,
      updatedAt: schema.FolderFile.updatedAt,
      deletedAt: schema.FolderFile.deletedAt,
      isArchived: schema.FolderFile.isArchived,
      currentVersionId: schema.FolderFile.currentVersionId,

      // Joined folder fields
      folder: {
        id: schema.Folder.id,
        name: schema.Folder.name,
        path: schema.Folder.path,
      },

      // Joined current version fields
      currentVersion: {
        id: schema.FileVersion.id,
        versionNumber: schema.FileVersion.versionNumber,
        size: schema.FileVersion.size,
        mimeType: schema.FileVersion.mimeType,
        checksum: schema.FileVersion.checksum,
        storageLocationId: schema.FileVersion.storageLocationId,
      },

      // Joined storage location fields
      storageLocation: {
        id: schema.StorageLocation.id,
        provider: schema.StorageLocation.provider,
        externalId: schema.StorageLocation.externalId,
        externalUrl: schema.StorageLocation.externalUrl,
      },

      // Joined created by user fields
      createdBy: {
        id: schema.User.id,
        name: schema.User.name,
        email: schema.User.email,
      },
    }
  }

  /**
   * Legacy method for compatibility - now redirects to getFileSelectFields
   * @deprecated Use getFileSelectFields() instead
   */
  protected getRelationIncludes(): any {
    // For now, return a flag to indicate this is a Drizzle query
    return { _isDrizzleQuery: true }
  }

  // ============= Base CRUD Implementation =============

  /**
   * Explicitly return the FolderFile schema so BaseService helpers scope correctly.
   */
  protected override getEntitySchema() {
    return schema.FolderFile
  }

  /**
   * Build a scoped WHERE clause that always respects organization + soft delete rules.
   */
  private buildScopedWhere(conditions: SQL[] = [], includeDeleted = false): SQL {
    const where = super.buildBaseWhereClause(conditions, includeDeleted)
    if (where) return where

    if (conditions.length === 0) {
      return sql`true`
    }

    if (conditions.length === 1) {
      return conditions[0] as SQL
    }

    return and(...conditions)
  }

  /**
   * Translate simple filter objects (folderId, isArchived, etc.) into Drizzle conditions.
   */
  private buildFilterConditions(filters?: Record<string, any>): SQL[] {
    if (!filters) return []

    const conditions: SQL[] = []
    for (const [key, rawValue] of Object.entries(filters)) {
      if (rawValue === undefined) continue

      const column = (schema.FolderFile as Record<string, any>)[key]
      if (!column) continue

      if (rawValue === null) {
        conditions.push(isNull(column))
        continue
      }

      if (Array.isArray(rawValue)) {
        if (rawValue.length > 0) {
          conditions.push(inArray(column, rawValue))
        }
        continue
      }

      if (typeof rawValue === 'object') {
        const {
          in: inValues,
          equals,
          contains,
          mode,
          gte: minValue,
          lte: maxValue,
        } = rawValue as Record<string, any>

        let handled = false

        if (inValues !== undefined) {
          handled = true
          if (Array.isArray(inValues) && inValues.length > 0) {
            conditions.push(inArray(column, inValues))
          }
        }

        if (equals !== undefined) {
          handled = true
          if (equals === null) {
            conditions.push(isNull(column))
          } else {
            conditions.push(eq(column, equals))
          }
        }

        if (contains !== undefined && contains !== null) {
          handled = true
          const value = String(contains)
          if (value.length > 0) {
            if (mode === 'insensitive') {
              conditions.push(ilike(column, `%${value}%`))
            } else {
              conditions.push(sql`${column} LIKE ${'%' + value + '%'}`)
            }
          }
        }

        if (minValue !== undefined) {
          handled = true
          conditions.push(gte(column, minValue))
        }

        if (maxValue !== undefined) {
          handled = true
          conditions.push(lte(column, maxValue))
        }

        if (handled) continue
      }

      conditions.push(eq(column, rawValue))
    }

    return conditions
  }

  /**
   * Create a new file row using Drizzle.
   */
  async create(data: CreateFileRequest, db?: DatabaseClient): Promise<FolderFile> {
    const processed = await this.processCreateData(data)
    const client = db || this.db

    const [created] = await client.insert(schema.FolderFile).values(processed).returning()

    return created as FolderFile
  }

  /**
   * Fetch a single file scoped to the current organization.
   */
  async get(id: string, db?: DatabaseClient): Promise<FolderFile | null> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.FolderFile.id, id)])

    const rows = await client.select().from(schema.FolderFile).where(where).limit(1)

    return (rows[0] as FolderFile | undefined) ?? null
  }

  /**
   * Fetch a file with related folder, versions, storage, and creator details.
   */
  async getWithRelations(id: string, db?: DatabaseClient): Promise<FolderFileWithRelations | null> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.FolderFile.id, id)])

    const record = await (client as any).query.FolderFile.findFirst({
      where,
      with: {
        folder: {
          columns: { id: true, name: true, path: true },
        },
        currentVersion: {
          with: {
            storageLocation: true,
          },
        },
        versions: {
          with: {
            storageLocation: true,
          },
          orderBy: (version: typeof schema.FileVersion) => [desc(version.versionNumber)],
        },
        attachments: true,
        createdBy: {
          columns: { id: true, name: true, email: true },
        },
      },
    })

    return (record as FolderFileWithRelations | null) ?? null
  }

  /**
   * Update an existing file row with normalized metadata.
   */
  async update(id: string, data: UpdateFileRequest, db?: DatabaseClient): Promise<FolderFile> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.FolderFile.id, id)], true)

    const updateData: Record<string, any> = { updatedAt: new Date() }

    if (data.name !== undefined) updateData.name = data.name
    if (data.path !== undefined) updateData.path = data.path
    if (data.folderId !== undefined) updateData.folderId = data.folderId ?? null
    if (data.isArchived !== undefined) updateData.isArchived = data.isArchived
    if (data.mimeType !== undefined) updateData.mimeType = data.mimeType
    if (data.size !== undefined) updateData.size = data.size
    if (data.ext !== undefined) updateData.ext = data.ext ? data.ext.toLowerCase() : null

    const [updated] = await client
      .update(schema.FolderFile)
      .set(updateData)
      .where(where)
      .returning()

    if (!updated) {
      throw new Error('file not found')
    }

    return updated as FolderFile
  }

  /**
   * Soft delete (archive) a file by setting deletedAt.
   */
  async delete(id: string, db?: DatabaseClient): Promise<void> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.FolderFile.id, id)], true)

    await client.update(schema.FolderFile).set({ deletedAt: new Date() }).where(where)
  }

  /**
   * Permanently remove a file row.
   */
  async permanentDelete(id: string, db?: DatabaseClient): Promise<void> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.FolderFile.id, id)], true)

    await client.delete(schema.FolderFile).where(where)
  }

  /**
   * Restore a soft-deleted file.
   */
  async restore(id: string, db?: DatabaseClient): Promise<FolderFile> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.FolderFile.id, id)], true)

    const [restored] = await client
      .update(schema.FolderFile)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(where)
      .returning()

    if (!restored) {
      throw new Error('file not found')
    }

    return restored as FolderFile
  }

  /**
   * Count files matching the provided filters.
   */
  async count(filters?: Record<string, any>): Promise<number> {
    const where = this.buildScopedWhere(this.buildFilterConditions(filters))
    const [result] = await this.db.select({ value: count() }).from(schema.FolderFile).where(where)

    return Number(result?.value ?? 0)
  }

  /**
   * Provide summary statistics for files scoped to the organization.
   */
  async getStats(): Promise<{
    total: number
    byStatus: Record<string, number>
    recentActivity: Array<{
      id: string
      name: string | null
      updatedAt: Date
      size: bigint | number | null
      folderId: string | null
    }>
  }> {
    const [total, archived] = await Promise.all([this.count(), this.count({ isArchived: true })])

    const recent = await (this.db as any).query.FolderFile.findMany({
      where: this.buildScopedWhere([], false),
      columns: {
        id: true,
        name: true,
        updatedAt: true,
        size: true,
        folderId: true,
      },
      orderBy: (table: typeof schema.FolderFile) => [desc(table.updatedAt)],
      limit: 10,
    })

    return {
      total,
      byStatus: {
        active: total - archived,
        archived,
      },
      recentActivity: recent,
    }
  }

  /**
   * Generic list implementation with pagination, sorting, and filtering.
   */
  async list(
    options: {
      limit?: number
      offset?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      filters?: Record<string, any>
      includeDeleted?: boolean
    } = {}
  ): Promise<{ items: FolderFile[]; total: number; hasMore: boolean }> {
    const {
      limit = 50,
      offset = 0,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      filters,
      includeDeleted = false,
    } = options

    const where = this.buildScopedWhere(this.buildFilterConditions(filters), includeDeleted)

    const sortableColumns: Record<string, any> = {
      name: schema.FolderFile.name,
      createdAt: schema.FolderFile.createdAt,
      updatedAt: schema.FolderFile.updatedAt,
      size: schema.FolderFile.size,
      path: schema.FolderFile.path,
    }

    const orderColumn = sortableColumns[sortBy] ?? schema.FolderFile.updatedAt
    const orderBy = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn)

    const [items, totalResult] = await Promise.all([
      this.db
        .select()
        .from(schema.FolderFile)
        .where(where)
        .orderBy(orderBy)
        .offset(offset)
        .limit(limit),
      this.db.select({ value: count() }).from(schema.FolderFile).where(where),
    ])

    const total = Number(totalResult[0]?.value ?? 0)
    const hasMore = offset + items.length < total

    return {
      items: items as FolderFile[],
      total,
      hasMore,
    }
  }

  /**
   * Get searchable fields for file search
   *
   * Returns an array of field names that can be searched for file entities.
   * These fields are used in search operations for text matching.
   *
   * @returns Array of searchable field names
   * @protected
   */
  protected getSearchFields(): string[] {
    return ['name', 'path', 'ext', 'mimeType']
  }

  // ============= ContentAccessible Mixin Implementation =============

  /**
   * Get storage manager for content operations (lazy singleton)
   *
   * Lazily initializes and returns a storage manager instance scoped to the current organization.
   * The storage manager handles interactions with various storage backends (S3, local, etc.).
   * Uses dynamic import to avoid circular dependencies.
   *
   * @returns Promise resolving to storage manager instance
   * @throws Error if no organization ID is available
   * @protected
   */
  protected async getStorageManager(): Promise<any> {
    if (!this._storageManager) {
      // Import storage manager dynamically to avoid circular dependencies
      const { createStorageManager } = await import('../storage/storage-manager')
      // Use organization-scoped instance for proper credential management
      this._storageManager = createStorageManager(this.requireOrganization())
    }
    return this._storageManager
  }

  /**
   * Get version table name for file entities
   *
   * Returns the database table name used for storing file versions.
   * This is used by the Versioned mixin implementation.
   *
   * @returns The string 'fileVersion' as a key of the database instance
   * @protected
   */
  protected getVersionTableName(): keyof typeof this.db {
    return 'fileVersion'
  }

  /**
   * Get entity ID field name in version table
   *
   * Returns the field name in the version table that references the parent entity.
   * This is used by the Versioned mixin implementation for proper foreign key relationships.
   *
   * @returns The string 'fileId'
   * @protected
   */
  protected getEntityIdFieldName(): string {
    return 'fileId'
  }

  // ============= File-Specific Operations =============

  /**
   * List files in a folder with pagination
   *
   * Retrieves files contained within a specific folder (or root if folderId is null).
   * Supports filtering by file types and inclusion of archived files.
   *
   * @param folderId - ID of the folder to list files from, null for root
   * @param options - Listing options including pagination, sorting, and filters
   * @returns Promise resolving to paginated list of files with metadata
   */
  async listInFolder(
    folderId: string | null,
    options: FileListOptions = {}
  ): Promise<{
    items: FolderFile[]
    total: number
    hasMore: boolean
    counts?: { [folderId: string]: number }
  }> {
    const filters = {
      folderId,
      ...(options.fileTypes && {
        ext: {
          in: options.fileTypes.map((type) => type.toLowerCase().replace(/^\./, '')),
        },
      }),
      ...(options.includeArchived === false && { isArchived: false }),
    }

    const result = await this.list({
      limit: options.limit,
      offset: options.offset,
      sortBy: options.sortBy || 'name',
      sortOrder: options.sortOrder || 'asc',
      filters,
    })

    // Optionally include per-folder counts
    if (options.includeCounts) {
      // Get all unique folder IDs from the items
      const folderIds = [
        ...new Set(
          result.items.map((item) => item.folderId).filter((id): id is string => id !== null)
        ),
      ]

      if (folderIds.length > 0) {
        const countFilters = this.buildFilterConditions({
          folderId: { in: folderIds },
          ...(options.includeArchived === false ? { isArchived: false } : {}),
        })

        const where = this.buildScopedWhere(countFilters)

        const counts = await this.db
          .select({
            folderId: schema.FolderFile.folderId,
            _count: count(),
          })
          .from(schema.FolderFile)
          .where(where)
          .groupBy(schema.FolderFile.folderId)

        const countsMap = counts.reduce(
          (acc, count) => {
            if (count.folderId && count._count) {
              acc[count.folderId] = count._count
            }
            return acc
          },
          {} as { [folderId: string]: number }
        )

        return { ...result, counts: countsMap }
      }
    }

    return result
  }

  /**
   * Enhanced search with file-specific relevance scoring
   *
   * Performs advanced search across file metadata with relevance scoring.
   * Searches name, path, extension, and MIME type fields with different weights.
   * Supports additional filters for file types, size limits, and date ranges.
   *
   * @param query - Search query string
   * @param options - Search options including filters and result preferences
   * @returns Promise resolving to array of search results sorted by relevance
   */
  async search(query: string, options: SearchOptions = {}): Promise<FileSearchResult[]> {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      return []
    }

    const lowercaseQuery = trimmedQuery.toLowerCase()

    const searchConditions: SQL[] = [
      ilike(schema.FolderFile.name, `%${trimmedQuery}%`),
      ilike(schema.FolderFile.path, `%${trimmedQuery}%`),
      ilike(schema.FolderFile.ext, `%${lowercaseQuery}%`),
      ilike(schema.FolderFile.mimeType, `%${trimmedQuery}%`),
    ]

    const filters: SQL[] = []
    if (searchConditions.length > 0) {
      filters.push(or(...searchConditions))
    }

    const folderId = (options as Record<string, any>).folderId
    if (folderId !== undefined) {
      if (folderId === null) {
        filters.push(isNull(schema.FolderFile.folderId))
      } else {
        filters.push(eq(schema.FolderFile.folderId, folderId))
      }
    }

    if (options.fileTypes?.length) {
      const normalizedTypes = options.fileTypes.map((type) => type.toLowerCase().replace(/^\./, ''))
      filters.push(inArray(schema.FolderFile.ext, normalizedTypes))
    }

    if (options.sizeLimits?.min !== undefined) {
      filters.push(gte(schema.FolderFile.size, options.sizeLimits.min))
    }

    if (options.sizeLimits?.max !== undefined) {
      filters.push(lte(schema.FolderFile.size, options.sizeLimits.max))
    }

    if (options.dateLimits?.createdAfter) {
      filters.push(gte(schema.FolderFile.createdAt, options.dateLimits.createdAfter))
    }

    if (options.dateLimits?.createdBefore) {
      filters.push(lte(schema.FolderFile.createdAt, options.dateLimits.createdBefore))
    }

    const where = this.buildScopedWhere(filters)
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0

    const rows = options.includeContent
      ? await this.db
          .select(this.getFileSelectFields())
          .from(schema.FolderFile)
          .leftJoin(schema.Folder, eq(schema.FolderFile.folderId, schema.Folder.id))
          .leftJoin(
            schema.FileVersion,
            eq(schema.FolderFile.currentVersionId, schema.FileVersion.id)
          )
          .leftJoin(
            schema.StorageLocation,
            eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id)
          )
          .leftJoin(schema.User, eq(schema.FolderFile.createdById, schema.User.id))
          .where(where)
          .orderBy(desc(schema.FolderFile.updatedAt))
          .limit(limit)
          .offset(offset)
      : await this.db
          .select()
          .from(schema.FolderFile)
          .where(where)
          .orderBy(desc(schema.FolderFile.updatedAt))
          .limit(limit)
          .offset(offset)

    return rows
      .map((row): FileSearchResult => {
        const file = row as FolderFile
        let relevance = 0
        const matchedFields: string[] = []

        if (file.name?.toLowerCase() === lowercaseQuery) {
          relevance += 10
          matchedFields.push('name')
        } else if (file.name?.toLowerCase().includes(lowercaseQuery)) {
          relevance += 5
          matchedFields.push('name')
        }

        if (file.path?.toLowerCase().includes(lowercaseQuery)) {
          relevance += 3
          matchedFields.push('path')
        }

        if (file.ext?.toLowerCase().includes(lowercaseQuery)) {
          relevance += 2
          matchedFields.push('ext')
        }

        if (file.mimeType?.toLowerCase().includes(lowercaseQuery)) {
          relevance += 2
          matchedFields.push('mimeType')
        }

        return {
          file,
          relevance: Math.max(relevance, 1),
          matchedFields,
          snippet: this.generateSearchSnippet(file, trimmedQuery),
        }
      })
      .sort((a, b) => b.relevance - a.relevance)
  }

  /**
   * Move file to different folder
   *
   * Moves a file from its current location to a target folder.
   * Updates the file's path to reflect the new location.
   *
   * @param id - ID of the file to move
   * @param targetFolderId - ID of target folder, null for root
   * @returns Promise resolving to updated file record
   * @throws Error if file or target folder not found
   */
  async move(id: string, targetFolderId: string | null): Promise<FolderFile> {
    // Normalize targetFolderId: convert 'root' string to null for root directory
    const normalizedTargetFolderId = targetFolderId === 'root' ? null : targetFolderId

    const file = await this.get(id)
    if (!file) {
      throw new Error('File not found')
    }

    // Validate target folder exists and is accessible
    if (normalizedTargetFolderId) {
      const folderConditions: SQL[] = [eq(schema.Folder.id, normalizedTargetFolderId)]
      if (this.organizationId) {
        folderConditions.push(eq(schema.Folder.organizationId, this.organizationId))
      }
      folderConditions.push(isNull(schema.Folder.deletedAt))

      const folderWhere =
        folderConditions.length === 1 ? folderConditions[0] : and(...folderConditions)

      const [folder] = await this.db
        .select({ id: schema.Folder.id })
        .from(schema.Folder)
        .where(folderWhere)
        .limit(1)

      if (!folder) {
        throw new Error('Target folder not found')
      }
    }

    // Generate new path
    const newPath = await this.generateFilePath(normalizedTargetFolderId, file.name)

    return this.update(id, {
      folderId: normalizedTargetFolderId,
      path: newPath,
    })
  }

  /**
   * Copy file to different folder
   *
   * Creates a copy of an existing file in a target folder with optional rename.
   * Copies all file metadata and versions from the source file.
   * The new file will have a generated name if collision occurs.
   *
   * @param sourceId - ID of the source file to copy
   * @param targetFolderId - ID of target folder, null for root
   * @param newName - Optional new name for the copied file
   * @returns Promise resolving to newly created file record
   * @throws Error if source file or target folder not found
   */
  async copy(
    sourceId: string,
    targetFolderId: string | null,
    newName?: string
  ): Promise<FolderFile> {
    const sourceFile = await this.getWithRelations(sourceId)
    if (!sourceFile) {
      throw new Error('Source file not found')
    }

    // Validate target folder if specified
    if (targetFolderId) {
      const folderConditions: SQL[] = [eq(schema.Folder.id, targetFolderId)]
      if (this.organizationId) {
        folderConditions.push(eq(schema.Folder.organizationId, this.organizationId))
      }
      folderConditions.push(isNull(schema.Folder.deletedAt))

      const folderWhere =
        folderConditions.length === 1 ? folderConditions[0] : and(...folderConditions)

      const [folder] = await this.db
        .select({ id: schema.Folder.id })
        .from(schema.Folder)
        .where(folderWhere)
        .limit(1)

      if (!folder) {
        throw new Error('Target folder not found')
      }
    }

    const fileName = newName || `Copy of ${(sourceFile as any).name}`
    const newPath = await this.generateFilePath(targetFolderId, fileName)

    // Create new file record (no storageLocationId - that belongs to versions)
    const newFile = await this.create({
      name: fileName,
      path: newPath,
      ext: (sourceFile as any).ext || undefined,
      mimeType: (sourceFile as any).mimeType || undefined,
      size: (sourceFile as any).size || undefined,
      checksum: (sourceFile as any).checksum || undefined,
      folderId: targetFolderId || undefined,
      organizationId: (sourceFile as any).organizationId,
      createdById: this.requireUserId(),
    })

    // Copy all versions if the source file has them
    if (sourceFile.versions && sourceFile.versions.length > 0) {
      await this.copyVersions(sourceId, newFile.id)
    }

    return newFile
  }

  /**
   * Rename file
   *
   * Changes the name of an existing file and updates its path accordingly.
   * Extracts and updates the file extension from the new name.
   *
   * @param id - ID of the file to rename
   * @param newName - New name for the file including extension
   * @returns Promise resolving to updated file record
   * @throws Error if file not found or name is empty
   */
  async rename(id: string, newName: string): Promise<FolderFile> {
    const file = await this.get(id)
    if (!file) {
      throw new Error('File not found')
    }

    // Validate name
    if (!newName || newName.trim().length === 0) {
      throw new Error('File name cannot be empty')
    }

    // Generate new path with new name
    const newPath = await this.generateFilePath(file.folderId, newName)

    // Extract extension from new name
    const lastDotIndex = newName.lastIndexOf('.')
    const ext = lastDotIndex > 0 ? newName.substring(lastDotIndex + 1).toLowerCase() : undefined

    return this.update(id, {
      name: newName,
      path: newPath,
      ext,
    })
  }

  // ============= Enhanced File Operations =============

  /**
   * Create file with initial version
   *
   * Creates a new file record along with its initial version in a single transaction.
   * This is the preferred method for creating files as it ensures consistency
   * between the file record and its storage location.
   *
   * @param data - File creation request data
   * @param storageLocationId - ID of the storage location containing the file content
   * @returns Promise resolving to object containing both file and version records
   * @throws Error if storage location not found or validation fails
   */
  async createWithVersion(
    data: CreateFileRequest,
    storageLocationId: string
  ): Promise<{
    file: FolderFile
    version: FileVersion
  }> {
    return this.getTx(async (tx) => {
      // Create the file record (no storageLocationId here)
      const file = await this.create(data, tx)

      // Create initial version
      const version = await this.createVersion(
        file.id,
        storageLocationId,
        {
          size: data.size,
          mimeType: data.mimeType,
          checksum: data.checksum,
        },
        tx
      )

      return { file, version }
    })
  }

  /**
   * Update file content (creates new version with checksum optimization)
   *
   * Updates file content by creating a new version. Includes checksum optimization
   * to avoid creating duplicate versions when content hasn't actually changed.
   * Updates file metadata if provided.
   *
   * @param id - ID of the file to update
   * @param storageLocationId - ID of the new storage location
   * @param metadata - Optional metadata including size, MIME type, and checksum
   * @returns Promise resolving to object containing updated file and new/existing version
   * @throws Error if file not found
   */
  async updateContent(
    id: string,
    storageLocationId: string,
    metadata: {
      size?: bigint
      mimeType?: string
      checksum?: string
    } = {}
  ): Promise<{ file: FolderFile; version: FileVersion }> {
    return this.getTx(async (tx) => {
      const file = await this.get(id, tx)
      if (!file) {
        throw new Error('File not found')
      }

      // Checksum optimization: if provided, check if content already exists
      if (metadata.checksum) {
        const currentVersion = await this.getCurrentVersion(id)
        if (currentVersion && currentVersion.checksum === metadata.checksum) {
          // Content hasn't changed, return existing version instead of creating new one
          return {
            file,
            version: currentVersion as FileVersion,
          }
        }
      }

      // Create new version first
      const version = await this.createVersion(id, storageLocationId, metadata, tx)

      // Update file metadata if provided
      const updatedFile = await this.update(
        id,
        {
          ...(metadata.size && { size: metadata.size }),
          ...(metadata.mimeType && { mimeType: metadata.mimeType }),
        },
        tx
      )

      return { file: updatedFile, version }
    })
  }

  /**
   * Get file download info with metadata
   *
   * Retrieves download information for a file including URL, filename, MIME type,
   * size, and expiration details. Uses the current version of the file.
   *
   * @param id - ID of the file to get download info for
   * @returns Promise resolving to download information object
   * @throws Error if file not found or no storage location available
   */
  async getDownloadInfo(id: string): Promise<FileDownloadInfo> {
    const file = await this.getWithRelations(id)
    if (!file) {
      throw new Error('File not found')
    }

    const downloadRef = await this.getDownloadRef(id)

    return {
      kind: downloadRef.type === 'url' ? 'url' : 'stream',
      url: downloadRef.type === 'url' ? downloadRef.url : undefined,
      filename: (file as any).name,
      mimeType: (file as any).mimeType || undefined,
      size: (file as any).size || undefined,
      expiresAt: downloadRef.type === 'url' ? downloadRef.expiresAt : undefined,
    }
  }

  // ============= File Queries =============

  /**
   * Find files by path pattern
   *
   * Searches for files whose path contains the specified pattern.
   * Case-insensitive search, results ordered by path.
   *
   * @param pattern - Path pattern to search for
   * @returns Promise resolving to array of matching files
   */
  async findByPath(pattern: string): Promise<FolderFile[]> {
    const likePattern = `%${pattern}%`
    const where = this.buildScopedWhere([
      sql`lower(${schema.FolderFile.path}) LIKE lower(${likePattern})`,
    ])

    return this.db
      .select()
      .from(schema.FolderFile)
      .where(where)
      .orderBy(asc(schema.FolderFile.path))
  }

  /**
   * Get files by MIME type
   *
   * Searches for files whose MIME type contains the specified type.
   * Case-insensitive search, results ordered by name.
   *
   * @param mimeType - MIME type pattern to search for
   * @returns Promise resolving to array of matching files
   */
  async findByMimeType(
    mimeType: string | string[],
    options?: { limit: number }
  ): Promise<FolderFile[]> {
    const likePattern = `%${mimeType}%`
    const limit = options?.limit

    const where = this.buildScopedWhere([
      sql`lower(${schema.FolderFile.mimeType}) LIKE lower(${likePattern})`,
    ])

    return this.db
      .select()
      .from(schema.FolderFile)
      .where(where)
      .orderBy(asc(schema.FolderFile.name))
  }

  /**
   * Get files by extension
   *
   * Searches for files with the specified extension.
   * Uses exact equality match since extensions are normalized to lowercase on write.
   *
   * @param ext - File extension to search for (without dot)
   * @returns Promise resolving to array of matching files
   */
  async findByExtension(
    ext: string | string[],
    options?: { limit?: number }
  ): Promise<FolderFile[]> {
    const extensions = Array.isArray(ext) ? ext.map((e) => e.toLowerCase()) : ext.toLowerCase()
    const where = this.buildScopedWhere([eq(schema.FolderFile.ext, extensions)])
    const limit = options?.limit

    return this.db
      .select()
      .from(schema.FolderFile)
      .where(where)
      .orderBy(asc(schema.FolderFile.name))
  }

  /**
   * Get large files (for cleanup)
   *
   * Searches for files larger than the specified size threshold.
   * Useful for cleanup operations and storage optimization.
   * Results ordered by size descending (largest first).
   *
   * @param minSizeBytes - Minimum file size in bytes
   * @returns Promise resolving to array of large files
   */
  async findLargeFiles(minSizeBytes: bigint): Promise<FolderFile[]> {
    const where = this.buildScopedWhere([gte(schema.FolderFile.size, minSizeBytes)])

    return this.db
      .select()
      .from(schema.FolderFile)
      .where(where)
      .orderBy(desc(schema.FolderFile.size))
  }

  /**
   * Get orphaned files (files without a current version)
   *
   * Finds files that don't have a current version reference.
   * These files may need cleanup or version restoration.
   * Useful for maintenance and data integrity checks.
   *
   * @returns Promise resolving to array of orphaned files
   */
  async findOrphanedFiles(): Promise<FolderFile[]> {
    const where = this.buildScopedWhere([isNull(schema.FolderFile.currentVersionId)])

    return this.db.select().from(schema.FolderFile).where(where)
  }

  // ============= ContentAccessible Implementation =============

  /**
   * Get the binary content of an entity
   *
   * Retrieves the raw binary content of a file from its storage location.
   * Uses the current version of the file and ensures the file is not archived.
   *
   * @param id - ID of the file to get content for
   * @returns Promise resolving to file content as Buffer
   * @throws Error if file not found, archived, or no storage location available
   */
  async getContent(id: string): Promise<Buffer> {
    const where = this.buildScopedWhere(
      [eq(schema.FolderFile.id, id), eq(schema.FolderFile.isArchived, false)],
      false
    )

    const [entity] = await this.db.select().from(schema.FolderFile).where(where).limit(1)

    if (!entity) {
      throw new Error(`${this.getEntityName()} not found or not accessible`)
    }

    const storageManager = await this.getStorageManager()
    const currentVersion = await this.getCurrentVersion(id)

    if (!currentVersion || !currentVersion.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }

    return storageManager.getContent(currentVersion.storageLocationId)
  }

  /**
   * Get a download reference for an entity
   *
   * Retrieves a download reference (URL or stream) for a file.
   * The reference may be a pre-signed URL with expiration or a direct stream.
   * Uses the current version of the file and ensures the file is not archived.
   *
   * @param id - ID of the file to get download reference for
   * @returns Promise resolving to download reference object
   * @throws Error if file not found, archived, or no storage location available
   */
  async getDownloadRef(id: string): Promise<DownloadRef> {
    const where = this.buildScopedWhere(
      [eq(schema.FolderFile.id, id), eq(schema.FolderFile.isArchived, false)],
      false
    )

    const [entity] = await this.db.select().from(schema.FolderFile).where(where).limit(1)

    if (!entity) {
      throw new Error(`${this.getEntityName()} not found or not accessible`)
    }

    const currentVersion = await this.getCurrentVersion(id)
    if (!currentVersion || !currentVersion.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }

    const storageManager = await this.getStorageManager()
    return await storageManager.getDownloadRef({
      locationId: currentVersion.storageLocationId,
      filename: entity.name || undefined,
      mimeType: entity.mimeType || undefined,
    })
  }

  /**
   * Get download reference for a specific version with enhanced metadata
   *
   * Retrieves a download reference for a specific version of a file with additional
   * metadata needed for preview functionality. Supports different version specifiers.
   *
   * @param entityId - ID of the file to get download reference for
   * @param opts - Options including version specifier and disposition
   * @returns Promise resolving to enhanced download reference with metadata
   * @throws Error if file not found, version not found, or no storage location available
   */
  async getDownloadRefForVersion(
    entityId: string,
    opts: {
      version?: number | 'latest' | 'current'
      disposition?: 'inline' | 'attachment'
    } = {}
  ): Promise<
    DownloadRef & {
      filename: string
      mimeType?: string
      size?: bigint
      expiresAt?: Date
      versionNumber: number
    }
  > {
    const { version = 'current', disposition = 'inline' } = opts

    const where = this.buildScopedWhere(
      [eq(schema.FolderFile.id, entityId), eq(schema.FolderFile.isArchived, false)],
      false
    )

    const [entity] = await this.db.select().from(schema.FolderFile).where(where).limit(1)

    if (!entity) {
      throw new Error(`${this.getEntityName()} not found or not accessible`)
    }

    // Get the appropriate version based on the version parameter
    let targetVersion: (FileVersion & { storageLocation: any }) | null = null

    if (version === 'current') {
      targetVersion = await this.getCurrentVersion(entityId)
    } else if (version === 'latest') {
      targetVersion = await this.getLatestVersion(entityId)
    } else if (typeof version === 'number') {
      targetVersion = await this.getVersion(entityId, version)
    }

    if (!targetVersion || !targetVersion.storageLocationId) {
      throw new Error(`Version ${version} not found for ${this.getEntityName()}`)
    }

    const storageManager = await this.getStorageManager()
    const downloadRef = await storageManager.getDownloadRef({
      locationId: targetVersion.storageLocationId,
      disposition,
      filename: entity.name || undefined,
      mimeType: entity.mimeType || undefined,
    })

    // Return enhanced download reference with metadata
    return {
      ...downloadRef,
      filename: entity.name,
      mimeType: entity.mimeType || undefined,
      size: entity.size || undefined,
      versionNumber: targetVersion.versionNumber,
      // Use existing expiresAt if it's a URL type, otherwise set a default expiration
      expiresAt:
        downloadRef.type === 'url'
          ? downloadRef.expiresAt || new Date(Date.now() + 10 * 60 * 1000) // 10 minutes default
          : new Date(Date.now() + 10 * 60 * 1000),
    }
  }

  /**
   * Stream the content of an entity
   *
   * Provides a readable stream for the file content.
   * Useful for large files to avoid loading entire content into memory.
   * Uses the current version of the file and ensures the file is not archived.
   *
   * @param id - ID of the file to stream content for
   * @returns Promise resolving to readable stream of file content
   * @throws Error if file not found, archived, or no storage location available
   */
  async streamContent(id: string): Promise<NodeJS.ReadableStream> {
    const where = this.buildScopedWhere(
      [eq(schema.FolderFile.id, id), eq(schema.FolderFile.isArchived, false)],
      false
    )

    const [entity] = await this.db.select().from(schema.FolderFile).where(where).limit(1)

    if (!entity) {
      throw new Error(`${this.getEntityName()} not found or not accessible`)
    }

    const storageManager = await this.getStorageManager()
    const currentVersion = await this.getCurrentVersion(id)

    if (!currentVersion || !currentVersion.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }

    return storageManager.streamContent(currentVersion.storageLocationId)
  }

  /**
   * Find entity by content checksum
   *
   * Searches for a file with the specified content checksum.
   * Useful for deduplication and finding files with identical content.
   *
   * @param checksum - Content checksum to search for
   * @returns Promise resolving to matching file or null if not found
   */
  async findByChecksum(checksum: string): Promise<FolderFile | null> {
    const where = this.buildScopedWhere([eq(schema.FolderFile.checksum, checksum)])

    const [result] = await this.db.select().from(schema.FolderFile).where(where).limit(1)

    return result || null
  }

  /**
   * Get the current version of an entity
   *
   * Retrieves the current active version of a file.
   * If the file has a currentVersionId set, fetches that specific version.
   * Otherwise, returns the latest version by version number.
   *
   * @param entityId - ID of the file to get current version for
   * @returns Promise resolving to current version with storage location or null
   * @throws Error if file not found
   */
  async getCurrentVersion(
    entityId: string
  ): Promise<(FileVersion & { storageLocation: any }) | null> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    // If entity has currentVersionId, fetch that version
    if ((entity as any).currentVersionId) {
      const [version] = await this.db
        .select({
          id: schema.FileVersion.id,
          fileId: schema.FileVersion.fileId,
          versionNumber: schema.FileVersion.versionNumber,
          storageLocationId: schema.FileVersion.storageLocationId,
          size: schema.FileVersion.size,
          mimeType: schema.FileVersion.mimeType,
          checksum: schema.FileVersion.checksum,
          createdAt: schema.FileVersion.createdAt,
          storageLocation: {
            id: schema.StorageLocation.id,
            provider: schema.StorageLocation.provider,
            externalId: schema.StorageLocation.externalId,
            externalUrl: schema.StorageLocation.externalUrl,
          },
        })
        .from(schema.FileVersion)
        .leftJoin(
          schema.StorageLocation,
          eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id)
        )
        .where(eq(schema.FileVersion.id, (entity as any).currentVersionId))
        .limit(1)

      return version || null
    }

    // Otherwise, get the latest version
    const [version] = await this.db
      .select({
        id: schema.FileVersion.id,
        fileId: schema.FileVersion.fileId,
        versionNumber: schema.FileVersion.versionNumber,
        storageLocationId: schema.FileVersion.storageLocationId,
        size: schema.FileVersion.size,
        mimeType: schema.FileVersion.mimeType,
        checksum: schema.FileVersion.checksum,
        createdAt: schema.FileVersion.createdAt,
        storageLocation: {
          id: schema.StorageLocation.id,
          provider: schema.StorageLocation.provider,
          externalId: schema.StorageLocation.externalId,
          externalUrl: schema.StorageLocation.externalUrl,
        },
      })
      .from(schema.FileVersion)
      .leftJoin(
        schema.StorageLocation,
        eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id)
      )
      .where(eq(schema.FileVersion.fileId, entityId))
      .orderBy(desc(schema.FileVersion.versionNumber))
      .limit(1)

    return version || null
  }

  // ============= Versioned Implementation =============

  /**
   * Create a new version for an entity with unique version number constraint and retry
   *
   * Creates a new version of a file with automatic version numbering.
   * Handles concurrent version creation with retry logic for unique constraint violations.
   * Updates the file's currentVersionId to point to the new version.
   *
   * @param entityId - ID of the file to create version for
   * @param storageLocationId - ID of the storage location containing the version content
   * @param metadata - Additional metadata for the version
   * @returns Promise resolving to the created version
   * @throws Error if file or storage location not found
   */
  async createVersion(
    entityId: string,
    storageLocationId: string,
    metadata: any = {},
    db?: any
  ): Promise<FileVersion> {
    const dbClient = db || this.db
    const entity = await this.get(entityId, dbClient)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const run = async (tx: any) => {
      // Get the next version number within transaction (concurrency-safe)
      const [lastVersion] = await tx
        .select({ versionNumber: schema.FileVersion.versionNumber })
        .from(schema.FileVersion)
        .where(eq(schema.FileVersion.fileId, entityId))
        .orderBy(desc(schema.FileVersion.versionNumber))
        .limit(1)

      const versionNumber = (lastVersion?.versionNumber || 0) + 1

      // Get storage location details
      const [storageLocation] = await tx
        .select()
        .from(schema.StorageLocation)
        .where(eq(schema.StorageLocation.id, storageLocationId))
        .limit(1)

      if (!storageLocation) {
        throw new Error('Storage location not found')
      }

      // Create the new version
      const [version] = await tx
        .insert(schema.FileVersion)
        .values({
          fileId: entityId,
          versionNumber,
          storageLocationId,
          size: storageLocation.size,
          mimeType: storageLocation.mimeType,
          ...metadata,
        })
        .returning()

      // Update the entity's current version reference
      await tx
        .update(schema.FolderFile)
        .set({
          currentVersionId: version.id,
        })
        .where(eq(schema.FolderFile.id, entityId))

      return version as FileVersion
    }

    try {
      return await this.getTx(run)
    } catch (e: any) {
      if (e.code === '23505' || e.message?.includes('unique constraint')) {
        // PostgreSQL unique constraint violation
        // One retry for race condition
        return await this.getTx(run)
      }
      throw e
    }
  }

  /**
   * Get all versions for an entity
   *
   * Retrieves all versions of a file ordered by version number descending (newest first).
   * Includes storage location information for each version.
   *
   * @param entityId - ID of the file to get versions for
   * @returns Promise resolving to array of versions with storage locations
   * @throws Error if file not found
   */
  async getVersions(entityId: string): Promise<(FileVersion & { storageLocation: any })[]> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    return this.db
      .select({
        id: schema.FileVersion.id,
        fileId: schema.FileVersion.fileId,
        versionNumber: schema.FileVersion.versionNumber,
        storageLocationId: schema.FileVersion.storageLocationId,
        size: schema.FileVersion.size,
        mimeType: schema.FileVersion.mimeType,
        checksum: schema.FileVersion.checksum,
        createdAt: schema.FileVersion.createdAt,
        storageLocation: {
          id: schema.StorageLocation.id,
          provider: schema.StorageLocation.provider,
          externalId: schema.StorageLocation.externalId,
          externalUrl: schema.StorageLocation.externalUrl,
        },
      })
      .from(schema.FileVersion)
      .leftJoin(
        schema.StorageLocation,
        eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id)
      )
      .where(eq(schema.FileVersion.fileId, entityId))
      .orderBy(desc(schema.FileVersion.versionNumber))
  }

  /**
   * Get a specific version by number
   *
   * Retrieves a specific version of a file by its version number.
   * Includes storage location information for the version.
   *
   * @param entityId - ID of the file to get version for
   * @param versionNumber - Version number to retrieve
   * @returns Promise resolving to version with storage location or null if not found
   * @throws Error if file not found
   */
  async getVersion(
    entityId: string,
    versionNumber: number
  ): Promise<(FileVersion & { storageLocation: any }) | null> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const [version] = await this.db
      .select({
        id: schema.FileVersion.id,
        fileId: schema.FileVersion.fileId,
        versionNumber: schema.FileVersion.versionNumber,
        storageLocationId: schema.FileVersion.storageLocationId,
        size: schema.FileVersion.size,
        mimeType: schema.FileVersion.mimeType,
        checksum: schema.FileVersion.checksum,
        createdAt: schema.FileVersion.createdAt,
        storageLocation: {
          id: schema.StorageLocation.id,
          provider: schema.StorageLocation.provider,
          externalId: schema.StorageLocation.externalId,
          externalUrl: schema.StorageLocation.externalUrl,
        },
      })
      .from(schema.FileVersion)
      .leftJoin(
        schema.StorageLocation,
        eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id)
      )
      .where(
        and(
          eq(schema.FileVersion.fileId, entityId),
          eq(schema.FileVersion.versionNumber, versionNumber)
        )
      )
      .limit(1)

    return version || null
  }

  /**
   * Restore an entity to a specific version
   *
   * Sets a specific version as the current version of a file.
   * Updates the file's currentVersionId and updatedAt timestamp.
   *
   * @param entityId - ID of the file to restore
   * @param versionNumber - Version number to restore to
   * @returns Promise resolving to updated file record
   * @throws Error if file or version not found
   */
  async restoreVersion(entityId: string, versionNumber: number): Promise<FolderFile> {
    const version = await this.getVersion(entityId, versionNumber)
    if (!version) {
      throw new Error(`Version ${versionNumber} not found for ${this.getEntityName()}`)
    }

    const [entity] = await this.db
      .update(schema.FolderFile)
      .set({
        currentVersionId: version.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.FolderFile.id, entityId))
      .returning()

    return entity
  }

  /**
   * Delete a specific version (but not the current one)
   *
   * Deletes a specific version of a file. Prevents deletion of the current version
   * to maintain file integrity. Use with caution as this action is irreversible.
   *
   * @param entityId - ID of the file to delete version from
   * @param versionNumber - Version number to delete
   * @throws Error if file not found, version not found, or attempting to delete current version
   */
  async deleteVersion(entityId: string, versionNumber: number): Promise<void> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const version = await this.getVersion(entityId, versionNumber)
    if (!version) {
      throw new Error(`Version ${versionNumber} not found`)
    }

    // Don't allow deletion of the current version
    if ((entity as any).currentVersionId === version.id) {
      throw new Error('Cannot delete the current version')
    }

    await this.db.delete(schema.FileVersion).where(eq(schema.FileVersion.id, version.id))
  }

  /**
   * Get the latest version for an entity
   *
   * Retrieves the most recent version of a file by version number.
   * This may differ from the current version if the file has been restored to an older version.
   *
   * @param entityId - ID of the file to get latest version for
   * @returns Promise resolving to latest version with storage location or null
   */
  async getLatestVersion(
    entityId: string
  ): Promise<(FileVersion & { storageLocation: any }) | null> {
    const [version] = await this.db
      .select({
        id: schema.FileVersion.id,
        fileId: schema.FileVersion.fileId,
        versionNumber: schema.FileVersion.versionNumber,
        storageLocationId: schema.FileVersion.storageLocationId,
        size: schema.FileVersion.size,
        mimeType: schema.FileVersion.mimeType,
        checksum: schema.FileVersion.checksum,
        createdAt: schema.FileVersion.createdAt,
        storageLocation: {
          id: schema.StorageLocation.id,
          provider: schema.StorageLocation.provider,
          externalId: schema.StorageLocation.externalId,
          externalUrl: schema.StorageLocation.externalUrl,
        },
      })
      .from(schema.FileVersion)
      .leftJoin(
        schema.StorageLocation,
        eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id)
      )
      .where(eq(schema.FileVersion.fileId, entityId))
      .orderBy(desc(schema.FileVersion.versionNumber))
      .limit(1)

    return version || null
  }

  /**
   * Pin entity to a specific version (set as current version)
   *
   * Alias for restoreVersion - sets a specific version as the current version.
   * Useful for "pinning" a file to a known good version.
   *
   * @param entityId - ID of the file to pin
   * @param versionNumber - Version number to pin to
   * @returns Promise resolving to updated file record
   * @throws Error if file or version not found
   */
  async pinVersion(entityId: string, versionNumber: number): Promise<FolderFile> {
    const version = await this.getVersion(entityId, versionNumber)
    if (!version) {
      throw new Error(`Version ${versionNumber} not found for ${this.getEntityName()}`)
    }

    const [result] = await this.db
      .update(schema.FolderFile)
      .set({
        currentVersionId: version.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.FolderFile.id, entityId))
      .returning()

    return result
  }

  /**
   * Copy all versions from one entity to another
   *
   * Copies all versions from a source file to a target file.
   * Creates new version records for the target with the same metadata.
   * Useful when duplicating files with full version history.
   *
   * @param sourceEntityId - ID of the source file to copy versions from
   * @param targetEntityId - ID of the target file to copy versions to
   * @returns Promise resolving to array of created versions
   * @throws Error if source or target file not found
   */
  async copyVersions(sourceEntityId: string, targetEntityId: string): Promise<FileVersion[]> {
    const sourceVersions = await this.getVersions(sourceEntityId)
    const copiedVersions: FileVersion[] = []

    for (const sourceVersion of sourceVersions) {
      const copiedVersion = await this.createVersion(
        targetEntityId,
        sourceVersion.storageLocationId,
        {
          // Copy metadata but exclude entity-specific fields
          size: sourceVersion.size,
          mimeType: sourceVersion.mimeType,
          checksum: sourceVersion.checksum,
        }
      )
      copiedVersions.push(copiedVersion)
    }

    return copiedVersions
  }

  // ============= Helper Methods =============

  /**
   * Generate file path based on folder hierarchy
   *
   * Generates a unique file path within a folder, handling name collisions by appending numbers.
   * Sanitizes the filename and ensures uniqueness within the organization and folder scope.
   *
   * @param folderId - ID of the target folder, null for root
   * @param fileName - Desired filename
   * @returns Promise resolving to unique file path
   * @throws Error if folder not found
   * @private
   */
  private async generateFilePath(folderId: string | null, fileName: string): Promise<string> {
    // Sanitize filename (remove path separators and control chars)
    const safeName = fileName.replace(/[/\\]/g, '').trim() || 'untitled'

    const basePath = folderId
      ? (
          await this.db
            .select({ path: schema.Folder.path })
            .from(schema.Folder)
            .where(eq(schema.Folder.id, folderId))
            .limit(1)
        )[0]?.path
      : ''

    if (folderId && !basePath) {
      throw new Error('Folder not found')
    }

    let candidate = `${basePath || ''}/${safeName}`.replace(/\/+/g, '/')
    let n = 1
    const orgId = this.requireOrganization()

    // Check for path collisions and auto-increment if needed
    while (true) {
      const [exists] = await this.db
        .select()
        .from(schema.FolderFile)
        .where(
          and(
            eq(schema.FolderFile.organizationId, orgId),
            folderId === null
              ? isNull(schema.FolderFile.folderId)
              : eq(schema.FolderFile.folderId, folderId),
            eq(schema.FolderFile.path, candidate)
          )
        )
        .limit(1)

      if (!exists) return candidate

      // Generate new candidate with counter
      const dot = safeName.lastIndexOf('.')
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName
      const ext = dot > 0 ? safeName.slice(dot) : ''
      candidate = `${basePath || ''}/${stem} (${n++})${ext}`.replace(/\/+/g, '/')
    }
  }

  /**
   * Generate search snippet for search results
   *
   * Creates a readable snippet showing which fields matched the search query.
   * Helps users understand why a file was included in search results.
   *
   * @param file - File record that matched the search
   * @param query - Original search query
   * @returns Human-readable snippet describing the match
   * @private
   */
  private generateSearchSnippet(file: FolderFile, query: string): string {
    const parts: string[] = []

    if (file.name.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Name: ${file.name}`)
    }

    if (file.path.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Path: ${file.path}`)
    }

    if (file.mimeType?.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Type: ${file.mimeType}`)
    }

    return parts.join(' | ') || file.name
  }
}

/**
 * Factory function for creating FileService instances
 *
 * Creates a new FileService instance with optional organization and user scoping.
 * Useful for creating service instances in different contexts.
 *
 * @param organizationId - Optional organization ID for scoping operations
 * @param userId - Optional user ID for user-scoped operations
 * @returns New FileService instance
 */
export const createFileService = (organizationId?: string, userId?: string) =>
  new FileService(organizationId, userId)

/**
 * Default FileService singleton instance
 *
 * Pre-configured service instance with default database connection.
 * Use this for operations that don't require specific organization/user scoping.
 */
// export const fileService = new FileService()
