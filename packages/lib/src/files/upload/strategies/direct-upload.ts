// packages/lib/src/files/upload/strategies/direct-upload.ts

import type { ProgressContext, UploadRequest, UploadResult } from '../enhanced-types'
import { BaseUploadStrategy } from './base-strategy'

/**
 * Direct upload strategy for small to medium files
 * Uses presigned upload flow for better performance
 */
export class DirectUploadStrategy extends BaseUploadStrategy {
  private readonly maxFileSize = 50 * 1024 * 1024 // 50MB limit for direct uploads

  /**
   * Check if this strategy can handle the request
   * Direct upload is suitable for files under 50MB
   */
  canHandle(request: UploadRequest): boolean {
    const fileSize = request.size || this.getFileSize(request.content, request.size)
    return fileSize <= this.maxFileSize
  }

  /**
   * Execute direct upload using StorageManager
   */
  async execute(request: UploadRequest, progress: ProgressContext): Promise<UploadResult> {
    this.validateRequest(request)
    this.logStrategyStart(request, 'direct')

    const uploadId = this.generateUploadId()
    const startTime = Date.now()

    try {
      // Stage 1: Initialize
      progress.updateStage('initializing', 'Preparing direct upload...')

      // Stage 2: Prepare content
      progress.updateStage('preparing', 'Processing file content...')
      const content = await this.getContentAsBuffer(request.content)
      const storageKey = this.generateStorageKey(request)

      // Stage 3: Upload to storage
      progress.updateStage('uploading', 'Uploading to storage...')

      // Simulate progress during upload
      const progressInterval = this.startProgressSimulation(progress, content.length)

      try {
        // Use presigned upload flow instead of deprecated uploadFile
        // Step 1: Generate presigned upload URL
        const presignedUpload = await this.storageManager.generatePresignedUploadUrl({
          provider: request.provider!,
          key: storageKey,
          mimeType: request.mimeType,
          size: content.length,
          metadata: request.metadata,
          credentialId: request.credentialId,
        })

        // Step 2: Upload content using presigned URL
        const uploadResponse = await this.uploadToPresignedUrl(presignedUpload, content)

        // Step 3: Create storage location record after successful upload
        const storageLocation = await this.storageManager.createStorageLocation({
          provider: request.provider!,
          externalId: storageKey,
          externalUrl: presignedUpload.url,
          credentialId: request.credentialId,
          size: BigInt(content.length),
          mimeType: request.mimeType,
          metadata: request.metadata,
          visibility: request.visibility,
        })

        clearInterval(progressInterval)

        // Stage 4: Finalize
        progress.updateStage('finalizing', 'Upload completed successfully')

        const uploadDuration = Date.now() - startTime
        const result = this.buildUploadResult(storageLocation, request, uploadDuration, uploadId)

        this.logStrategyComplete(result, 'direct')
        return result
      } catch (error) {
        clearInterval(progressInterval)
        throw error
      }
    } catch (error) {
      this.handleUploadError(error, 'uploading', 'direct upload')
    }
  }

  /**
   * Start progress simulation for direct uploads
   * Since StorageManager doesn't provide real-time progress yet,
   * we simulate progress based on time
   */
  private startProgressSimulation(progress: ProgressContext, totalBytes: number): NodeJS.Timeout {
    const startTime = Date.now()
    let simulatedBytes = 0

    return setInterval(() => {
      const elapsed = Date.now() - startTime

      // Simulate progress based on elapsed time
      // Assume average upload speed and gradually increase progress
      const estimatedSpeed = 1024 * 1024 // 1MB/s baseline
      const progressBytes = Math.min(totalBytes, (elapsed / 1000) * estimatedSpeed)

      if (progressBytes > simulatedBytes) {
        simulatedBytes = progressBytes
        progress.updateProgress(simulatedBytes, 'Uploading...')
      }

      // Don't simulate beyond 90% to leave room for completion
      if (simulatedBytes >= totalBytes * 0.9) {
        simulatedBytes = totalBytes * 0.9
      }
    }, 250) // Update every 250ms
  }
}
