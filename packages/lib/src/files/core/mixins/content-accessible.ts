// packages/lib/src/files/core/mixins/content-accessible.ts

import type { DownloadRef } from '../../adapters/base-adapter'

/**
 * Interface for entities that have content access capabilities.
 *
 * Implemented directly by `FileService` and `MediaAssetService`. The mixin factory that once
 * produced this behavior was Prisma-era (`db.<table>.findUnique`) and had no remaining callers
 * after the Drizzle migration, so it was removed rather than ported.
 */
export interface ContentAccessible {
  getContent(id: string): Promise<Buffer>
  getDownloadRef(id: string): Promise<DownloadRef>
  streamContent(id: string): Promise<NodeJS.ReadableStream>
  findByChecksum(checksum: string): Promise<any | null>
  getCurrentVersion(entityId: string): Promise<any>
}
