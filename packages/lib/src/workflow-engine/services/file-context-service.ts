// packages/lib/src/workflow-engine/services/file-context-service.ts

import type { Database } from '@auxx/database'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  type FileContentOptions,
  type FileReference,
  type FileSource,
  isFileReference,
  isLegacyWorkflowFileData,
  isUrlExpired,
  toFileReference,
} from '../types/file-reference'
import type { WorkflowFileData } from '../types/file-variable'

const logger = createScopedLogger('file-context-service')

/**
 * Attachment data structure from custom fields
 */
interface AttachmentData {
  id: string
  fileId?: string
  assetId?: string
  assetVersionId?: string
  fileVersionId?: string
  asset?: {
    name?: string
    mimeType?: string
    size?: number
  }
}

/**
 * Service for managing file context within workflow execution
 * Handles URL refresh and content retrieval for all file sources
 */
export class FileContextService {
  private db: Database
  private organizationId: string

  constructor(dbInstance: Database | undefined, organizationId: string) {
    this.db = dbInstance || db
    this.organizationId = organizationId
  }

  /**
   * Get fresh URL for a file reference
   * Regenerates presigned URL if expired
   */
  async getFreshUrl(ref: FileReference): Promise<string> {
    if (!isUrlExpired(ref)) {
      return ref.url
    }
    return this.refreshUrl(ref)
  }

  /**
   * Force refresh URL regardless of expiration
   */
  async refreshUrl(ref: FileReference): Promise<string> {
    switch (ref.source) {
      case 'media-asset':
        return this.refreshMediaAssetUrl(ref)
      case 'folder-file':
        return this.refreshFolderFileUrl(ref)
      case 'attachment':
        return this.refreshAttachmentUrl(ref)
      case 'external-url':
        return ref.url // Cannot refresh external URLs
      default:
        logger.warn('Unknown file source, returning existing URL', { source: ref.source })
        return ref.url
    }
  }

  /**
   * Refresh URL for MediaAsset using assetId + versionId
   */
  private async refreshMediaAssetUrl(ref: FileReference): Promise<string> {
    try {
      const { MediaAssetService } = await import('../../files/core/media-asset-service')
      const mediaAssetService = new MediaAssetService(this.organizationId)

      const downloadRef = await mediaAssetService.getDownloadRef(ref.assetId)
      if (downloadRef.type === 'url') {
        return downloadRef.url
      }
      throw new Error('Expected URL download reference')
    } catch (err) {
      logger.error('Failed to refresh MediaAsset URL', {
        assetId: ref.assetId,
        versionId: ref.versionId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Refresh URL for FolderFile
   */
  private async refreshFolderFileUrl(ref: FileReference): Promise<string> {
    try {
      const { FileService } = await import('../../files/core/file-service')
      const fileService = new FileService(this.organizationId)

      const downloadRef = await fileService.getDownloadRef(ref.assetId)
      if (downloadRef.type === 'url') {
        return downloadRef.url
      }
      throw new Error('Expected URL download reference')
    } catch (err) {
      logger.error('Failed to refresh FolderFile URL', {
        fileId: ref.assetId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Refresh URL for attachment
   */
  private async refreshAttachmentUrl(ref: FileReference): Promise<string> {
    try {
      const { AttachmentService } = await import('../../files/core/attachment-service')
      const attachmentService = new AttachmentService(this.organizationId)

      const downloadRef = await attachmentService.getDownloadRef(ref.assetId)
      if (downloadRef.type === 'url') {
        return downloadRef.url
      }
      throw new Error('Expected URL download reference')
    } catch (err) {
      logger.error('Failed to refresh attachment URL', {
        attachmentId: ref.assetId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Get file content in various formats
   */
  async getContent(
    ref: FileReference,
    options: FileContentOptions = {}
  ): Promise<Buffer | string | ReadableStream> {
    // Ensure we have a fresh URL
    const url = await this.getFreshUrl(ref)

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch file content: ${response.status}`)
      }

      if (options.asStream && response.body) {
        return response.body as ReadableStream
      }

      const buffer = Buffer.from(await response.arrayBuffer())

      if (options.asBase64) {
        return buffer.toString('base64')
      }

      return buffer
    } catch (err) {
      logger.error('Failed to get file content', {
        fileId: ref.id,
        source: ref.source,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Normalize file input(s) to an array of FileReferences.
   * Handles single items, arrays, and nested arrays — flattens everything into a flat list.
   */
  async normalizeFileInputs(input: unknown, nodeId: string): Promise<FileReference[]> {
    if (!input) return []

    // Handle arrays (e.g. email attachments, multi-file variables)
    if (Array.isArray(input)) {
      const results = await Promise.all(input.map((item) => this.normalizeFileInput(item, nodeId)))
      return results.filter((ref): ref is FileReference => ref !== null)
    }

    // Single item — delegate to normalizeFileInput
    const ref = await this.normalizeFileInput(input, nodeId)
    return ref ? [ref] : []
  }

  /**
   * Normalize any file input to FileReference
   * Handles various input formats: WorkflowFileData, AttachmentData, URL strings
   */
  async normalizeFileInput(input: unknown, nodeId: string): Promise<FileReference | null> {
    if (!input) return null

    // Already a FileReference
    if (isFileReference(input)) {
      return input
    }

    // Handle WorkflowFileData (with assetId and versionId)
    if (this.isWorkflowFileData(input)) {
      return this.normalizeWorkflowFileData(input, nodeId)
    }

    // Handle legacy WorkflowFileData (without assetId and versionId)
    if (isLegacyWorkflowFileData(input)) {
      return toFileReference(input, 'media-asset')
    }

    // Handle attachment structure (from custom fields)
    if (this.isAttachmentData(input)) {
      return this.normalizeAttachment(input, nodeId)
    }

    // Handle file:ID references (folder file / media asset IDs from the file picker)
    // Must be checked before URL handler since file: is a valid URL scheme
    if (typeof input === 'string' && input.startsWith('file:')) {
      const fileId = input.slice(5)
      return this.normalizeFolderFileId(fileId, nodeId)
    }

    // Handle simple URL string
    if (typeof input === 'string' && this.isValidUrl(input)) {
      return this.normalizeExternalUrl(input, nodeId)
    }

    return null
  }

  /**
   * Type guard for WorkflowFileData (with new assetId/versionId fields)
   */
  private isWorkflowFileData(value: unknown): value is WorkflowFileData {
    if (!value || typeof value !== 'object') return false
    const obj = value as Record<string, unknown>
    return (
      typeof obj.id === 'string' &&
      typeof obj.assetId === 'string' &&
      typeof obj.versionId === 'string' &&
      typeof obj.filename === 'string'
    )
  }

  /**
   * Type guard for attachment data
   */
  private isAttachmentData(value: unknown): value is AttachmentData {
    if (!value || typeof value !== 'object') return false
    const obj = value as Record<string, unknown>
    return typeof obj.id === 'string' && (!!obj.fileId || !!obj.assetId)
  }

  /**
   * Check if string is a valid URL
   */
  private isValidUrl(str: string): boolean {
    try {
      new URL(str)
      return true
    } catch {
      return false
    }
  }

  /**
   * Normalize WorkflowFileData to FileReference
   */
  private normalizeWorkflowFileData(data: WorkflowFileData, nodeId: string): FileReference {
    return {
      id: data.id,
      assetId: data.assetId,
      versionId: data.versionId,
      source: 'media-asset',
      filename: data.filename,
      mimeType: data.mimeType,
      size: data.size,
      url: data.url,
      urlExpiresAt: data.expiresAt || new Date(Date.now() + 3600000),
      nodeId: data.nodeId || nodeId,
      uploadedAt: data.uploadedAt,
    }
  }

  /**
   * Normalize attachment data to FileReference
   */
  private async normalizeAttachment(
    attachment: AttachmentData,
    nodeId: string
  ): Promise<FileReference> {
    const source: FileSource = attachment.assetId ? 'media-asset' : 'attachment'

    // Try to get a download URL for the attachment
    let url = ''
    try {
      if (attachment.assetId) {
        const { MediaAssetService } = await import('../../files/core/media-asset-service')
        const mediaAssetService = new MediaAssetService(this.organizationId)
        const downloadRef = await mediaAssetService.getDownloadRef(attachment.assetId)
        if (downloadRef.type === 'url') {
          url = downloadRef.url
        }
      }
    } catch (err) {
      logger.warn('Failed to get attachment URL during normalization', {
        attachmentId: attachment.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    return {
      id: attachment.id,
      assetId: attachment.assetId || attachment.fileId || attachment.id,
      versionId: attachment.assetVersionId || attachment.fileVersionId || attachment.id,
      source,
      filename: attachment.asset?.name || 'attachment',
      mimeType: attachment.asset?.mimeType || 'application/octet-stream',
      size: attachment.asset?.size || 0,
      url,
      urlExpiresAt: new Date(Date.now() + 3600000),
      nodeId,
    }
  }

  /**
   * Normalize a folder file ID to FileReference
   * Looks up the file via FileService and builds a download URL
   */
  private async normalizeFolderFileId(
    fileId: string,
    nodeId: string
  ): Promise<FileReference | null> {
    try {
      const { FileService } = await import('../../files/core/file-service')
      const fileService = new FileService(this.organizationId)

      // Get file entity for metadata
      const { schema } = await import('@auxx/database')
      const { eq } = await import('drizzle-orm')
      const [entity] = await this.db
        .select({
          name: schema.FolderFile.name,
          mimeType: schema.FolderFile.mimeType,
          size: schema.FolderFile.size,
        })
        .from(schema.FolderFile)
        .where(eq(schema.FolderFile.id, fileId))
        .limit(1)

      if (!entity) {
        logger.warn('Folder file not found', { fileId })
        return null
      }

      const downloadRef = await fileService.getDownloadRef(fileId)
      const url = downloadRef.type === 'url' ? downloadRef.url : ''

      return {
        id: fileId,
        assetId: fileId,
        versionId: fileId,
        source: 'folder-file',
        filename: entity.name || 'file',
        mimeType: entity.mimeType || 'application/octet-stream',
        size: Number(entity.size) || 0,
        url,
        urlExpiresAt:
          downloadRef.type === 'url' ? downloadRef.expiresAt : new Date(Date.now() + 3600000),
        nodeId,
      }
    } catch (err) {
      logger.error('Failed to normalize folder file ID', {
        fileId,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  /**
   * Normalize external URL to FileReference
   */
  private normalizeExternalUrl(url: string, nodeId: string): FileReference {
    // Try to extract filename from URL
    const urlParts = url.split('/')
    const filename = urlParts[urlParts.length - 1]?.split('?')[0] || 'external-file'

    return {
      id: `external-${Date.now()}`,
      assetId: url, // Use URL as source ID
      versionId: url,
      source: 'external-url',
      filename,
      mimeType: 'application/octet-stream', // Unknown
      size: 0, // Unknown
      url,
      urlExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // External URLs don't expire in our system
      nodeId,
    }
  }
}

/**
 * Factory function to create FileContextService
 */
export function createFileContextService(
  organizationId: string,
  dbInstance?: Database
): FileContextService {
  return new FileContextService(dbInstance, organizationId)
}
