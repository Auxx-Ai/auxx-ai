// packages/lib/src/files/core/mixins/versioned.ts

import type { BaseService, Constructor } from '../base-service'

/**
 * Interface for entities that support versioning
 */
export interface Versioned {
  createVersion(entityId: string, storageLocationId: string, metadata?: any): Promise<any>
  getVersions(entityId: string): Promise<any[]>
  getVersion(entityId: string, versionNumber: number): Promise<any | null>
  restoreVersion(entityId: string, versionNumber: number): Promise<any>
  deleteVersion(entityId: string, versionNumber: number): Promise<void>
  getLatestVersion(entityId: string): Promise<any | null>
}

/**
 * Mixin that adds versioning capabilities to services
 * Used by FileService and MediaAssetService
 */
export function withVersioning<T extends Constructor<BaseService<any, any, any, any, any>>>(
  Base: T
): T & Constructor<Versioned> {
  return class VersionedMixin extends Base implements Versioned {
    // Satisfy abstract method requirements
    protected getEntityName(): string {
      return super.getEntityName?.() || 'entity'
    }

    protected async processCreateData(data: any): Promise<any> {
      return super.processCreateData?.(data) || data
    }
    /**
     * Create a new version for an entity (concurrency-safe)
     */
    async createVersion(
      entityId: string,
      storageLocationId: string,
      metadata: any = {}
    ): Promise<any> {
      const entity = await this.get(entityId)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      const versionTableName = this.getVersionTableName()
      const entityIdField = this.getEntityIdFieldName()

      return this.db.$transaction(async (tx) => {
        // Get the next version number within transaction
        const lastVersion = await (tx[versionTableName] as any).findFirst({
          where: { [entityIdField]: entityId },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        })

        const versionNumber = (lastVersion?.versionNumber || 0) + 1

        // Get storage location details
        const storageLocation = await tx.storageLocation.findUnique({
          where: { id: storageLocationId },
        })

        if (!storageLocation) {
          throw new Error('Storage location not found')
        }

        // Create the new version
        const version = await (tx[versionTableName] as any).create({
          data: {
            [entityIdField]: entityId,
            versionNumber,
            storageLocationId,
            size: storageLocation.size,
            mimeType: storageLocation.mimeType,
            ...metadata,
          },
        })

        // Update the entity's current version reference
        await (tx[this.tableName] as any).update({
          where: { id: entityId },
          data: {
            currentVersionId: version.id,
          },
        })

        return version
      })
    }

    /**
     * Get all versions for an entity
     */
    async getVersions(entityId: string): Promise<any[]> {
      const entity = await this.get(entityId)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      const versionTableName = this.getVersionTableName()
      const entityIdField = this.getEntityIdFieldName()

      return (this.db[versionTableName] as any).findMany({
        where: { [entityIdField]: entityId },
        include: {
          storageLocation: true,
        },
        orderBy: { versionNumber: 'desc' },
      })
    }

    /**
     * Get a specific version by number
     */
    async getVersion(entityId: string, versionNumber: number): Promise<any | null> {
      const entity = await this.get(entityId)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      const versionTableName = this.getVersionTableName()
      const entityIdField = this.getEntityIdFieldName()

      return (this.db[versionTableName] as any).findFirst({
        where: {
          [entityIdField]: entityId,
          versionNumber,
        },
        include: {
          storageLocation: true,
        },
      })
    }

    /**
     * Restore an entity to a specific version
     */
    async restoreVersion(entityId: string, versionNumber: number): Promise<any> {
      const version = await this.getVersion(entityId, versionNumber)
      if (!version) {
        throw new Error(`Version ${versionNumber} not found for ${this.getEntityName()}`)
      }

      const entity = await (this.db[this.tableName] as any).update({
        where: { id: entityId },
        data: {
          currentVersionId: version.id,
          updatedAt: new Date(),
        },
      })

      return entity
    }

    /**
     * Delete a specific version (but not the current one)
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

      const versionTableName = this.getVersionTableName()

      await (this.db[versionTableName] as any).delete({
        where: { id: version.id },
      })
    }

    /**
     * Get the latest version for an entity
     */
    async getLatestVersion(entityId: string): Promise<any | null> {
      const versionTableName = this.getVersionTableName()
      const entityIdField = this.getEntityIdFieldName()

      return (this.db[versionTableName] as any).findFirst({
        where: { [entityIdField]: entityId },
        include: {
          storageLocation: true,
        },
        orderBy: { versionNumber: 'desc' },
      })
    }

    /**
     * Copy all versions from one entity to another
     */
    async copyVersions(sourceEntityId: string, targetEntityId: string): Promise<any[]> {
      const sourceVersions = await this.getVersions(sourceEntityId)
      const copiedVersions: any[] = []

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

    /**
     * Get version statistics for an entity
     */
    async getVersionStats(entityId: string): Promise<{
      totalVersions: number
      totalSize: bigint
      oldestVersion: Date | null
      newestVersion: Date | null
    }> {
      const versions = await this.getVersions(entityId)

      if (versions.length === 0) {
        return {
          totalVersions: 0,
          totalSize: BigInt(0),
          oldestVersion: null,
          newestVersion: null,
        }
      }

      const totalSize = versions.reduce((sum, version) => {
        return sum + (version.size || BigInt(0))
      }, BigInt(0))

      const dates = versions.map((v) => v.createdAt).sort()

      return {
        totalVersions: versions.length,
        totalSize,
        oldestVersion: dates[0] || null,
        newestVersion: dates[dates.length - 1] || null,
      }
    }

    // ============= Methods that must be implemented by concrete services =============

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
