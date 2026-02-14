// packages/lib/src/files/core/filesystem-service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'
import type { FolderTreeNode } from '../core/types'
import { FileService } from './file-service'
import { FolderService } from './folder-service'

/**
 * Breadcrumb item for navigation
 */
export interface BreadcrumbItem {
  id: string | null
  name: string
  path: string
}

/**
 * Unified FileItem interface that works for both files and folders
 */
export interface FileItem {
  // Core fields (server + upload compatible)
  id: string // Server ID or temp ID during upload
  name: string
  type: 'file' | 'folder'
  size?: bigint | null // Always bigint for consistency
  displaySize: number // Normalized to number for consistent display
  mimeType?: string | null // Unified field name
  ext?: string | null // File extension
  createdAt: Date
  updatedAt: Date
  path: string
  parentId?: string | null // UNIFIED: use parentId everywhere (not folderId)
  isArchived?: boolean

  // Upload/processing state (only for uploads)
  status?:
    | 'pending'
    | 'uploading'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'deleting'
  progress?: number // 0-100 progress percentage
  error?: string // Error message if failed
  isUploading?: boolean // Flag to identify upload files
  tempId?: string // For upload tracking before server ID
  serverFileId?: string // Server ID after upload completes
  url?: string // File URL if available

  // Server-specific fields (only for server files)
  organizationId?: string
  createdById?: string
  currentVersionId?: string | null
  deletedAt?: Date | null

  // Folder-specific fields (only for folders)
  fileCount?: number // Number of files in folder
  subfolderCount?: number // Number of subfolders
  depth?: number // Folder depth in hierarchy

  // Computed hierarchy (server provides, store uses directly)
  hierarchy?: {
    folderName: string
    folderPath: string
    fullPath: string
    breadcrumbs: BreadcrumbItem[]
  }
}

const logger = createScopedLogger('files/filesystem-service')

/**
 * Reference to an item to be moved
 */
export interface MoveItemRef {
  id: string
  type: 'file' | 'folder'
}

/**
 * Collision resolution policy for move operations
 */
export type MoveCollisionPolicy = 'rename' | 'skip' | 'fail'

/**
 * Move operation mode
 */
export type MoveMode = 'atomic' | 'best-effort'

/**
 * Options for move operations
 */
export interface MoveItemsOptions {
  mode?: MoveMode // default 'best-effort'
  collision?: MoveCollisionPolicy // default 'rename'
  dryRun?: boolean // default false
}

/**
 * Plan entry for a single move operation
 */
export interface MovePlanEntry {
  id: string
  type: 'file' | 'folder'
  fromFolderId: string | null
  toFolderId: string | null
  willRename?: boolean
  newName?: string
  reason?: string // when skipped
}

/**
 * Result of a move items operation
 */
export interface MoveItemsResult {
  success: boolean
  moved: number
  failed: number
  skipped: number
  results: Array<
    | { id: string; type: 'file' | 'folder'; success: true; result: any; renamed?: boolean }
    | { id: string; type: 'file' | 'folder'; success: false; error: string }
    | { id: string; type: 'file' | 'folder'; success: false; error: 'SKIPPED' }
  >
  plan?: MovePlanEntry[] // include when dryRun == true
}

/**
 * Input options for getting complete filesystem
 */
export interface GetFileSystemOptions {
  // Pagination for files
  filesCursor?: string
  filesLimit?: number

  // Optional filtering
  fileTypes?: string[]
  includeArchived?: boolean

  // Cache optimization
  lastSync?: Date
}

/**
 * Simplified filesystem result with unified FileItem array
 */
export interface FileSystemResult {
  // Unified items array (files and folders)
  items: FileItem[]
  filesHasNextPage: boolean
  filesNextCursor: string | null
  totalFiles: number
  totalFolders: number

  // Metadata
  lastUpdated: Date

  // Incremental changes (if lastSync provided)
  changes?: ChangeLog
}

/**
 * Change log for incremental sync
 */
interface ChangeLog {
  filesAdded: string[]
  filesUpdated: string[]
  filesDeleted: string[]
  foldersAdded: string[]
  foldersUpdated: string[]
  foldersDeleted: string[]
  since: Date
}

/**
 * Unified filesystem service for efficient bulk loading
 *
 * This service provides a single method to fetch complete filesystem state
 * including all files with hierarchy info and folder structure, replacing
 * the need for multiple separate API calls in useFilesystem.
 */
export class FilesystemService {
  constructor(
    private organizationId: string,
    private userId: string,
    private dbInstance = db
  ) {}

  /**
   * Get complete filesystem state in a single optimized query
   *
   * Fetches all files with hierarchy information and complete folder structure.
   * Supports pagination for files while returning all folders for navigation.
   *
   * @param options - Configuration options for filtering and pagination
   * @returns Complete filesystem data ready for frontend consumption
   */
  async getCompleteFileSystem(options: GetFileSystemOptions): Promise<FileSystemResult> {
    logger.info('Getting complete filesystem', {
      organizationId: this.organizationId,
      options,
    })

    // Single efficient query that gets everything
    const [fileItems, folderItems] = await Promise.all([
      this.getAllFilesWithHierarchy(options),
      this.getAllFoldersWithHierarchy(),
    ])

    // Handle file pagination (files only - folders are always included)
    const filesLimit = options.filesLimit || 500
    const filesHasNextPage = fileItems.length > filesLimit
    let processedFiles = fileItems
    if (filesHasNextPage) {
      processedFiles = fileItems.slice(0, -1) // Remove extra item used for pagination
    }
    const filesNextCursor = filesHasNextPage
      ? processedFiles[processedFiles.length - 1]?.id || null
      : null

    // Get totals
    const whereClause = this.buildFileWhereClause(options)
    const [totalFiles, totalFolders] = await Promise.all([
      this.getTotalFilesCount(whereClause),
      folderItems.length, // Use actual count since we load all folders
    ])

    // Combine processed files and all folders into single array
    // NOTE: Folders are never paginated - they're always included
    const allItems = [...processedFiles, ...folderItems]

    const result: FileSystemResult = {
      // Unified items array
      items: allItems,
      filesHasNextPage,
      filesNextCursor,
      totalFiles,
      totalFolders,

      // Metadata
      lastUpdated: new Date(),

      // Incremental changes (if lastSync provided)
      changes: options.lastSync ? await this.getChangesSince(options.lastSync) : undefined,
    }

    logger.info('Complete filesystem retrieved', {
      itemsCount: result.items.length,
      hasMoreFiles: result.filesHasNextPage,
      totalFiles: result.totalFiles,
      totalFolders: result.totalFolders,
    })

    return result
  }

  /**
   * Get all files with complete hierarchy information
   *
   * Optimized query with JOINs to get files + complete folder ancestry
   * for efficient local search and navigation.
   */
  private async getAllFilesWithHierarchy(options: GetFileSystemOptions): Promise<FileItem[]> {
    const filesLimit = options.filesLimit || 500
    const baseConditions: SQL[] = [
      eq(schema.FolderFile.organizationId, this.organizationId),
      isNull(schema.FolderFile.deletedAt),
    ]

    if (!options.includeArchived) {
      baseConditions.push(eq(schema.FolderFile.isArchived, false))
    }

    // Handle file types with OR condition
    if (options.fileTypes?.length) {
      const fileTypeConditions: SQL[] = options.fileTypes.map((ext) =>
        eq(schema.FolderFile.ext, ext.toLowerCase().replace(/^\./, ''))
      )
      baseConditions.push(or(...fileTypeConditions))
    }

    // Add cursor condition to base conditions if provided
    if (options.filesCursor) {
      baseConditions.push(eq(schema.FolderFile.id, options.filesCursor))
    }

    const whereClause = and(...baseConditions)

    // Build query with left join to folder for hierarchy
    const query = this.dbInstance
      .select({
        // File fields
        id: schema.FolderFile.id,
        name: schema.FolderFile.name,
        size: schema.FolderFile.size,
        mimeType: schema.FolderFile.mimeType,
        ext: schema.FolderFile.ext,
        createdAt: schema.FolderFile.createdAt,
        updatedAt: schema.FolderFile.updatedAt,
        path: schema.FolderFile.path,
        folderId: schema.FolderFile.folderId,
        isArchived: schema.FolderFile.isArchived,
        organizationId: schema.FolderFile.organizationId,
        createdById: schema.FolderFile.createdById,
        currentVersionId: schema.FolderFile.currentVersionId,
        deletedAt: schema.FolderFile.deletedAt,
        // Folder fields
        folderName: schema.Folder.name,
        folderPath: schema.Folder.path,
      })
      .from(schema.FolderFile)
      .leftJoin(schema.Folder, eq(schema.FolderFile.folderId, schema.Folder.id))
      .where(whereClause)
      .orderBy(asc(schema.FolderFile.path), asc(schema.FolderFile.name))
      .limit(filesLimit + 1) // +1 for hasNextPage detection

    const files = await query

    // Convert to FileItem format with unified parentId field
    const fileItems: FileItem[] = files.map((file) => ({
      // Base file properties
      id: file.id,
      name: file.name,
      type: 'file' as const,
      size: file.size,
      displaySize: file.size ? Number(file.size) : 0,
      mimeType: file.mimeType,
      ext: file.ext,
      createdAt: new Date(file.createdAt),
      updatedAt: new Date(file.updatedAt),
      path: file.path,
      parentId: file.folderId, // CHANGE: folderId → parentId
      isArchived: file.isArchived,

      // Server-specific fields
      organizationId: file.organizationId,
      createdById: file.createdById,
      currentVersionId: file.currentVersionId,
      deletedAt: file.deletedAt ? new Date(file.deletedAt) : null,

      // Upload state (always false for server files)
      isUploading: false,

      // Complete hierarchy info for flattened search
      hierarchy: this.buildFileHierarchyFromFlatResult(file),
    }))

    return fileItems
  }

  /**
   * Get all folders with parent/child relationships
   */
  private async getAllFoldersWithHierarchy(): Promise<FileItem[]> {
    // Get all folders - we'll build the hierarchy info separately
    const folders = await this.dbInstance
      .select({
        // Folder fields
        id: schema.Folder.id,
        name: schema.Folder.name,
        parentId: schema.Folder.parentId,
        path: schema.Folder.path,
        depth: schema.Folder.depth,
        createdAt: schema.Folder.createdAt,
        updatedAt: schema.Folder.updatedAt,
        deletedAt: schema.Folder.deletedAt,
        isArchived: schema.Folder.isArchived,
        organizationId: schema.Folder.organizationId,
        createdById: schema.Folder.createdById,
      })
      .from(schema.Folder)
      .where(
        and(
          eq(schema.Folder.organizationId, this.organizationId),
          isNull(schema.Folder.deletedAt),
          eq(schema.Folder.isArchived, false)
        )
      )
      .orderBy(asc(schema.Folder.depth), asc(schema.Folder.path))

    // Get counts separately to simplify the main query
    const folderCounts = await Promise.all(
      folders.map(async (folder) => {
        const [fileCount, childCount] = await Promise.all([
          this.dbInstance
            .select({ count: count() })
            .from(schema.FolderFile)
            .where(
              and(eq(schema.FolderFile.folderId, folder.id), isNull(schema.FolderFile.deletedAt))
            ),
          this.dbInstance
            .select({ count: count() })
            .from(schema.Folder)
            .where(and(eq(schema.Folder.parentId, folder.id), isNull(schema.Folder.deletedAt))),
        ])

        return {
          folderId: folder.id,
          fileCount: fileCount[0]?.count || 0,
          childCount: childCount[0]?.count || 0,
        }
      })
    )

    // Create a map for quick count lookup
    const countsMap = new Map(
      folderCounts.map((c) => [c.folderId, { fileCount: c.fileCount, childCount: c.childCount }])
    )

    // Convert to FileItem format
    const folderItems: FileItem[] = folders.map((folder) => {
      const counts = countsMap.get(folder.id) || { fileCount: 0, childCount: 0 }

      return {
        // Base folder properties
        id: folder.id,
        name: folder.name,
        type: 'folder' as const,
        displaySize: 0,
        createdAt: new Date(folder.createdAt),
        updatedAt: new Date(folder.updatedAt),
        path: folder.path || '/',
        parentId: folder.parentId, // Already using parentId
        depth: folder.depth,
        isArchived: folder.isArchived,

        // Server-specific fields
        organizationId: folder.organizationId,
        createdById: folder.createdById,
        deletedAt: folder.deletedAt ? new Date(folder.deletedAt) : null,

        // Upload state (always false for server folders)
        isUploading: false,

        // Folder-specific fields
        fileCount: counts.fileCount,
        subfolderCount: counts.childCount,

        // Hierarchy info (breadcrumbs will be computed when needed)
        hierarchy: {
          folderName: this.getParentFolderName(folder, folders),
          folderPath: this.getParentFolderPath(folder, folders),
          fullPath: folder.path || '/',
          breadcrumbs: this.buildFolderBreadcrumbs(folder, folders),
        },
      }
    })

    return folderItems
  }

  /**
   * Build where clause for files query
   */
  private buildFileWhereClause(options: GetFileSystemOptions) {
    const conditions = [
      eq(schema.FolderFile.organizationId, this.organizationId),
      eq(schema.FolderFile.deletedAt, null),
    ]

    if (!options.includeArchived) {
      conditions.push(eq(schema.FolderFile.isArchived, false))
    }

    if (options.fileTypes?.length) {
      // For OR conditions with file types, we'll handle this in the query directly
      // since Drizzle handles OR differently
    }

    return and(...conditions)
  }

  /**
   * Get parent folder name from the folders array
   */
  private getParentFolderName(folder: any, allFolders: any[]): string {
    if (!folder.parentId) return 'Files'
    const parent = allFolders.find((f) => f.id === folder.parentId)
    return parent?.name || 'Files'
  }

  /**
   * Get parent folder path from the folders array
   */
  private getParentFolderPath(folder: any, allFolders: any[]): string {
    if (!folder.parentId) return '/'
    const parent = allFolders.find((f) => f.id === folder.parentId)
    return parent?.path || '/'
  }

  /**
   * Build file hierarchy information for local search from flat query result
   */
  private buildFileHierarchyFromFlatResult(file: any): FileItem['hierarchy'] {
    if (file.folderName && file.folderPath) {
      // File has a parent folder
      return {
        folderName: file.folderName,
        folderPath: file.folderPath || '/',
        fullPath: `${file.folderPath || ''}/${file.name}`.replace('//', '/'),
        breadcrumbs: this.buildPathBreadcrumbs(file.folderPath),
      }
    } else {
      // File is in root
      return {
        folderName: 'Files',
        folderPath: '/',
        fullPath: `/${file.name}`,
        breadcrumbs: [{ id: null, name: 'Files', path: '/' }],
      }
    }
  }

  /**
   * Build breadcrumbs from folder path
   */
  private buildPathBreadcrumbs(path: string | null): BreadcrumbItem[] {
    const breadcrumbs: BreadcrumbItem[] = [{ id: null, name: 'Files', path: '/' }]

    if (!path || path === '/') {
      return breadcrumbs
    }

    // Split path and build breadcrumbs
    // This is simplified - in a real implementation you'd need to look up folder IDs
    const parts = path.split('/').filter(Boolean)
    let currentPath = ''

    parts.forEach((part) => {
      currentPath += `/${part}`
      breadcrumbs.push({
        id: 'folder-lookup-needed', // Would need actual folder ID lookup
        name: part,
        path: currentPath,
      })
    })

    return breadcrumbs
  }

  /**
   * Build breadcrumbs for a folder using the complete folder list
   */
  private buildFolderBreadcrumbs(folder: any, allFolders: any[]): BreadcrumbItem[] {
    const breadcrumbs: BreadcrumbItem[] = [{ id: null, name: 'Files', path: '/' }]

    // Build breadcrumb chain by walking up the parent hierarchy
    const ancestors: BreadcrumbItem[] = []
    let currentFolder = folder

    while (currentFolder?.parent) {
      const parent = allFolders.find((f) => f.id === currentFolder.parentId)
      if (!parent) break

      ancestors.unshift({
        id: parent.id,
        name: parent.name,
        path: parent.path || '/',
      })

      currentFolder = parent
    }

    // Add the folder itself to the breadcrumbs
    const folderBreadcrumb: BreadcrumbItem = {
      id: folder.id,
      name: folder.name,
      path: folder.path || '/',
    }

    return [...breadcrumbs, ...ancestors, folderBreadcrumb]
  }

  /**
   * Get total files count (with caching for performance)
   */
  private async getTotalFilesCount(whereClause: any): Promise<number> {
    // In production, this should be cached or approximated for better performance
    const result = await this.dbInstance
      .select({ count: count() })
      .from(schema.FolderFile)
      .where(whereClause)

    return result[0]?.count || 0
  }

  /**
   * Get changes since last sync for incremental updates
   */
  private async getChangesSince(lastSync: Date): Promise<ChangeLog> {
    // Get files that have changed since lastSync
    const [filesAdded, filesUpdated, filesDeleted, foldersAdded, foldersUpdated, foldersDeleted] =
      await Promise.all([
        // Files added
        this.dbInstance
          .select({ id: schema.FolderFile.id })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.organizationId, this.organizationId),
              gte(schema.FolderFile.createdAt, lastSync),
              isNull(schema.FolderFile.deletedAt)
            )
          ),

        // Files updated
        this.dbInstance
          .select({ id: schema.FolderFile.id })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.organizationId, this.organizationId),
              gte(schema.FolderFile.updatedAt, lastSync),
              lt(schema.FolderFile.createdAt, lastSync),
              isNull(schema.FolderFile.deletedAt)
            )
          ),

        // Files deleted
        this.dbInstance
          .select({ id: schema.FolderFile.id })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.organizationId, this.organizationId),
              gte(schema.FolderFile.deletedAt, lastSync)
            )
          ),

        // Folders added
        this.dbInstance
          .select({ id: schema.Folder.id })
          .from(schema.Folder)
          .where(
            and(
              eq(schema.Folder.organizationId, this.organizationId),
              gte(schema.Folder.createdAt, lastSync),
              isNull(schema.Folder.deletedAt)
            )
          ),

        // Folders updated
        this.dbInstance
          .select({ id: schema.Folder.id })
          .from(schema.Folder)
          .where(
            and(
              eq(schema.Folder.organizationId, this.organizationId),
              gte(schema.Folder.updatedAt, lastSync),
              lt(schema.Folder.createdAt, lastSync),
              isNull(schema.Folder.deletedAt)
            )
          ),

        // Folders deleted
        this.dbInstance
          .select({ id: schema.Folder.id })
          .from(schema.Folder)
          .where(
            and(
              eq(schema.Folder.organizationId, this.organizationId),
              gte(schema.Folder.deletedAt, lastSync)
            )
          ),
      ])

    return {
      filesAdded: filesAdded.map((f) => f.id),
      filesUpdated: filesUpdated.map((f) => f.id),
      filesDeleted: filesDeleted.map((f) => f.id),
      foldersAdded: foldersAdded.map((f) => f.id),
      foldersUpdated: foldersUpdated.map((f) => f.id),
      foldersDeleted: foldersDeleted.map((f) => f.id),
      since: lastSync,
    }
  }

  /**
   * Move multiple files and folders to a target location
   *
   * Provides atomic or best-effort bulk move operations with collision handling,
   * circular dependency prevention, and nested selection pruning.
   *
   * @param items - Array of items to move (files and folders)
   * @param targetFolderId - Target folder ID (null for root)
   * @param options - Move operation options
   * @returns Result with move status and details
   */
  async moveItems(
    items: MoveItemRef[],
    targetFolderId: string | null,
    options: MoveItemsOptions = {}
  ): Promise<MoveItemsResult> {
    // Normalize targetFolderId: convert 'root' string to null for root directory
    const normalizedTargetFolderId = targetFolderId === 'root' ? null : targetFolderId

    const opts = {
      mode: options.mode || 'best-effort',
      collision: options.collision || 'rename',
      dryRun: options.dryRun || false,
    }

    logger.info('Starting moveItems operation', {
      organizationId: this.organizationId,
      itemCount: items.length,
      targetFolderId: normalizedTargetFolderId,
      options: opts,
    })

    try {
      // Step 1: Create move plan with validation
      const plan = await this.createMovePlan(items, normalizedTargetFolderId, opts)

      // Step 2: Return plan if dry run
      if (opts.dryRun) {
        return {
          success: true,
          moved: 0,
          failed: 0,
          skipped: plan.filter((p) => p.reason).length,
          results: [],
          plan,
        }
      }

      // Step 3: Execute plan
      return await this.executePlan(plan, opts)
    } catch (error) {
      logger.error('moveItems operation failed', {
        error,
        items,
        targetFolderId: normalizedTargetFolderId,
        options,
      })
      throw error
    }
  }

  /**
   * Create a move plan with validation and collision handling
   */
  private async createMovePlan(
    items: MoveItemRef[],
    targetFolderId: string | null,
    options: MoveItemsOptions
  ): Promise<MovePlanEntry[]> {
    // Step 1: Validate target folder exists
    if (targetFolderId) {
      const targetFolder = await this.dbInstance
        .select({ id: schema.Folder.id })
        .from(schema.Folder)
        .where(
          and(
            eq(schema.Folder.id, targetFolderId),
            eq(schema.Folder.organizationId, this.organizationId),
            isNull(schema.Folder.deletedAt)
          )
        )
        .limit(1)

      if (!targetFolder.length) {
        throw new Error('Target folder not found')
      }
    }

    // Step 2: Load all files and folders in bulk
    const fileIds = items.filter((i) => i.type === 'file').map((i) => i.id)
    const folderIds = items.filter((i) => i.type === 'folder').map((i) => i.id)

    const [files, folders] = await Promise.all([
      fileIds.length > 0
        ? this.dbInstance
            .select({
              id: schema.FolderFile.id,
              name: schema.FolderFile.name,
              folderId: schema.FolderFile.folderId,
              path: schema.FolderFile.path,
            })
            .from(schema.FolderFile)
            .where(
              and(
                inArray(schema.FolderFile.id, fileIds),
                eq(schema.FolderFile.organizationId, this.organizationId),
                isNull(schema.FolderFile.deletedAt)
              )
            )
        : [],
      folderIds.length > 0
        ? this.dbInstance
            .select({
              id: schema.Folder.id,
              name: schema.Folder.name,
              parentId: schema.Folder.parentId,
              path: schema.Folder.path,
            })
            .from(schema.Folder)
            .where(
              and(
                inArray(schema.Folder.id, folderIds),
                eq(schema.Folder.organizationId, this.organizationId),
                isNull(schema.Folder.deletedAt)
              )
            )
        : [],
    ])

    // Step 3: Prune nested selections (if folder selected, drop children under its path)
    const prunedItems = this.pruneNestedSelections(items, files, folders)

    // Step 4: Create plan entries with validation
    const plan: MovePlanEntry[] = []

    for (const item of prunedItems) {
      const entry: MovePlanEntry = {
        id: item.id,
        type: item.type,
        fromFolderId: null,
        toFolderId: targetFolderId,
      }

      if (item.type === 'file') {
        const file = files.find((f) => f.id === item.id)
        if (!file) {
          entry.reason = 'File not found'
          plan.push(entry)
          continue
        }

        entry.fromFolderId = file.folderId

        // No-op check
        if (file.folderId === targetFolderId) {
          entry.reason = 'Already in target folder'
          plan.push(entry)
          continue
        }

        // Check for name collision
        await this.handleNameCollision(entry, file.name, 'file', targetFolderId, options.collision!)
      } else {
        const folder = folders.find((f) => f.id === item.id)
        if (!folder) {
          entry.reason = 'Folder not found'
          plan.push(entry)
          continue
        }

        entry.fromFolderId = folder.parentId

        // No-op check
        if (folder.parentId === targetFolderId) {
          entry.reason = 'Already in target folder'
          plan.push(entry)
          continue
        }

        // Circular dependency check
        if (
          targetFolderId &&
          (await this.wouldCreateCircularReference(folder.id, targetFolderId))
        ) {
          entry.reason = 'Would create circular reference'
          plan.push(entry)
          continue
        }

        // Check for name collision
        await this.handleNameCollision(
          entry,
          folder.name,
          'folder',
          targetFolderId,
          options.collision!
        )
      }

      plan.push(entry)
    }

    return plan
  }

  /**
   * Remove nested selections (if parent folder is selected, remove its children)
   */
  private pruneNestedSelections(items: MoveItemRef[], files: any[], folders: any[]): MoveItemRef[] {
    const selectedFolderPaths = new Set<string>()

    // Collect all selected folder paths
    for (const item of items) {
      if (item.type === 'folder') {
        const folder = folders.find((f) => f.id === item.id)
        if (folder?.path) {
          selectedFolderPaths.add(folder.path)
        }
      }
    }

    // Filter out items that are children of selected folders
    return items.filter((item) => {
      if (item.type === 'file') {
        const file = files.find((f) => f.id === item.id)
        if (file?.path) {
          // Check if file path starts with any selected folder path
          return !Array.from(selectedFolderPaths).some(
            (folderPath) => file.path.startsWith(folderPath + '/') || file.path === folderPath
          )
        }
      } else {
        const folder = folders.find((f) => f.id === item.id)
        if (folder?.path) {
          // Check if folder path starts with any other selected folder path
          return !Array.from(selectedFolderPaths).some(
            (folderPath) =>
              folder.path !== folderPath &&
              (folder.path.startsWith(folderPath + '/') || folder.path === folderPath)
          )
        }
      }
      return true
    })
  }

  /**
   * Handle name collisions based on policy
   */
  private async handleNameCollision(
    entry: MovePlanEntry,
    originalName: string,
    type: 'file' | 'folder',
    targetFolderId: string | null,
    policy: MoveCollisionPolicy
  ): Promise<void> {
    // Check if name exists in target
    const existingName = await this.checkNameExistsInTarget(originalName, type, targetFolderId)

    if (!existingName) {
      return // No collision
    }

    switch (policy) {
      case 'fail':
        entry.reason = `Name collision: ${originalName} already exists in target`
        break
      case 'skip':
        entry.reason = 'SKIPPED due to name collision'
        break
      case 'rename':
        entry.willRename = true
        entry.newName = await this.generateUniqueNameInTarget(originalName, type, targetFolderId)
        break
    }
  }

  /**
   * Check if name exists in target folder
   */
  private async checkNameExistsInTarget(
    name: string,
    type: 'file' | 'folder',
    targetFolderId: string | null
  ): Promise<boolean> {
    if (type === 'file') {
      const existing = await this.dbInstance
        .select({ id: schema.FolderFile.id })
        .from(schema.FolderFile)
        .where(
          and(
            eq(schema.FolderFile.name, name),
            targetFolderId
              ? eq(schema.FolderFile.folderId, targetFolderId)
              : isNull(schema.FolderFile.folderId),
            eq(schema.FolderFile.organizationId, this.organizationId),
            isNull(schema.FolderFile.deletedAt)
          )
        )
        .limit(1)

      return existing.length > 0
    } else {
      const existing = await this.dbInstance
        .select({ id: schema.Folder.id })
        .from(schema.Folder)
        .where(
          and(
            eq(schema.Folder.name, name),
            targetFolderId
              ? eq(schema.Folder.parentId, targetFolderId)
              : isNull(schema.Folder.parentId),
            eq(schema.Folder.organizationId, this.organizationId),
            isNull(schema.Folder.deletedAt)
          )
        )
        .limit(1)

      return existing.length > 0
    }
  }

  /**
   * Generate unique name with (n) suffix
   */
  private async generateUniqueNameInTarget(
    originalName: string,
    type: 'file' | 'folder',
    targetFolderId: string | null
  ): Promise<string> {
    let counter = 1
    let newName: string

    // Extract name and extension for files
    const lastDotIndex = originalName.lastIndexOf('.')
    const hasExtension = type === 'file' && lastDotIndex > 0
    const baseName = hasExtension ? originalName.substring(0, lastDotIndex) : originalName
    const extension = hasExtension ? originalName.substring(lastDotIndex) : ''

    do {
      newName = hasExtension
        ? `${baseName} (${counter})${extension}`
        : `${originalName} (${counter})`
      counter++
    } while (await this.checkNameExistsInTarget(newName, type, targetFolderId))

    return newName
  }

  /**
   * Check if moving folder would create circular reference
   */
  private async wouldCreateCircularReference(
    folderId: string,
    targetParentId: string
  ): Promise<boolean> {
    // If trying to move folder into itself, that's circular
    if (folderId === targetParentId) {
      return true
    }

    // Walk up the parent chain of target to see if we encounter the folder being moved
    let currentParentId: string | null = targetParentId

    while (currentParentId) {
      if (currentParentId === folderId) {
        return true // Found circular reference
      }

      const parent = await this.dbInstance
        .select({ parentId: schema.Folder.parentId })
        .from(schema.Folder)
        .where(
          and(
            eq(schema.Folder.id, currentParentId),
            eq(schema.Folder.organizationId, this.organizationId),
            isNull(schema.Folder.deletedAt)
          )
        )
        .limit(1)

      currentParentId = parent[0]?.parentId || null
    }

    return false
  }

  /**
   * Execute the move plan
   */
  private async executePlan(
    plan: MovePlanEntry[],
    options: MoveItemsOptions
  ): Promise<MoveItemsResult> {
    if (options.mode === 'atomic') {
      return this.executeAtomicMove(plan, options)
    } else {
      return this.executeBestEffortMove(plan, options)
    }
  }

  /**
   * Execute moves in a single transaction (all-or-nothing)
   */
  private async executeAtomicMove(
    plan: MovePlanEntry[],
    options: MoveItemsOptions
  ): Promise<MoveItemsResult> {
    return this.dbInstance.transaction(async (tx) => {
      const fileService = new FileService(this.organizationId, this.userId, tx)
      const folderService = new FolderService(this.organizationId, this.userId, tx)

      const results: MoveItemsResult['results'] = []
      let moved = 0
      let failed = 0
      let skipped = 0

      // Process files first
      for (const entry of plan.filter((p) => p.type === 'file')) {
        if (entry.reason) {
          skipped++
          results.push({
            id: entry.id,
            type: 'file',
            success: false,
            error: entry.reason === 'SKIPPED' ? 'SKIPPED' : entry.reason,
          })
          continue
        }

        try {
          // Move file
          const result = await fileService.move(entry.id, entry.toFolderId)

          // Rename if needed
          if (entry.willRename && entry.newName) {
            await fileService.rename(entry.id, entry.newName)
          }

          moved++
          results.push({
            id: entry.id,
            type: 'file',
            success: true,
            result,
            renamed: entry.willRename,
          })
        } catch (error) {
          failed++
          results.push({
            id: entry.id,
            type: 'file',
            success: false,
            error: error instanceof Error ? error.message : 'Move failed',
          })
        }
      }

      // Process folders second
      for (const entry of plan.filter((p) => p.type === 'folder')) {
        if (entry.reason) {
          skipped++
          results.push({
            id: entry.id,
            type: 'folder',
            success: false,
            error: entry.reason === 'SKIPPED' ? 'SKIPPED' : entry.reason,
          })
          continue
        }

        try {
          // Move folder
          const result = await folderService.move(entry.id, entry.toFolderId)

          // Rename if needed
          if (entry.willRename && entry.newName) {
            await folderService.rename(entry.id, entry.newName)
          }

          moved++
          results.push({
            id: entry.id,
            type: 'folder',
            success: true,
            result,
            renamed: entry.willRename,
          })
        } catch (error) {
          failed++
          results.push({
            id: entry.id,
            type: 'folder',
            success: false,
            error: error instanceof Error ? error.message : 'Move failed',
          })
        }
      }

      return {
        success: failed === 0,
        moved,
        failed,
        skipped,
        results,
      }
    })
  }

  /**
   * Execute moves with individual transactions (collect results)
   */
  private async executeBestEffortMove(
    plan: MovePlanEntry[],
    options: MoveItemsOptions
  ): Promise<MoveItemsResult> {
    const fileService = new FileService(this.organizationId, this.userId, this.dbInstance)
    const folderService = new FolderService(this.organizationId, this.userId, this.dbInstance)

    const results: MoveItemsResult['results'] = []
    let moved = 0
    let failed = 0
    let skipped = 0

    // Process files first
    for (const entry of plan.filter((p) => p.type === 'file')) {
      if (entry.reason) {
        skipped++
        results.push({
          id: entry.id,
          type: 'file',
          success: false,
          error: entry.reason === 'SKIPPED' ? 'SKIPPED' : entry.reason,
        })
        continue
      }

      try {
        await this.dbInstance.transaction(async (tx) => {
          const txFileService = new FileService(this.organizationId, this.userId, tx)

          // Move file
          const result = await txFileService.move(entry.id, entry.toFolderId)

          // Rename if needed
          if (entry.willRename && entry.newName) {
            await txFileService.rename(entry.id, entry.newName)
          }

          moved++
          results.push({
            id: entry.id,
            type: 'file',
            success: true,
            result,
            renamed: entry.willRename,
          })
        })
      } catch (error) {
        failed++
        results.push({
          id: entry.id,
          type: 'file',
          success: false,
          error: error instanceof Error ? error.message : 'Move failed',
        })
      }
    }

    // Process folders second
    for (const entry of plan.filter((p) => p.type === 'folder')) {
      if (entry.reason) {
        skipped++
        results.push({
          id: entry.id,
          type: 'folder',
          success: false,
          error: entry.reason === 'SKIPPED' ? 'SKIPPED' : entry.reason,
        })
        continue
      }

      try {
        await this.dbInstance.transaction(async (tx) => {
          const txFolderService = new FolderService(this.organizationId, this.userId, tx)

          // Move folder
          const result = await txFolderService.move(entry.id, entry.toFolderId)

          // Rename if needed
          if (entry.willRename && entry.newName) {
            await txFolderService.rename(entry.id, entry.newName)
          }

          moved++
          results.push({
            id: entry.id,
            type: 'folder',
            success: true,
            result,
            renamed: entry.willRename,
          })
        })
      } catch (error) {
        failed++
        results.push({
          id: entry.id,
          type: 'folder',
          success: false,
          error: error instanceof Error ? error.message : 'Move failed',
        })
      }
    }

    return {
      success: failed === 0,
      moved,
      failed,
      skipped,
      results,
    }
  }

  /**
   * Rename a file or folder by delegating to the appropriate service
   *
   * @param id - ID of the item to rename
   * @param type - Type of the item ('file' or 'folder')
   * @param newName - New name for the item
   * @returns Updated item
   */
  async renameItem(id: string, type: 'file' | 'folder', newName: string): Promise<FileItem> {
    logger.info('Renaming item', {
      organizationId: this.organizationId,
      id,
      type,
      newName,
    })

    try {
      if (type === 'file') {
        const fileService = new FileService(this.organizationId, this.userId, this.dbInstance)
        const file = await fileService.rename(id, newName)

        // Convert to FileItem format
        return {
          id: file.id,
          name: file.name,
          type: 'file',
          size: file.size,
          displaySize: file.size ? Number(file.size) : 0,
          mimeType: file.mimeType,
          ext: file.ext,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          path: file.path,
          parentId: file.folderId,
          isArchived: file.isArchived,
          organizationId: file.organizationId,
          createdById: file.createdById,
          currentVersionId: file.currentVersionId,
          deletedAt: file.deletedAt,
          isUploading: false,
        }
      } else {
        const folderService = new FolderService(this.organizationId, this.userId, this.dbInstance)
        const folder = await folderService.rename(id, newName)

        // Convert to FileItem format
        return {
          id: folder.id,
          name: folder.name,
          type: 'folder',
          displaySize: 0,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          path: folder.path || '/',
          parentId: folder.parentId,
          depth: folder.depth,
          isArchived: folder.isArchived,
          organizationId: folder.organizationId,
          createdById: folder.createdById,
          deletedAt: folder.deletedAt,
          isUploading: false,
        }
      }
    } catch (error) {
      logger.error('Failed to rename item', { error, id, type, newName })
      throw error
    }
  }
}

/**
 * Factory function for creating FilesystemService instances
 */
export const createFilesystemService = (organizationId: string, userId: string) =>
  new FilesystemService(organizationId, userId)

/**
 * Default export of the service class
 */
export default FilesystemService
