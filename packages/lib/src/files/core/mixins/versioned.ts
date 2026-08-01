// packages/lib/src/files/core/mixins/versioned.ts

/**
 * Interface for entities that support versioning.
 *
 * Implemented directly by `FileService` and `MediaAssetService`. The mixin factory that once
 * produced this behavior was Prisma-era (`db.$transaction`, `tx.<table>.findFirst`) and had no
 * remaining callers after the Drizzle migration, so it was removed rather than ported.
 */
export interface Versioned {
  createVersion(entityId: string, storageLocationId: string, metadata?: any): Promise<any>
  getVersions(entityId: string): Promise<any[]>
  getVersion(entityId: string, versionNumber: number): Promise<any | null>
  restoreVersion(entityId: string, versionNumber: number): Promise<any>
  deleteVersion(entityId: string, versionNumber: number): Promise<void>
  getLatestVersion(entityId: string): Promise<any | null>
}
