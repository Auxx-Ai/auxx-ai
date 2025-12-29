// packages/lib/src/workflow-engine/types/file-reference.ts

/**
 * Source of the file - determines how to refresh/access URLs
 */
export type FileSource =
  | 'media-asset' // MediaAsset (versioned storage) - PRIMARY
  | 'folder-file' // FolderFile (user file system)
  | 'attachment' // Entity attachment
  | 'external-url' // External URL (no refresh possible)

/**
 * File reference - all file sources normalize to this type
 * Uses MediaAsset with version locking for workflow files
 */
export interface FileReference {
  // Identity
  id: string // Unique ID within workflow context
  assetId: string // MediaAsset ID
  versionId: string // MediaAssetVersion ID (locked at upload time)
  source: FileSource // Where file came from

  // Metadata (stable - from version)
  filename: string
  mimeType: string
  size: number

  // Access (may expire)
  url: string // Presigned URL
  urlExpiresAt: Date // When URL expires

  // Context
  nodeId: string // Node that produced this file
  uploadedAt?: Date // When uploaded (if applicable)
}

/**
 * Default URL expiration buffer in milliseconds (1 minute)
 */
const DEFAULT_EXPIRATION_BUFFER_MS = 60_000

/**
 * Check if URL is expired or expiring soon
 * @param ref - File reference to check
 * @param bufferMs - Buffer time in milliseconds before expiration (default 1 minute)
 */
export function isUrlExpired(ref: FileReference, bufferMs = DEFAULT_EXPIRATION_BUFFER_MS): boolean {
  return new Date(ref.urlExpiresAt).getTime() - bufferMs < Date.now()
}

/**
 * File content fetch options
 */
export interface FileContentOptions {
  asBase64?: boolean // Return base64 encoded
  asBuffer?: boolean // Return Buffer
  asStream?: boolean // Return ReadableStream
}

/**
 * Type guard to check if an object is a FileReference
 */
export function isFileReference(value: unknown): value is FileReference {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.assetId === 'string' &&
    typeof obj.versionId === 'string' &&
    typeof obj.source === 'string' &&
    typeof obj.filename === 'string' &&
    typeof obj.mimeType === 'string' &&
    typeof obj.size === 'number'
  )
}

/**
 * Legacy WorkflowFileData structure (for backwards compatibility)
 */
export interface LegacyWorkflowFileData {
  id: string
  fileId: string
  filename: string
  mimeType: string
  size: number
  url: string
  nodeId: string
  uploadedAt: Date
  expiresAt?: Date
}

/**
 * Type guard to check if an object is legacy WorkflowFileData
 */
export function isLegacyWorkflowFileData(value: unknown): value is LegacyWorkflowFileData {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.fileId === 'string' &&
    typeof obj.filename === 'string' &&
    !('assetId' in obj) // Legacy data doesn't have assetId
  )
}

/**
 * Convert legacy WorkflowFileData to FileReference
 * For backwards compatibility with older file data
 */
export function toFileReference(
  fileData: LegacyWorkflowFileData | (LegacyWorkflowFileData & { assetId?: string; versionId?: string }),
  source: FileSource = 'media-asset'
): FileReference {
  // If fileData already has assetId and versionId, use them
  const assetId = 'assetId' in fileData && fileData.assetId ? fileData.assetId : fileData.fileId
  const versionId =
    'versionId' in fileData && fileData.versionId ? fileData.versionId : fileData.fileId

  return {
    id: fileData.id,
    assetId,
    versionId,
    source,
    filename: fileData.filename,
    mimeType: fileData.mimeType,
    size: fileData.size,
    url: fileData.url,
    urlExpiresAt: fileData.expiresAt || new Date(Date.now() + 3600000), // Default 1 hour
    nodeId: fileData.nodeId,
    uploadedAt: fileData.uploadedAt,
  }
}

/**
 * Create a FileReference from upload completion data
 * Used when receiving file metadata from upload completion endpoints
 */
export function createFileReferenceFromUpload(data: {
  assetId: string
  versionId: string
  filename: string
  mimeType: string
  size: number
  url?: string
  nodeId: string
}): FileReference {
  return {
    id: data.assetId,
    assetId: data.assetId,
    versionId: data.versionId,
    source: 'media-asset',
    filename: data.filename,
    mimeType: data.mimeType,
    size: data.size,
    url: data.url || '',
    urlExpiresAt: new Date(Date.now() + 3600000), // Assume 1 hour from upload
    nodeId: data.nodeId,
    uploadedAt: new Date(),
  }
}
