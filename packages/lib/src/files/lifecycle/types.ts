// packages/lib/src/files/lifecycle/types.ts

/**
 * Job data for orphaned file cleanup
 */
export interface OrphanedFileCleanupJobData {
  /** Number of files to process in one batch */
  batchSize?: number
  /** If true, only logs what would be deleted without actually deleting */
  dryRun?: boolean
}

/**
 * Result of orphaned file cleanup job
 */
export interface OrphanedFileCleanupResult {
  /** Total number of files processed */
  processed: number
  /** Number of files successfully deleted */
  deleted: number
  /** Number of files that failed to delete */
  errors: number
  /** Details of each processed file */
  files: Array<{
    id: string
    name: string
    size: number
    status: 'deleted' | 'error'
    error?: string
  }>
}

/**
 * Options for deleting files
 */
export interface DeleteFilesOptions {
  /** If true, also delete from storage */
  deleteFromStorage?: boolean
  /** If true, only soft delete (set deletedAt) */
  softDelete?: boolean
  /** User ID performing the deletion */
  deletedBy?: string
}

/**
 * Storage quota information
 */
export interface StorageQuota {
  organizationId: string
  /** Total storage used in bytes */
  totalUsed: number
  /** Storage quota limit in bytes */
  quotaLimit: number
  /** Percentage of quota used */
  percentUsed: number
  /** Number of files */
  fileCount: number
}

/**
 * File cleanup statistics
 */
export interface CleanupStats {
  /** Number of orphaned files cleaned */
  orphanedCleaned: number
  /** Number of expired files cleaned */
  expiredCleaned: number
  /** Number of soft-deleted files cleaned */
  deletedCleaned: number
  /** Total storage freed in bytes */
  storageFreed: number
  /** Timestamp of last cleanup run */
  lastRunAt: Date
}
