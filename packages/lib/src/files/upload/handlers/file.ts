// packages/lib/src/files/upload/handlers/file.ts

import { UPLOAD_POLICIES } from '../../types/entities'
import type { UploadHandler } from './types'

/**
 * Generic user files: the file library.
 *
 * The only handler that produces a `FolderFile` rather than a `MediaAsset`, and
 * the only one with no entity behind it — which is also why it is the only one
 * whose whole prepare path touches no database at all.
 */
export const fileHandler: UploadHandler = {
  ...UPLOAD_POLICIES.FILE,
  visibility: 'PRIVATE',
  persist: 'folder-file',
}
