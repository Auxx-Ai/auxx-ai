// packages/lib/src/files/upload/strategies/presigned-upload.ts

import type { ProgressContext, UploadRequest, UploadResult } from '../enhanced-types'
import { BaseUploadStrategy } from './base-strategy'

/**
 * Presigned upload strategy for client-side uploads
 * Generates presigned URLs for direct client-to-storage uploads
 */
export class PresignedUploadStrategy extends BaseUploadStrategy {
  private readonly maxFileSize = 100 * 1024 * 1024 // 100MB limit for presigned uploads

  /**
   * Check if this strategy can handle the request
   * Presigned upload is suitable for client-side uploads under 100MB
   */
  canHandle(request: UploadRequest): boolean {
    const fileSize = request.size || this.getFileSize(request.content, request.size)
    // Only handle if explicitly requested since this is primarily for client-side use
    return request.strategy === 'presigned' && fileSize <= this.maxFileSize
  }

  /**
   * Execute presigned upload by generating URLs
   * Note: This strategy generates URLs but doesn't perform the actual upload
   */
  async execute(request: UploadRequest, progress: ProgressContext): Promise<UploadResult> {
    this.validateRequest(request)
    this.logStrategyStart(request, 'presigned')

    const uploadId = this.generateUploadId()
    const startTime = Date.now()

    try {
      // Stage 1: Initialize
      progress.updateStage('initializing', 'Preparing presigned upload...')

      // Stage 2: Generate storage key
      progress.updateStage('preparing', 'Generating presigned URL...')
      const storageKey = this.generateStorageKey(request)
      const fileSize = request.size || this.getFileSize(request.content, request.size)

      // Stage 3: Generate presigned upload URL
      progress.updateStage('uploading', 'Creating presigned upload URL...')

      const presignedUpload = await this.storageManager.generatePresignedUploadUrl({
        provider: request.provider!,
        key: storageKey,
        mimeType: request.mimeType,
        size: fileSize,
        ttlSec: 3600, // 1 hour expiry
        metadata: request.metadata,
        credentialId: request.credentialId,
      })

      // Stage 4: Create storage location record
      progress.updateStage('finalizing', 'Creating storage record...')

      const storageLocation = await this.storageManager.createStorageLocation({
        provider: request.provider!,
        externalId: storageKey,
        externalUrl: presignedUpload.url,
        credentialId: request.credentialId,
        size: BigInt(fileSize),
        mimeType: request.mimeType,
        metadata: {
          ...request.metadata,
          presignedUpload: true,
          uploadExpiry: presignedUpload.expiresAt,
        },
        visibility: request.visibility,
      })

      const uploadDuration = Date.now() - startTime
      const result = this.buildUploadResult(storageLocation, request, uploadDuration, uploadId)

      // Add presigned URL information to result
      result.presignedUpload = {
        url: presignedUpload.url,
        fields: presignedUpload.fields,
        expiresAt: presignedUpload.expiresAt,
      }

      progress.updateStage('completed', 'Presigned upload URL generated')

      this.logStrategyComplete(result, 'presigned')
      return result
    } catch (error) {
      this.handleUploadError(error, 'preparing', 'presigned upload')
    }
  }

  /**
   * Generate presigned URLs for multipart upload
   * For large files that need multipart presigned URLs
   */
  async generateMultipartPresignedUrls(
    request: UploadRequest,
    progress: ProgressContext
  ): Promise<{
    uploadId: string
    partUrls: Array<{ partNumber: number; url: string }>
    storageLocation: any
  }> {
    const storageKey = this.generateStorageKey(request)
    const fileSize = request.size || this.getFileSize(request.content, request.size)

    // Start multipart upload
    const multipartUpload = await this.storageManager.startMultipartUpload({
      provider: request.provider!,
      key: storageKey,
      mimeType: request.mimeType,
      metadata: request.metadata,
      credentialId: request.credentialId,
    })

    // Calculate number of parts
    const chunkSize = 5 * 1024 * 1024 // 5MB chunks
    const totalParts = Math.ceil(fileSize / chunkSize)
    const partUrls: Array<{ partNumber: number; url: string }> = []

    // Generate presigned URL for each part
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const partSize =
        partNumber === totalParts ? fileSize - (partNumber - 1) * chunkSize : chunkSize

      const partUpload = await this.storageManager.generatePartUploadUrl({
        provider: request.provider!,
        key: storageKey,
        uploadId: multipartUpload.uploadId,
        partNumber,
        size: partSize,
        credentialId: request.credentialId,
      })

      partUrls.push({
        partNumber,
        url: partUpload.url,
      })

      progress.updateProgress(
        (partNumber / totalParts) * 0.5, // 50% progress for URL generation
        `Generated presigned URL for part ${partNumber}/${totalParts}`
      )
    }

    // Create storage location record
    const storageLocation = await this.storageManager.createStorageLocation({
      provider: request.provider!,
      externalId: storageKey,
      credentialId: request.credentialId,
      size: BigInt(fileSize),
      mimeType: request.mimeType,
      metadata: {
        ...request.metadata,
        multipartUpload: true,
        uploadId: multipartUpload.uploadId,
        totalParts,
      },
      visibility: request.visibility,
    })

    return {
      uploadId: multipartUpload.uploadId,
      partUrls,
      storageLocation,
    }
  }

  /**
   * Complete multipart presigned upload
   * Call this after all parts have been uploaded by the client
   */
  async completeMultipartPresignedUpload(
    request: UploadRequest,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
    progress: ProgressContext
  ): Promise<UploadResult> {
    const startTime = Date.now()
    const storageKey = this.generateStorageKey(request)

    progress.updateStage('finalizing', 'Completing multipart upload...')

    const storageLocation = await this.storageManager.completeMultipartUpload({
      provider: request.provider!,
      key: storageKey,
      uploadId,
      parts,
      credentialId: request.credentialId,
    })

    const uploadDuration = Date.now() - startTime
    const result = this.buildUploadResult(storageLocation, request, uploadDuration, uploadId)

    progress.updateStage('completed', 'Multipart upload completed')

    return result
  }
}
