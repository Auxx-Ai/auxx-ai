// packages/lib/src/files/upload/handlers/file.ts

import { ENTITY_TYPES } from '../../types/entities'
import { MB } from './shared'
import type { UploadHandler } from './types'

/**
 * Generic user files: the file library.
 *
 * The only handler that produces a `FolderFile` rather than a `MediaAsset`, and
 * the only one with no entity behind it — which is also why it is the only one
 * whose whole prepare path touches no database at all.
 */
export const fileHandler: UploadHandler = {
  entityType: ENTITY_TYPES.FILE,
  visibility: 'PRIVATE',
  // `FileProcessor` never clamped the base policy's permissive range, so a user
  // file has no server-side ceiling here. The org's storage quota is the real
  // limit and the route checks it before this runs.
  maxFileSize: Number.MAX_SAFE_INTEGER,
  allowedMimeTypes: ['*/*'],
  maxTtlSec: 60 * 60,
  multipartThresholdBytes: 100 * MB,
  persist: 'folder-file',
}
