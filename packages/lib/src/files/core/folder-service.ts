// packages/lib/src/files/core/folder-service.ts

import { type Database, database, schema } from '@auxx/database'
import type { FolderEntity as Folder } from '@auxx/database/types'
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
  max,
  type SQL,
  sql,
  sum,
} from 'drizzle-orm'
import { BaseService } from './base-service'
import { FileService } from './file-service'
import type {
  CreateFolderRequest,
  FolderContents,
  FolderSearchResult,
  FolderTreeNode,
  FolderWithRelations,
  Nullish,
  SearchOptions,
  UpdateFolderRequest,
  ValidationResult,
} from './types'

/**
 * Enhanced service for managing folder hierarchy and organization
 * Extends BaseService with specialized hierarchy management operations
 */
export class FolderService extends BaseService<
  Folder,
  FolderWithRelations,
  CreateFolderRequest,
  UpdateFolderRequest,
  FolderSearchResult
> {
  /**
   * Creates a new FolderService instance
   * @param organizationId - Optional organization ID to scope operations to
   * @param userId - Optional user ID for created/updated records
   * @param dbInstance - Database instance to use (defaults to global db)
   */
  constructor(organizationId?: string, userId?: string, dbInstance: Database = database) {
    super(organizationId, userId, dbInstance)
  }

  /**
   * Returns the entity name for this service
   * @returns The entity name 'folder'
   */
  protected getEntityName(): string {
    return 'folder'
  }

  /**
   * Explicitly return the Folder schema so BaseService helpers scope correctly.
   */
  protected override getEntitySchema() {
    return schema.Folder
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
   * Translate simple filter objects (parentId, name, etc.) into Drizzle conditions.
   */
  private buildFilterConditions(filters?: Record<string, any>): SQL[] {
    if (!filters) return []

    const conditions: SQL[] = []
    for (const [key, rawValue] of Object.entries(filters)) {
      if (rawValue === undefined) continue

      const column = (schema.Folder as any)[key]
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
   * Process create data with folder-specific validation and path computation
   * Validates folder name, parent existence, name conflicts, and computes path and depth
   * @param data - The folder creation data
   * @returns Processed data with computed path, depth, organizationId, and createdById
   * @throws Error if validation fails
   */
  protected async processCreateData(data: CreateFolderRequest): Promise<any> {
    // Validate required fields
    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Folder name is required')
    }

    // Validate parent folder exists if specified
    if (data.parentId) {
      const parent = await this.get(data.parentId)
      if (!parent) {
        throw new Error('Parent folder not found')
      }
    }

    // Check for name conflicts
    const existing = await this.findByNameAndParent(data.name, data.parentId)
    if (existing) {
      throw new Error('A folder with this name already exists in the parent folder')
    }

    // Compute path and depth
    const path = await this.computeNewFolderPath(data.parentId, data.name)
    const depth = data.parentId ? (await this.getParentDepth(data.parentId)) + 1 : 0

    const now = new Date()

    return {
      ...data,
      path,
      depth,
      organizationId: data.organizationId || this.requireOrganization(),
      createdById: data.createdById || this.requireUserId(),
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Get field selection for folder entities with relations
   *
   * Defines which fields to select when querying folders with their relations.
   * This replaces the Prisma include configuration with explicit field selection.
   *
   * @returns Object defining field selection for joins
   * @protected
   */
  protected getFolderSelectFields() {
    return {
      // Folder fields
      id: schema.Folder.id,
      name: schema.Folder.name,
      path: schema.Folder.path,
      depth: schema.Folder.depth,
      parentId: schema.Folder.parentId,
      organizationId: schema.Folder.organizationId,
      createdById: schema.Folder.createdById,
      createdAt: schema.Folder.createdAt,
      updatedAt: schema.Folder.updatedAt,
      deletedAt: schema.Folder.deletedAt,
    }
  }

  /**
   * Legacy method for compatibility - now redirects to getFolderSelectFields
   * @deprecated Use getFolderSelectFields() instead
   */
  protected getRelationIncludes(): any {
    // For now, return a flag to indicate this is a Drizzle query
    return { _isDrizzleQuery: true }
  }

  /**
   * Get searchable fields for folder search
   * @returns Array of field names that can be searched
   */
  protected getSearchFields(): string[] {
    return ['name', 'path']
  }

  // ============= Base CRUD Implementation =============

  /**
   * Create a new folder using Drizzle.
   */
  async create(data: CreateFolderRequest, db?: any): Promise<Folder> {
    const processed = await this.processCreateData(data)
    const client = db || this.db

    const [created] = await client.insert(schema.Folder).values(processed).returning()

    return created as Folder
  }

  /**
   * Fetch a single folder scoped to the current organization.
   */
  async get(id: string, db?: any): Promise<Folder | null> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.Folder.id, id)])

    const rows = await client.select().from(schema.Folder).where(where).limit(1)

    return (rows[0] as Folder | undefined) ?? null
  }

  /**
   * Fetch a folder with related parent, children, files, and creator details.
   */
  async getWithRelations(id: string, db?: any): Promise<FolderWithRelations | null> {
    const client = db || this.db
    const where = this.buildScopedWhere([eq(schema.Folder.id, id)])

    const record = await (client as any).query.Folder.findFirst({
      where,
      with: {
        parent: true,
        children: {
          where: (children: any, { isNull }: any) => isNull(children.deletedAt),
          orderBy: (children: any, { asc }: any) => [asc(children.name)],
        },
        files: {
          where: (files: any, { isNull }: any) => isNull(files.deletedAt),
          orderBy: (files: any, { asc }: any) => [asc(files.name)],
          limit: 50, // Limit files to prevent large queries
        },
        createdBy: {
          columns: { id: true, name: true, email: true },
        },
      },
    })

    return (record as FolderWithRelations | null) ?? null
  }

  /**
   * Count folders matching the provided filters.
   */
  async count(filters?: Record<string, any>): Promise<number> {
    const where = this.buildScopedWhere(this.buildFilterConditions(filters))
    const [result] = await this.db.select({ value: count() }).from(schema.Folder).where(where)

    return Number(result?.value ?? 0)
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
  ): Promise<{ items: Folder[]; total: number; hasMore: boolean }> {
    const {
      limit = 50,
      offset = 0,
      sortBy = 'name',
      sortOrder = 'asc',
      filters,
      includeDeleted = false,
    } = options

    const where = this.buildScopedWhere(this.buildFilterConditions(filters), includeDeleted)

    const sortableColumns: Record<string, any> = {
      name: schema.Folder.name,
      createdAt: schema.Folder.createdAt,
      updatedAt: schema.Folder.updatedAt,
      path: schema.Folder.path,
      depth: schema.Folder.depth,
    }

    const orderColumn = sortableColumns[sortBy] ?? schema.Folder.name
    const orderBy = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn)

    const [items, totalResult] = await Promise.all([
      this.db
        .select()
        .from(schema.Folder)
        .where(where)
        .orderBy(orderBy)
        .offset(offset)
        .limit(limit),
      this.db.select({ value: count() }).from(schema.Folder).where(where),
    ])

    const total = Number(totalResult[0]?.value ?? 0)
    const hasMore = offset + items.length < total

    return {
      items: items as Folder[],
      total,
      hasMore,
    }
  }

  /**
   * Provide summary statistics for folders scoped to the organization.
   */
  async getStats(): Promise<{
    total: number
    byStatus: Record<string, number>
    recentActivity: Array<{
      id: string
      name: string
      updatedAt: Date
      depth: number
      parentId: string | null
    }>
  }> {
    const total = await this.count()

    const recent = await (this.db as any).query.Folder.findMany({
      where: this.buildScopedWhere([], false),
      columns: {
        id: true,
        name: true,
        updatedAt: true,
        depth: true,
        parentId: true,
      },
      orderBy: (table: typeof schema.Folder) => [desc(table.updatedAt)],
      limit: 10,
    })

    return {
      total,
      byStatus: {
        active: total,
      },
      recentActivity: recent,
    }
  }

  // ============= Enhanced Folder Operations =============

  /**
   * Enhanced update with path recalculation
   * Updates folder properties and recalculates paths for hierarchy changes
   * @param id - The folder ID to update
   * @param data - The update data
   * @returns Updated folder
   * @throws Error if folder not found, name conflicts, or circular reference detected
   */
  async update(id: string, data: UpdateFolderRequest): Promise<Folder> {
    const existing = await this.get(id)
    if (!existing) {
      throw new Error('Folder not found')
    }

    // Determine effective parent and name for conflict checking
    const effectiveName = data.name !== undefined ? data.name : existing.name
    const effectiveParentId = data.parentId !== undefined ? data.parentId : existing.parentId

    // Check for name conflicts in the effective (target) parent
    if (data.name !== undefined || data.parentId !== undefined) {
      const conflict = await this.findByNameAndParent(effectiveName, effectiveParentId)
      if (conflict && conflict.id !== id) {
        throw new Error('A folder with this name already exists in the target parent folder')
      }
    }

    // If parent is changing, validate and check for circular references
    if (data.parentId !== undefined && data.parentId !== existing.parentId) {
      if (data.parentId && (await this.wouldCreateCircularReference(id, data.parentId))) {
        throw new Error('Move would create circular reference')
      }
    }

    const updateData: any = { ...data }

    // Recalculate path and depth if name or parent changed
    if (data.name || data.parentId !== undefined) {
      const newName = data.name || existing.name
      const newParentId = data.parentId !== undefined ? data.parentId : existing.parentId

      updateData.path = await this.computeNewFolderPath(newParentId, newName)
      updateData.depth = newParentId ? (await this.getParentDepth(newParentId)) + 1 : 0
    }

    // Use transaction to update folder and descendant paths if necessary
    return this.getTx(async (tx) => {
      const [updatedFolder] = await tx
        .update(schema.Folder)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(schema.Folder.id, id))
        .returning()

      // Update descendant paths if path changed
      if (updateData.path && updateData.path !== existing.path) {
        await this.updateDescendantPaths(id, updateData.path, tx, existing.path || undefined)
      }

      return updatedFolder
    })
  }

  /**
   * Enhanced delete with cascading to subfolders and files
   * Soft deletes a folder and all its descendant folders and files
   * @param id - The folder ID to delete
   * @throws Error if folder not found
   */
  async delete(id: string): Promise<void> {
    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    await this.getTx(async (tx) => {
      // Soft delete all descendant folders
      await tx
        .update(schema.Folder)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.Folder.organizationId, folder.organizationId),
            ilike(schema.Folder.path, `${this.pathPrefix(folder.path)}%`),
            isNull(schema.Folder.deletedAt)
          )
        )

      // Soft delete all files in this folder and subfolders
      await tx
        .update(schema.FolderFile)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.FolderFile.organizationId, folder.organizationId),
            ilike(schema.FolderFile.path, `${folder.path || '/'}%`),
            isNull(schema.FolderFile.deletedAt)
          )
        )

      // Soft delete the folder itself
      await tx
        .update(schema.Folder)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.Folder.id, id))
    })
  }

  /**
   * Restore a soft-deleted folder and its contents
   * Restores a soft-deleted folder and all its descendant folders and files
   * @param id - The folder ID to restore
   * @returns Restored folder
   * @throws Error if folder not found
   */
  async restore(id: string): Promise<Folder> {
    // Get folder including deleted ones
    const folder = await this.db.query.Folder.findFirst({
      where: (folders, { eq, and }) =>
        and(eq(folders.id, id), eq(folders.organizationId, this.organizationId!)),
    })

    if (!folder) {
      throw new Error('Folder not found')
    }

    if (!folder.deletedAt) {
      return folder // Already restored
    }

    return this.getTx(async (tx) => {
      // Restore the folder
      const [restoredFolder] = await tx
        .update(schema.Folder)
        .set({
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Folder.id, id))
        .returning()

      // Restore all descendant folders
      await tx
        .update(schema.Folder)
        .set({
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.Folder.organizationId, folder.organizationId),
            ilike(schema.Folder.path, `${this.pathPrefix(folder.path)}%`),
            sql`${schema.Folder.deletedAt} IS NOT NULL`
          )
        )

      // Restore all files in this folder and subfolders
      await tx
        .update(schema.FolderFile)
        .set({
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.FolderFile.organizationId, folder.organizationId),
            ilike(schema.FolderFile.path, `${folder.path || '/'}%`),
            sql`${schema.FolderFile.deletedAt} IS NOT NULL`
          )
        )

      return restoredFolder
    })
  }

  /**
   * Permanently delete a folder and all its contents
   * Permanently removes a folder and all its descendant folders and files from the database
   * @param id - The folder ID to permanently delete
   * @throws Error if folder not found
   */
  async permanentDelete(id: string): Promise<void> {
    const folder = await this.db.query.Folder.findFirst({
      where: (folders, { eq, and }) =>
        and(eq(folders.id, id), eq(folders.organizationId, this.organizationId!)),
    })

    if (!folder) {
      throw new Error('Folder not found')
    }

    await this.getTx(async (tx) => {
      // Delete all files in descendant folders
      await tx
        .delete(schema.FolderFile)
        .where(
          and(
            eq(schema.FolderFile.organizationId, folder.organizationId),
            ilike(schema.FolderFile.path, `${folder.path || '/'}%`)
          )
        )

      // Delete all descendant folders
      await tx
        .delete(schema.Folder)
        .where(
          and(
            eq(schema.Folder.organizationId, folder.organizationId),
            ilike(schema.Folder.path, `${this.pathPrefix(folder.path)}%`)
          )
        )

      // Delete the folder itself
      await tx.delete(schema.Folder).where(eq(schema.Folder.id, id))
    })
  }

  // ============= Hierarchy Management =============

  /**
   * Get the complete folder tree for an organization
   * Returns a hierarchical tree structure of all folders
   * @returns Array of root folder tree nodes with nested children
   */
  async getFolderTree(): Promise<FolderTreeNode[]> {
    const folders = await this.db.query.Folder.findMany({
      where: this.buildBaseWhereClause(),
      with: {
        files: {
          where: (files, { isNull }) => isNull(files.deletedAt),
        },
        children: {
          where: (children, { isNull }) => isNull(children.deletedAt),
        },
      },
      orderBy: (folders, { asc }) => [asc(folders.depth), asc(folders.name)],
    })

    return this.buildTree(folders)
  }

  /**
   * Get immediate subfolders of a parent folder
   * @param parentId - The parent folder ID, or null for root folders
   * @returns Array of direct child folders
   */
  async getSubfolders(parentId: string | null): Promise<Folder[]> {
    const conditions = parentId
      ? [eq(schema.Folder.parentId, parentId)]
      : [isNull(schema.Folder.parentId)]
    return this.db.query.Folder.findMany({
      where: this.buildBaseWhereClause(conditions),
      orderBy: (folders, { asc }) => [asc(folders.name)],
    })
  }

  /**
   * Get the full path string for a folder
   * @param id - The folder ID
   * @returns The full path string for the folder
   * @throws Error if folder not found
   */
  async getFolderPath(id: string): Promise<string> {
    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }
    return folder.path ?? '/'
  }

  /**
   * Move a folder to a new parent with path updates
   * @param id - The folder ID to move
   * @param newParentId - The new parent folder ID, or null for root level
   * @returns Updated folder
   * @throws Error if circular reference detected, folder not found, or name conflicts
   */
  async moveToParent(id: string, newParentId: string | null): Promise<Folder> {
    // Normalize newParentId: convert 'root' string to null for root directory
    const normalizedNewParentId = newParentId === 'root' ? null : newParentId

    // Prevent circular references
    if (
      normalizedNewParentId &&
      (await this.wouldCreateCircularReference(id, normalizedNewParentId))
    ) {
      throw new Error('Move would create circular reference')
    }

    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    // Validate new parent exists
    if (normalizedNewParentId) {
      const newParent = await this.get(normalizedNewParentId)
      if (!newParent) {
        throw new Error('Target parent folder not found')
      }
    }

    // Check for name conflicts in new parent
    const conflict = await this.findByNameAndParent(folder.name, normalizedNewParentId)
    if (conflict && conflict.id !== id) {
      throw new Error('A folder with this name already exists in the target parent')
    }

    return this.update(id, { parentId: normalizedNewParentId! })
  }

  /**
   * Alias for moveToParent to maintain consistent interface with file service
   * @param id - Folder ID to move
   * @param newParentId - Target parent folder ID (null for root)
   * @returns Promise that resolves to the updated folder
   */
  async move(id: string, newParentId: string | null): Promise<Folder> {
    return this.moveToParent(id, newParentId)
  }

  /**
   * Get all ancestor folders of a folder
   * Returns the complete chain of parent folders from root to the folder's immediate parent
   * @param id - The folder ID
   * @returns Array of ancestor folders ordered from root to immediate parent
   */
  async getAncestors(id: string): Promise<Folder[]> {
    const folder = await this.get(id)
    if (!folder || !folder.parentId) {
      return []
    }

    const ancestors: Folder[] = []
    let currentId: string | null = folder.parentId

    while (currentId) {
      const ancestor = await this.get(currentId)
      if (!ancestor) break

      ancestors.unshift(ancestor) // Add to beginning for correct order
      currentId = ancestor.parentId
    }

    return ancestors
  }

  /**
   * Get all descendant folders of a folder
   * Returns all subfolders at any depth within the folder hierarchy
   * @param id - The folder ID
   * @returns Array of descendant folders ordered by path
   * @throws Error if folder not found
   */
  async getDescendants(id: string): Promise<Folder[]> {
    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    return this.db.query.Folder.findMany({
      where: (folders, { and, ilike }) =>
        and(this.buildBaseWhereClause(), ilike(folders.path, `${this.pathPrefix(folder.path)}%`)),
      orderBy: (folders, { asc }) => [asc(folders.path)],
    })
  }

  /**
   * Check if one folder is an ancestor of another
   * @param ancestorId - The potential ancestor folder ID
   * @param descendantId - The potential descendant folder ID
   * @returns True if ancestorId is an ancestor of descendantId, false otherwise
   */
  async isAncestor(ancestorId: string, descendantId: string): Promise<boolean> {
    if (ancestorId === descendantId) {
      return false // Folder cannot be ancestor of itself
    }

    const [ancestor, descendant] = await Promise.all([this.get(ancestorId), this.get(descendantId)])

    if (!ancestor || !descendant) {
      return false
    }

    return descendant.path?.startsWith(this.pathPrefix(ancestor.path)) || false
  }

  // ============= Folder Content =============

  /**
   * Get complete contents of a folder (subfolders + files)
   * @param id - The folder ID
   * @returns Complete folder contents including subfolders, files, counts, and total size
   * @throws Error if folder not found
   */
  async getContents(id: string): Promise<FolderContents> {
    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    const [subfolders, files] = await Promise.all([
      this.getSubfolders(id),
      this.db.query.FolderFile.findMany({
        where: (files, { eq, and, isNull }) =>
          and(
            eq(files.folderId, id),
            eq(files.organizationId, this.organizationId!),
            isNull(files.deletedAt)
          ),
        orderBy: (files, { asc }) => [asc(files.name)],
      }),
    ])

    const totalSize = files.reduce((sum, file) => {
      return sum + (file.size || BigInt(0))
    }, BigInt(0))

    return {
      folder,
      subfolders,
      files,
      totalFiles: files.length,
      totalSize,
    }
  }

  /**
   * Get total size of all files in a folder (recursive)
   * Calculates the total size of all files in the folder and its subfolders
   * @param id - The folder ID
   * @returns Total size in bytes as bigint
   * @throws Error if folder not found
   */
  async getFolderSize(id: string): Promise<bigint> {
    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    const result = await this.db
      .select({ totalSize: sum(schema.FolderFile.size) })
      .from(schema.FolderFile)
      .where(
        and(
          eq(schema.FolderFile.organizationId, this.organizationId!),
          ilike(schema.FolderFile.path, `${folder.path || '/'}%`),
          isNull(schema.FolderFile.deletedAt)
        )
      )

    return BigInt(result[0]?.totalSize ?? BigInt(0))
  }

  /**
   * Get total count of files in a folder (recursive)
   * Counts all files in the folder and its subfolders
   * @param id - The folder ID
   * @returns Total number of files
   * @throws Error if folder not found
   */
  async getDeepFileCount(id: string): Promise<number> {
    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    const result = await this.db
      .select({ count: count() })
      .from(schema.FolderFile)
      .where(
        and(
          eq(schema.FolderFile.organizationId, this.organizationId!),
          ilike(schema.FolderFile.path, `${folder.path || '/'}%`),
          isNull(schema.FolderFile.deletedAt)
        )
      )

    return result[0]?.count ?? 0
  }

  /**
   * Get count of immediate files in a folder
   * Counts only direct files, not in subfolders
   * @param id - The folder ID
   * @returns Number of direct files in the folder
   */
  async getDirectFileCount(id: string): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(schema.FolderFile)
      .where(
        and(
          eq(schema.FolderFile.folderId, id),
          eq(schema.FolderFile.organizationId, this.organizationId!),
          isNull(schema.FolderFile.deletedAt)
        )
      )

    return result[0]?.count ?? 0
  }

  /**
   * Get count of immediate subfolders
   * Counts only direct child folders, not nested ones
   * @param id - The folder ID
   * @returns Number of direct subfolders
   */
  async getSubfolderCount(id: string): Promise<number> {
    const conditions = [eq(schema.Folder.parentId, id)]
    const result = await this.db
      .select({ count: count() })
      .from(schema.Folder)
      .where(this.buildBaseWhereClause(conditions))

    return result[0]?.count ?? 0
  }

  // ============= Folder Operations =============

  /**
   * Copy a folder and all its contents to a new parent
   * Creates a complete copy of the folder with all subfolders and files
   * @param sourceId - The source folder ID to copy
   * @param targetParentId - The target parent folder ID, or null for root level
   * @param newName - Optional new name for the copied folder
   * @returns The newly created folder copy
   * @throws Error if source not found, target parent not found, or name conflicts
   */
  async copy(sourceId: string, targetParentId: string | null, newName?: string): Promise<Folder> {
    const sourceFolder = await this.getWithRelations(sourceId)
    if (!sourceFolder) {
      throw new Error('Source folder not found')
    }

    // Validate target parent if specified
    if (targetParentId) {
      const targetParent = await this.get(targetParentId)
      if (!targetParent) {
        throw new Error('Target parent folder not found')
      }
    }

    const folderName = newName || `Copy of ${(sourceFolder as any).name}`

    // Check for name conflicts
    const conflict = await this.findByNameAndParent(folderName, targetParentId)
    if (conflict) {
      throw new Error('A folder with this name already exists in the target parent')
    }

    return this.getTx(async (tx) => {
      // Create new folder
      const newFolder = await this.create(
        {
          name: folderName,
          parentId: targetParentId!,
          organizationId: (sourceFolder as any).organizationId,
          createdById: this.requireUserId(),
        },
        tx
      )

      // Copy all subfolders and files recursively
      await this.copyFolderContents(sourceFolder, newFolder.id, tx)

      return newFolder
    })
  }

  /**
   * Rename a folder with path updates
   * Updates the folder name and recalculates all descendant paths
   * @param id - The folder ID to rename
   * @param newName - The new folder name
   * @returns Updated folder
   * @throws Error if folder not found, name is empty, or name conflicts
   */
  async rename(id: string, newName: string): Promise<Folder> {
    if (!newName || newName.trim().length === 0) {
      throw new Error('Folder name cannot be empty')
    }

    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    // Check for name conflicts
    const conflict = await this.findByNameAndParent(newName, folder.parentId)
    if (conflict && conflict.id !== id) {
      throw new Error('A folder with this name already exists in the parent folder')
    }

    return this.update(id, { name: newName })
  }

  /**
   * Merge two folders (move all contents from source to target)
   * Moves all files and subfolders from source to target, then deletes source
   * @param sourceId - The source folder ID to merge from
   * @param targetId - The target folder ID to merge into
   * @throws Error if folders not found or attempting to merge folder with itself
   */
  async merge(sourceId: string, targetId: string): Promise<void> {
    if (sourceId === targetId) {
      throw new Error('Cannot merge folder with itself')
    }

    const [sourceFolder, targetFolder] = await Promise.all([
      this.getWithRelations(sourceId),
      this.get(targetId),
    ])

    if (!sourceFolder || !targetFolder) {
      throw new Error('Source or target folder not found')
    }

    await this.getTx(async (tx) => {
      // Get all files in source folder
      const filesToMove = await tx.query.FolderFile.findMany({
        where: (files, { eq, and, isNull }) =>
          and(eq(files.folderId, sourceId), isNull(files.deletedAt)),
      })

      // Update each file individually with proper path recalculation
      for (const file of filesToMove) {
        const newPath = this.pathJoin(targetFolder.path, file.name)
        await tx
          .update(schema.FolderFile)
          .set({
            folderId: targetId,
            path: newPath,
            updatedAt: new Date(),
          })
          .where(eq(schema.FolderFile.id, file.id))
      }

      // Get all immediate subfolders in source folder
      const subfoldersToMove = await tx.query.Folder.findMany({
        where: (folders, { eq, and, isNull }) =>
          and(eq(folders.parentId, sourceId), isNull(folders.deletedAt)),
      })

      // Update each subfolder with proper path recalculation
      for (const subfolder of subfoldersToMove) {
        const newPath = this.pathJoin(targetFolder.path, subfolder.name)
        const newDepth = targetFolder.depth + 1

        await tx
          .update(schema.Folder)
          .set({
            parentId: targetId,
            path: newPath,
            depth: newDepth,
            updatedAt: new Date(),
          })
          .where(eq(schema.Folder.id, subfolder.id))

        // Update all descendant paths recursively
        await this.updateDescendantPaths(subfolder.id, newPath, tx, subfolder.path || undefined)
      }

      // Delete the empty source folder
      await tx
        .update(schema.Folder)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.Folder.id, sourceId))
    })
  }

  // ============= Validation & Utilities =============

  /**
   * Check if folder name is valid and unique within parent
   * Validates name format and checks for uniqueness within the parent folder
   * @param name - The folder name to validate
   * @param parentId - The parent folder ID, or null for root level
   * @param excludeId - Optional folder ID to exclude from uniqueness check
   * @returns True if name is valid and unique, false otherwise
   */
  async validateName(name: string, parentId: string | null, excludeId?: string): Promise<boolean> {
    // Basic name validation
    if (!name || name.trim().length === 0) {
      return false
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(name)) {
      return false
    }

    // Check for uniqueness
    const existing = await this.findByNameAndParent(name, parentId)
    return !existing || existing.id === excludeId
  }

  /**
   * Ensure a folder path exists, creating folders as needed
   * Creates all necessary folders in the path if they don't exist
   * @param path - The folder path to ensure (e.g., 'Documents/Projects/MyProject')
   * @param userId - Optional user ID for folder creation
   * @returns The final folder in the path
   * @throws Error if path is invalid or folder creation fails
   */
  async ensurePath(path: string, userId?: string): Promise<Folder> {
    const pathParts = path.split('/').filter((part) => part.length > 0)

    if (pathParts.length === 0) {
      throw new Error('Invalid path')
    }

    let currentParentId: string | null = null
    let currentFolder: Folder | null = null

    for (const folderName of pathParts) {
      // Check if folder already exists
      const existing = await this.findByNameAndParent(folderName, currentParentId)

      if (existing) {
        currentFolder = existing
        currentParentId = existing.id
      } else {
        // Create the folder
        currentFolder = await this.create({
          name: folderName,
          parentId: currentParentId!,
          organizationId: this.requireOrganization(),
          createdById: userId || this.requireUserId(),
        })
        currentParentId = currentFolder.id
      }
    }

    if (!currentFolder) {
      throw new Error('Failed to create path')
    }

    return currentFolder
  }

  /**
   * Compute the full path string for a folder
   * Static utility method to get the path from a folder object
   * @param folder - The folder object
   * @returns The full path string
   */
  static computePath(folder: Folder): string {
    return folder.path || '/'
  }

  /**
   * Enhanced validation for folder creation data
   * Performs comprehensive validation including base validation and folder-specific checks
   * @param data - The folder creation data to validate
   * @returns Validation result with errors and warnings
   */
  async validate(data: CreateFolderRequest): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Call base validation
    const baseValidation = await super.validate(data)
    errors.push(...baseValidation.errors)
    warnings.push(...baseValidation.warnings)

    // Folder-specific validation
    if (!data.name || data.name.trim().length === 0) {
      errors.push('Folder name is required')
    } else {
      // Check name validity
      if (!(await this.validateName(data.name, data.parentId!))) {
        errors.push('Invalid folder name or name already exists')
      }
    }

    // Validate parent folder
    if (data.parentId) {
      const parent = await this.get(data.parentId)
      if (!parent) {
        errors.push('Parent folder not found')
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Check for circular references in folder hierarchy
   * Validates that moving a folder wouldn't create a circular reference
   * @param folderId - The folder ID to check
   * @param newParentId - The potential new parent folder ID
   * @returns True if circular reference would be created, false otherwise
   */
  async checkCircularReference(folderId: string, newParentId: string): Promise<boolean> {
    return this.wouldCreateCircularReference(folderId, newParentId)
  }

  // ============= Search & Query =============

  /**
   * Enhanced search folders with relevance scoring
   * Searches folders by name and path with relevance-based ranking
   * @param query - The search query string
   * @param options - Optional search configuration (limit, offset, date filters)
   * @returns Array of search results with relevance scores and matched fields
   */
  async search(query: string, options?: SearchOptions): Promise<FolderSearchResult[]> {
    const filters: SQL[] = []

    // Build search filters
    filters.push(sql`(
      LOWER(${schema.Folder.name}) = LOWER(${query}) OR
      LOWER(${schema.Folder.name}) LIKE LOWER(${'%' + query + '%'}) OR
      LOWER(${schema.Folder.path}) LIKE LOWER(${'%' + query + '%'})
    )`)

    // Add date filters if provided
    if (options?.dateLimits?.createdAfter) {
      filters.push(gte(schema.Folder.createdAt, options.dateLimits.createdAfter))
    }
    if (options?.dateLimits?.createdBefore) {
      filters.push(lte(schema.Folder.createdAt, options.dateLimits.createdBefore))
    }

    // Build final where clause with base conditions
    const whereClause = this.buildBaseWhereClause(filters)

    const results = await this.db.query.Folder.findMany({
      where: whereClause,
      with: {
        files: {
          where: (files, { isNull }) => isNull(files.deletedAt),
        },
        children: {
          where: (children, { isNull }) => isNull(children.deletedAt),
        },
      },
      limit: options?.limit || 50,
      offset: options?.offset || 0,
      orderBy: (folders, { desc }) => [desc(folders.updatedAt)],
    })

    // Calculate relevance scores
    return results
      .map((folder): FolderSearchResult => {
        let relevance = 0
        const matchedFields: string[] = []

        // Exact name match
        if (folder.name.toLowerCase() === query.toLowerCase()) {
          relevance += 10
          matchedFields.push('name')
        }
        // Name contains query
        else if (folder.name.toLowerCase().includes(query.toLowerCase())) {
          relevance += 5
          matchedFields.push('name')
        }

        // Path contains query
        if (folder.path?.toLowerCase().includes(query.toLowerCase())) {
          relevance += 3
          matchedFields.push('path')
        }

        return {
          folder,
          relevance: Math.max(relevance, 1),
          matchedFields,
          snippet: this.generateSearchSnippet(folder, query),
        }
      })
      .sort((a, b) => b.relevance - a.relevance)
  }

  /**
   * Find folders by path pattern
   * Searches for folders whose path contains the specified pattern
   * @param pattern - The path pattern to search for
   * @returns Array of matching folders ordered by path
   */
  async findByPathPattern(pattern: string): Promise<Folder[]> {
    return this.db.query.Folder.findMany({
      where: (folders, { and, ilike }) =>
        and(this.buildBaseWhereClause(), ilike(folders.path, `%${pattern}%`)),
      orderBy: (folders, { asc }) => [asc(folders.path)],
    })
  }

  /**
   * Get folders created by a specific user
   * @param userId - The user ID to filter by
   * @returns Array of folders created by the user, ordered by creation date (newest first)
   */
  async getByCreator(userId: string): Promise<Folder[]> {
    const conditions = [eq(schema.Folder.createdById, userId)]
    return this.db.query.Folder.findMany({
      where: this.buildBaseWhereClause(conditions),
      orderBy: (folders, { desc }) => [desc(folders.createdAt)],
    })
  }

  /**
   * Get recently created folders
   * @param limit - Maximum number of folders to return (default: 20)
   * @returns Array of recently created folders ordered by creation date (newest first)
   */
  async getRecent(limit = 20): Promise<Folder[]> {
    return this.db.query.Folder.findMany({
      where: this.buildBaseWhereClause(),
      orderBy: (folders, { desc }) => [desc(folders.createdAt)],
      limit: limit,
    })
  }

  // ============= Statistics & Analytics =============

  /**
   * Get detailed folder statistics for organization
   * Provides comprehensive analytics about folder usage and structure
   * @returns Object containing folder statistics including counts, depth, and averages
   */
  async getFolderStats(): Promise<{
    totalFolders: number
    maxDepth: number
    averageFilesPerFolder: number
    emptyFolders: number
  }> {
    const where = this.buildBaseWhereClause()

    const [totalFoldersResult, maxDepthResult, fileCountResult, emptyFoldersResult] =
      await Promise.all([
        this.db.select({ count: count() }).from(schema.Folder).where(where),
        this.db
          .select({ maxDepth: max(schema.Folder.depth) })
          .from(schema.Folder)
          .where(where),
        this.db
          .select({
            folderId: schema.FolderFile.folderId,
            count: count(schema.FolderFile.id),
          })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.organizationId, this.organizationId!),
              isNull(schema.FolderFile.deletedAt)
            )
          )
          .groupBy(schema.FolderFile.folderId),
        // For empty folders, we need to use a subquery approach
        this.db
          .select({ count: count() })
          .from(schema.Folder)
          .where(
            and(
              where,
              sql`NOT EXISTS (
            SELECT 1 FROM ${schema.FolderFile}
            WHERE ${schema.FolderFile.folderId} = ${schema.Folder.id}
            AND ${schema.FolderFile.deletedAt} IS NULL
          )`,
              sql`NOT EXISTS (
            SELECT 1 FROM ${schema.Folder} children
            WHERE children.parent_id = ${schema.Folder.id}
            AND children.deleted_at IS NULL
          )`
            )
          ),
      ])

    const totalFolders = totalFoldersResult[0]?.count ?? 0

    const averageFilesPerFolder =
      fileCountResult.length > 0
        ? fileCountResult.reduce((sum, group) => sum + (group.count || 0), 0) /
          fileCountResult.length
        : 0

    return {
      totalFolders,
      maxDepth: maxDepthResult[0]?.maxDepth || 0,
      averageFilesPerFolder,
      emptyFolders: emptyFoldersResult[0]?.count ?? 0,
    }
  }

  /**
   * Get folder usage analytics
   * Provides detailed usage information for a specific folder
   * @param id - The folder ID to analyze
   * @returns Usage analytics including file count, size, activity, and most active subfolder
   * @throws Error if folder not found
   */
  async getUsage(id: string): Promise<{
    fileCount: number
    totalSize: bigint
    lastActivity: Date | null
    mostActiveSubfolder: { id: string; name: string } | null
  }> {
    const folder = await this.get(id)
    if (!folder) {
      throw new Error('Folder not found')
    }

    const [fileCount, totalSize, lastActivityResult] = await Promise.all([
      this.getDeepFileCount(id),
      this.getFolderSize(id),
      this.db.query.FolderFile.findFirst({
        where: (files, { eq, and, isNull, ilike }) =>
          and(
            eq(files.organizationId, this.organizationId!),
            ilike(files.path, `${folder.path || '/'}%`),
            isNull(files.deletedAt)
          ),
        orderBy: (files, { desc }) => [desc(files.updatedAt)],
        columns: { updatedAt: true },
      }),
    ])

    // Find most active subfolder (most recently updated files)
    const mostActiveResult = await this.db.query.Folder.findFirst({
      where: (folders, { eq, and, isNull }) =>
        and(eq(folders.parentId, id), isNull(folders.deletedAt)),
      with: {
        files: {
          where: (files, { isNull }) => isNull(files.deletedAt),
          orderBy: (files, { desc }) => [desc(files.updatedAt)],
          limit: 1,
          columns: { updatedAt: true },
        },
      },
      orderBy: (folders, { desc }) => [desc(folders.name)], // Simplified ordering since file count ordering is complex in Drizzle
    })

    return {
      fileCount,
      totalSize,
      lastActivity: lastActivityResult?.updatedAt || null,
      mostActiveSubfolder: mostActiveResult
        ? { id: mostActiveResult.id, name: mostActiveResult.name }
        : null,
    }
  }

  // ============= Maintenance Operations =============

  /**
   * Rebuild folder paths after hierarchy changes
   * Maintenance operation to fix inconsistent folder paths and depths
   * @returns Number of folders that were updated
   */
  async rebuildPaths(): Promise<number> {
    const folders = await this.db.query.Folder.findMany({
      where: this.buildBaseWhereClause(),
      orderBy: (folders, { asc }) => [asc(folders.depth)],
    })

    let updatedCount = 0

    for (const folder of folders) {
      const correctPath = await this.computeNewFolderPath(folder.parentId, folder.name)
      const correctDepth = folder.parentId ? (await this.getParentDepth(folder.parentId)) + 1 : 0

      if (folder.path !== correctPath || folder.depth !== correctDepth) {
        await this.db
          .update(schema.Folder)
          .set({
            path: correctPath,
            depth: correctDepth,
            updatedAt: new Date(),
          })
          .where(eq(schema.Folder.id, folder.id))
        updatedCount++
      }
    }

    return updatedCount
  }

  /**
   * Clean up empty folders
   * Maintenance operation to soft-delete folders that contain no files or subfolders
   * @returns Number of empty folders that were deleted
   */
  async cleanupEmpty(): Promise<number> {
    const emptyFolders = await this.db
      .select()
      .from(schema.Folder)
      .where(
        and(
          this.buildBaseWhereClause(),
          sql`NOT EXISTS (
          SELECT 1 FROM ${schema.FolderFile}
          WHERE ${schema.FolderFile.folderId} = ${schema.Folder.id}
          AND ${schema.FolderFile.deletedAt} IS NULL
        )`,
          sql`NOT EXISTS (
          SELECT 1 FROM ${schema.Folder} children
          WHERE children.parent_id = ${schema.Folder.id}
          AND children.deleted_at IS NULL
        )`
        )
      )

    if (emptyFolders.length === 0) {
      return 0
    }

    await this.db
      .update(schema.Folder)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        inArray(
          schema.Folder.id,
          emptyFolders.map((f) => f.id)
        )
      )

    return emptyFolders.length
  }

  /**
   * Fix folder depth calculations
   * Maintenance operation to correct folder depth values based on hierarchy
   * @returns Number of folders that had their depth corrected
   */
  async fixDepths(): Promise<number> {
    const folders = await this.db.query.Folder.findMany({
      where: this.buildBaseWhereClause(),
      orderBy: (folders, { asc }) => [asc(folders.depth)],
    })

    let fixedCount = 0

    for (const folder of folders) {
      const correctDepth = folder.parentId ? (await this.getParentDepth(folder.parentId)) + 1 : 0

      if (folder.depth !== correctDepth) {
        await this.db
          .update(schema.Folder)
          .set({
            depth: correctDepth,
            updatedAt: new Date(),
          })
          .where(eq(schema.Folder.id, folder.id))
        fixedCount++
      }
    }

    return fixedCount
  }

  // ============= Helper Methods =============

  /**
   * Safely join path components, handling root folder edge cases
   * Combines parent path and folder name into a valid path string
   * @param parentPath - The parent folder path (may be null, undefined, or '/')
   * @param name - The folder name to append
   * @returns The combined path string with proper formatting
   */
  private pathJoin(parentPath: string | null | undefined, name: string): string {
    const parts = [parentPath === '/' || !parentPath ? '' : parentPath, name]
      .join('/')
      .replace(/\/+/g, '/')
    return parts.startsWith('/') ? parts : `/${parts}`
  }

  /**
   * Generate consistent path prefix for startsWith operations
   * Ensures path ends with '/' for proper prefix matching
   * @param p - The path to convert to a prefix
   * @returns The path with trailing slash for prefix operations
   */
  private pathPrefix(p?: string | null): string {
    if (!p || p === '/') return '/'
    return `${p}/`
  }

  /**
   * Escape special regex characters for safe string replacement
   * Prevents regex injection by escaping special characters
   * @param s - The string to escape
   * @returns The escaped string safe for regex use
   */
  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Build folder tree from flat list
   * Converts a flat array of folders into a hierarchical tree structure
   * @param folders - Array of folder objects with counts
   * @returns Array of root folder tree nodes with nested children
   */
  private buildTree(folders: any[]): FolderTreeNode[] {
    // Create a map of nodes (not raw folders)
    const nodeMap = new Map<string, FolderTreeNode>()
    const rootFolders: FolderTreeNode[] = []

    // First pass: create all nodes
    folders.forEach((folder) => {
      const node: FolderTreeNode = {
        id: folder.id,
        name: folder.name,
        path: folder.path || '/',
        depth: folder.depth,
        parentId: folder.parentId,
        children: [],
        fileCount: folder._count?.files || 0,
        totalSize: 0, // Would need separate calculation
      }
      nodeMap.set(folder.id, node)
    })

    // Second pass: build parent-child relationships
    folders.forEach((folder) => {
      const node = nodeMap.get(folder.id)
      if (!node) return

      if (!folder.parentId) {
        rootFolders.push(node)
      } else {
        const parentNode = nodeMap.get(folder.parentId)
        if (parentNode) {
          parentNode.children.push(node)
        }
      }
    })

    return rootFolders
  }

  /**
   * Check if move would create circular reference
   * Uses path-based checking to detect circular references efficiently
   * @param folderId - The folder ID being moved
   * @param newParentId - The potential new parent folder ID
   * @returns True if move would create circular reference, false otherwise
   */
  private async wouldCreateCircularReference(
    folderId: string,
    newParentId: string
  ): Promise<boolean> {
    // Early check: folder cannot be its own parent
    if (folderId === newParentId) {
      return true
    }

    // Get folder and potential new parent
    const [folder, newParent] = await Promise.all([this.get(folderId), this.get(newParentId)])

    if (!folder || !newParent) {
      return false
    }

    // Use path-based check: new parent cannot be a descendant of the folder
    // If new parent's path starts with folder's path, it's a descendant
    return newParent.path?.startsWith(this.pathPrefix(folder.path)) || false
  }

  /**
   * Compute new folder path
   * Calculates the full path for a folder based on its parent and name
   * @param parentId - The parent folder ID (may be null for root level)
   * @param name - The folder name
   * @returns The computed full path string
   * @throws Error if parent folder not found
   */
  private async computeNewFolderPath(parentId: Nullish<string>, name: string): Promise<string> {
    if (!parentId) return this.pathJoin('/', name)
    const parent = await this.get(parentId)
    if (!parent) throw new Error('Parent folder not found')
    return this.pathJoin(parent.path, name)
  }

  /**
   * Get parent folder depth
   * Retrieves the depth value of a parent folder
   * @param parentId - The parent folder ID
   * @returns The parent folder's depth, or 0 if not found
   */
  private async getParentDepth(parentId: string): Promise<number> {
    const parent = await this.get(parentId)
    return parent?.depth || 0
  }

  /**
   * Find folder by name and parent
   * Searches for a folder with the given name under the specified parent
   * @param name - The folder name to search for
   * @param parentId - The parent folder ID (may be null for root level)
   * @returns The matching folder or null if not found
   */
  private async findByNameAndParent(
    name: string,
    parentId: Nullish<string>
  ): Promise<Folder | null> {
    const conditions = [
      eq(schema.Folder.name, name),
      parentId ? eq(schema.Folder.parentId, parentId) : isNull(schema.Folder.parentId),
    ]
    return this.db.query.Folder.findFirst({
      where: this.buildBaseWhereClause(conditions),
    })
  }

  /**
   * Update descendant paths recursively
   * Updates all descendant folder and file paths when a folder is moved or renamed
   * @param folderId - The folder ID whose descendants need updating
   * @param newBasePath - The new base path for the folder
   * @param tx - Database transaction instance
   * @param oldBasePath - Optional old base path for more efficient querying
   */
  private async updateDescendantPaths(
    folderId: string,
    newBasePath: string,
    tx: any,
    oldBasePath?: string
  ): Promise<void> {
    // Get the old path to properly find descendants
    const folderToUpdate = oldBasePath
      ? { path: oldBasePath }
      : await tx.query.Folder.findFirst({
          where: (folders, { eq }) => eq(folders.id, folderId),
          columns: { path: true },
        })

    if (!folderToUpdate?.path) return

    const oldPath = folderToUpdate.path

    // Find descendants using the OLD path
    const descendants = await tx.query.Folder.findMany({
      where: (folders, { eq, and, isNull, ilike }) =>
        and(
          eq(folders.organizationId, this.organizationId!),
          ilike(folders.path, `${this.pathPrefix(oldPath)}%`),
          isNull(folders.deletedAt)
        ),
    })

    // Update each descendant's path
    for (const descendant of descendants) {
      if (!descendant.path) continue

      // Replace old path prefix with new path prefix using proper regex escaping
      const escapedOldPath = this.escapeRegExp(oldPath)
      const newPath = descendant.path.replace(new RegExp(`^${escapedOldPath}`), newBasePath)

      if (newPath !== descendant.path) {
        await tx
          .update(schema.Folder)
          .set({
            path: newPath,
            updatedAt: new Date(),
          })
          .where(eq(schema.Folder.id, descendant.id))

        // Update files in this descendant folder
        const files = await tx.query.FolderFile.findMany({
          where: (files, { eq, and, isNull }) =>
            and(eq(files.folderId, descendant.id), isNull(files.deletedAt)),
          columns: { id: true, path: true },
        })

        for (const f of files) {
          if (!f.path) continue
          const escapedOldPath = this.escapeRegExp(oldPath)
          const updatedFilePath = f.path.replace(new RegExp(`^${escapedOldPath}`), newBasePath)
          if (updatedFilePath !== f.path) {
            await tx
              .update(schema.FolderFile)
              .set({ path: updatedFilePath, updatedAt: new Date() })
              .where(eq(schema.FolderFile.id, f.id))
          }
        }
      }
    }
  }

  /**
   * Copy folder contents recursively
   * Copies all files and subfolders from source to target folder
   * @param sourceFolder - The source folder object with relations
   * @param targetFolderId - The target folder ID to copy into
   * @param tx - Database transaction instance
   */
  private async copyFolderContents(
    sourceFolder: any,
    targetFolderId: string,
    tx: any
  ): Promise<void> {
    // Get target folder for path calculations
    const targetFolder = await tx.query.Folder.findFirst({
      where: (folders, { eq }) => eq(folders.id, targetFolderId),
      columns: { path: true, depth: true },
    })

    if (!targetFolder) return

    // Copy all files from source folder
    const sourceFiles = await tx.query.FolderFile.findMany({
      where: (files, { eq, and, isNull }) =>
        and(eq(files.folderId, sourceFolder.id), isNull(files.deletedAt)),
    })

    for (const file of sourceFiles) {
      const newPath = this.pathJoin(targetFolder.path, file.name)
      const [newFile] = await tx
        .insert(schema.FolderFile)
        .values({
          name: file.name,
          path: newPath,
          ext: file.ext,
          mimeType: file.mimeType,
          size: file.size,
          organizationId: file.organizationId,
          folderId: targetFolderId,
          createdById: file.createdById,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      // Copy all versions using FileService
      const fileService = new FileService(this.organizationId, this.userId, this.db)
      await fileService.copyVersions(file.id, newFile.id)
    }

    // Copy all subfolders recursively
    const subfolders = await tx.query.Folder.findMany({
      where: (folders, { eq, and, isNull }) =>
        and(eq(folders.parentId, sourceFolder.id), isNull(folders.deletedAt)),
      with: {
        files: {
          where: (files, { isNull }) => isNull(files.deletedAt),
        },
      },
    })

    for (const subfolder of subfolders) {
      const newPath = this.pathJoin(targetFolder.path, subfolder.name)
      const newDepth = targetFolder.depth + 1

      const [newSubfolder] = await tx
        .insert(schema.Folder)
        .values({
          name: subfolder.name,
          parentId: targetFolderId,
          path: newPath,
          depth: newDepth,
          organizationId: subfolder.organizationId,
          createdById: subfolder.createdById,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      // Recursively copy contents of this subfolder
      await this.copyFolderContents(subfolder, newSubfolder.id, tx)
    }
  }

  /**
   * Generate search snippet for search results
   * Creates a descriptive snippet showing what matched in the search
   * @param folder - The folder object
   * @param query - The search query that was matched
   * @returns A formatted snippet string describing the match
   */
  private generateSearchSnippet(folder: Folder, query: string): string {
    const parts: string[] = []

    if (folder.name.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Name: ${folder.name}`)
    }

    if (folder.path?.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Path: ${folder.path}`)
    }

    return parts.join(' | ') || folder.name
  }
}

/**
 * Factory function for creating folder service instances
 * @param organizationId - Optional organization ID to scope operations to
 * @param userId - Optional user ID for created/updated records
 * @returns New FolderService instance
 */
export const createFolderService = (organizationId?: string, userId?: string) =>
  new FolderService(organizationId, userId)

/**
 * Singleton folder service instance with default database connection
 * Use this for operations that don't require specific organization/user scoping
 */
// export const folderService = new FolderService()
