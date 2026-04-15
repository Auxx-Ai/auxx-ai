import type {
  AttachmentEntity as Attachment,
  FileVersionEntity as FileVersion,
  FolderEntity as Folder,
  FolderFileEntity as FolderFile,
  MediaAssetEntity as MediaAsset,
  MediaAssetVersionEntity as MediaAssetVersion,
  StorageLocationEntity as StorageLocation,
} from '@auxx/database/types'
// packages/lib/src/files/core/types.ts
// ============= Entity Types =============
export type Nullish<T> = T | null | undefined
/**
 * Application-level entity types for attachments
 * Stored as strings in database for flexibility
 */
export type EntityType =
  | 'MESSAGE'
  | 'COMMENT'
  | 'CUSTOM_FIELD_VALUE'
  | 'TASK'
  | 'ORDER'
  | 'PRODUCT'
  | 'TICKET'
  | 'ARTICLE'
  | 'WORKFLOW_RUN'
  | 'DATASET'
  | 'KNOWLEDGE_BASE'
  | 'USER_PROFILE'
/**
 * Attachment roles defining how files are used
 */
export type AttachmentRole = 'ATTACHMENT' | 'INLINE' | 'THUMBNAIL' | 'COVER'
/**
 * Valid asset kinds as a const array for runtime validation
 */
export const VALID_ASSET_KINDS = [
  'USER_AVATAR',
  'INLINE_IMAGE',
  'THUMBNAIL',
  'SYSTEM_BLOB',
  'TEMP_UPLOAD',
  'EMAIL_ATTACHMENT',
  'DOCUMENT',
  'VIDEO',
  'AUDIO',
] as const
/**
 * Asset kinds for MediaAsset categorization
 * Derived from the VALID_ASSET_KINDS array
 */
export type AssetKind = (typeof VALID_ASSET_KINDS)[number]
// ============= Request Types =============
/**
 * Request to create a new FolderFile
 */
export interface CreateFileRequest {
  name: string
  path?: string
  ext?: string
  mimeType?: string
  size?: bigint
  checksum?: string
  folderId?: string
  storageLocationId?: string // Optional - only required for createWithVersion
  organizationId?: string
  createdById?: string
}
/**
 * Request to update an existing FolderFile
 */
export interface UpdateFileRequest {
  name?: string
  path?: string
  ext?: string
  folderId?: string
  isArchived?: boolean
  mimeType?: string
  size?: bigint
}
/**
 * Request to create a new Folder
 */
export interface CreateFolderRequest {
  name: string
  parentId?: string
  organizationId: string
  createdById: string
}
/**
 * Request to update an existing Folder
 */
export interface UpdateFolderRequest {
  name?: string
  parentId?: string
}
/**
 * Request to create a new Attachment
 */
export interface CreateAttachmentRequest {
  /** Caller-supplied ID for deterministic inbound attachment creation */
  id?: string
  entityType: EntityType
  entityId: string
  role?: AttachmentRole
  title?: string
  caption?: string
  sort?: number
  /** MIME content ID for cid: inline resolution */
  contentId?: string | null
  organizationId?: string
  createdById?: string
  // Either file OR asset, not both
  fileId?: string
  fileVersionId?: string
  assetId?: string
  assetVersionId?: string
  // Optional idempotency key to avoid duplicates on retries
  idempotencyKey?: string
}
/**
 * Request to update an existing Attachment
 */
export interface UpdateAttachmentRequest {
  role?: AttachmentRole
  title?: string
  caption?: string
  sort?: number
  fileVersionId?: string
  assetVersionId?: string
}
/**
 * Request to create a new MediaAsset
 */
export interface CreateAssetRequest {
  kind: AssetKind
  purpose: string
  name?: string
  mimeType?: string
  size?: bigint
  isPrivate?: boolean
  storageLocationId?: string // Optional - only required for createWithVersion
  organizationId: string
  createdById?: string
}
/**
 * Request to update an existing MediaAsset
 */
export interface UpdateAssetRequest {
  kind?: AssetKind
  name?: string
  isPrivate?: boolean
  mimeType?: string
  size?: bigint
}
// ============= Response Types =============
/**
 * Folder tree node for hierarchical display
 */
export interface FolderTreeNode {
  id: string
  name: string
  path: string
  depth: number
  parentId?: string
  children: FolderTreeNode[]
  fileCount: number
  totalSize: number
}
/**
 * Contents of a folder (subfolders + files)
 */
export interface FolderContents {
  folder: Folder
  subfolders: Folder[]
  files: FolderFile[]
  totalFiles: number
  totalSize: number
}
/**
 * File search result with relevance
 */
export interface FileSearchResult {
  file: FolderFile
  relevance: number
  matchedFields: string[]
  snippet?: string
}
/**
 * Asset search result with relevance
 */
export interface AssetSearchResult {
  asset: MediaAsset
  relevance: number
  matchedFields: string[]
  snippet?: string
}
/**
 * Attachment search result with relevance
 */
export interface AttachmentSearchResult {
  attachment: Attachment
  relevance: number
  matchedFields: string[]
  snippet?: string
}
/**
 * Folder search result with relevance
 */
export interface FolderSearchResult {
  folder: Folder
  relevance: number
  matchedFields: string[]
  snippet?: string
}
// ============= Service Options =============
/**
 * Options for file listing operations
 */
export interface FileListOptions {
  limit?: number
  offset?: number
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'size'
  sortOrder?: 'asc' | 'desc'
  includeArchived?: boolean
  fileTypes?: string[]
  includeCounts?: boolean
}
/**
 * Options for search operations
 */
export interface SearchOptions {
  limit?: number
  offset?: number
  cursor?: string // For cursor-based pagination
  includeContent?: boolean
  fileTypes?: string[]
  kinds?: AssetKind[] // Filter by asset kinds
  sizeLimits?: {
    min?: number
    max?: number
  }
  dateLimits?: {
    createdAfter?: Date
    createdBefore?: Date
  }
}
/**
 * Options for bulk operations
 */
export interface BulkOperationOptions {
  batchSize?: number
  continueOnError?: boolean
  dryRun?: boolean
}
// ============= Utility Types =============
/**
 * File download information
 */
export interface FileDownloadInfo {
  kind: 'url' | 'stream'
  url?: string
  filename: string
  mimeType?: string
  size?: bigint
  expiresAt?: Date
}
/**
 * Asset download information
 */
export interface AssetDownloadInfo {
  url: string
  filename?: string
  mimeType?: string
  size?: bigint
  expiresAt?: Date
}
/**
 * File validation result
 */
export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}
/**
 * Service operation result
 */
export interface ServiceResult<T> {
  success: boolean
  data?: T
  error?: string
  metadata?: Record<string, any>
}
/**
 * Bulk operation result
 */
export interface BulkOperationResult<T> {
  success: boolean
  processed: number
  failed: number
  errors: Array<{
    item: any
    error: string
  }>
  results: T[]
}
// ============= Extended Model Types =============
/**
 * FolderFile with populated relations
 */
export interface FolderFileWithRelations extends FolderFile {
  folder?: Folder | null
  currentVersion?:
    | (FileVersion & {
        storageLocation?: StorageLocation | null
      })
    | null
  versions?: (FileVersion & {
    storageLocation?: StorageLocation | null
  })[]
  attachments?: Attachment[]
  createdBy?: {
    id: string
    name: string | null
    email: string
  } | null
}
/**
 * MediaAsset with populated relations
 */
export interface MediaAssetWithRelations extends MediaAsset {
  currentVersion?: MediaAssetVersion | null
  versions?: MediaAssetVersion[]
  attachments?: Attachment[]
}
/**
 * Attachment with populated relations
 */
export interface AttachmentWithRelations extends Attachment {
  file?: FolderFile | null
  fileVersion?: FileVersion | null
  fileVersionId?: string
  asset?: MediaAsset | null
  assetVersion?: MediaAssetVersion | null
}
/**
 * Folder with populated relations
 */
export interface FolderWithRelations extends Folder {
  parent?: Folder | null
  children?: Folder[]
  files?: FolderFile[]
}
