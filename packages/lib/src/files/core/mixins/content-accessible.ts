// packages/lib/src/files/core/mixins/content-accessible.ts

import { eq } from 'drizzle-orm'
import type { Constructor } from '../base-service'
import type { BaseService } from '../base-service'
import type { DownloadRef } from '../../adapters/base-adapter'

/**
 * Interface for entities that have content access capabilities
 */
export interface ContentAccessible {
  getContent(id: string): Promise<Buffer>
  getDownloadRef(id: string): Promise<DownloadRef>
  streamContent(id: string): Promise<NodeJS.ReadableStream>
  findByChecksum(checksum: string): Promise<any | null>
  getCurrentVersion(entityId: string): Promise<any>
}

/**
 * Mixin that adds content access capabilities to services
 * Used by FileService and MediaAssetService
 */
export function withContentAccess<T extends Constructor<BaseService<any, any, any, any, any>>>(
  Base: T
): T & Constructor<ContentAccessible> {
  return class ContentAccessibleMixin extends Base implements ContentAccessible {
    // Satisfy abstract method requirements
    protected getEntityName(): string {
      return super.getEntityName?.() || 'entity'
    }

    protected async processCreateData(data: any): Promise<any> {
      return super.processCreateData?.(data) || data
    }
    /**
     * Get the binary content of an entity
     */
    async getContent(id: string): Promise<Buffer> {
      const entity = await this.get(id)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      const storageManager = await this.getStorageManager()
      const currentVersion = await this.getCurrentVersion(id)

      if (!currentVersion || !currentVersion.storageLocationId) {
        throw new Error(`No storage location found for ${this.getEntityName()}`)
      }

      return storageManager.getContent(currentVersion.storageLocationId)
    }

    /**
     * Get a download URL for an entity
     */
    async getDownloadUrl(id: string): Promise<DownloadRef> {
      const entity = await this.get(id)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      const storageManager = await this.getStorageManager()
      const currentVersion = await this.getCurrentVersion(id)

      if (!currentVersion || !currentVersion.storageLocationId) {
        throw new Error(`No storage location found for ${this.getEntityName()}`)
      }

      return storageManager.getDownloadRef({
        locationId: currentVersion.storageLocationId,
      })
    }

    /**
     * Stream the content of an entity
     */
    async streamContent(id: string): Promise<NodeJS.ReadableStream> {
      const entity = await this.get(id)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
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
     */
    async findByChecksum(checksum: string): Promise<any | null> {
      const table: any = this.getEntitySchema()
      if (!table?.checksum) {
        throw new Error('findByChecksum not supported without checksum column')
      }

      const where = this.buildBaseWhereClause([eq(table.checksum, checksum)])
      if (!where) {
        return null
      }

      const rows = await (this.db as any)
        .select()
        .from(table)
        .where(where)
        .limit(1)

      return rows[0] ?? null
    }

    /**
     * Get the current version of an entity
     * Must be implemented by concrete services
     */
    async getCurrentVersion(entityId: string): Promise<any> {
      const entity = await this.get(entityId)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      // If entity has currentVersionId, fetch that version
      if ((entity as any).currentVersionId) {
        const versionTableName = this.getVersionTableName()
        return (this.db[versionTableName] as any).findUnique({
          where: { id: (entity as any).currentVersionId },
          include: {
            storageLocation: true,
          },
        })
      }

      // Otherwise, get the latest version
      const versionTableName = this.getVersionTableName()
      const entityIdField = this.getEntityIdFieldName()

      return (this.db[versionTableName] as any).findFirst({
        where: { [entityIdField]: entityId },
        orderBy: { versionNumber: 'desc' },
        include: {
          storageLocation: true,
        },
      })
    }

    // ============= Methods that must be implemented by concrete services =============

    /**
     * Get the storage manager instance
     */
    protected getStorageManager(): Promise<any> {
      throw new Error('getStorageManager must be implemented by concrete service')
    }

    /**
     * Get the version table name for this entity type
     */
    protected getVersionTableName(): keyof typeof this.db {
      throw new Error('getVersionTableName must be implemented by concrete service')
    }

    /**
     * Get the entity ID field name in the version table (e.g., 'fileId', 'assetId')
     */
    protected getEntityIdFieldName(): string {
      throw new Error('getEntityIdFieldName must be implemented by concrete service')
    }
  }
}
