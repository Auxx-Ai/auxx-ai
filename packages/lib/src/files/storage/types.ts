// packages/lib/src/files/file-storage/types.ts

/**
 * Result returned when uploading a file to storage
 */
export interface FileUploadResult {
  storageKey: string
  url: string
  size: number
  mimeType: string
  checksum?: string
}

/**
 * Result returned when downloading a file from storage
 */
export interface FileDownloadResult {
  buffer: Buffer
  size: number
  mimeType?: string
}

/**
 * Base interface for all storage providers
 */
export interface StorageProvider {
  /**
   * Save a file to storage
   */
  saveFile(
    organizationId: string,
    buffer: Buffer,
    storageKey: string,
    mimeType?: string
  ): Promise<FileUploadResult>

  /**
   * Get a file from storage
   */
  getFile(storageKey: string): Promise<FileDownloadResult>

  /**
   * Delete a file from storage
   */
  deleteFile(storageKey: string): Promise<void>

  /**
   * Get a public URL for a file (if supported)
   */
  getPublicUrl(storageKey: string): string | null

  /**
   * Get a signed/temporary URL for a file
   */
  getSignedUrl(storageKey: string, expiresIn?: number): Promise<string>

  /**
   * Check if a file exists
   */
  fileExists(storageKey: string): Promise<boolean>
}
