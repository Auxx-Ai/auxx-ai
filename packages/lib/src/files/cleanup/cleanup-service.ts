// packages/lib/src/files/cleanup/cleanup-service.ts

import { createScopedLogger } from '@auxx/logger'
import { createStorageManager } from '../storage/storage-manager'
import type { ProviderId } from '../adapters/base-adapter'

const logger = createScopedLogger('cleanup-service')

/**
 * Cleanup task for orphaned S3 objects
 */
export interface CleanupTask {
  id: string
  provider: ProviderId
  storageKey: string
  credentialId?: string
  attempts: number
  maxAttempts: number
  nextAttempt: Date
  createdAt: Date
  reason: string
}

/**
 * Service for managing cleanup of orphaned storage objects
 * Handles compensation when DB transactions fail after S3 operations
 */
export class CleanupService {
  private readonly maxAttempts = 5
  private readonly baseDelayMs = 1000 // 1 second base delay
  private readonly maxDelayMs = 30 * 60 * 1000 // 30 minutes max delay

  /**
   * Schedule S3 object for deletion (compensation mechanism)
   * Used when DB transaction fails after S3 upload completion
   */
  async scheduleCleanup(params: {
    provider: ProviderId
    storageKey: string
    credentialId?: string
    reason: string
    organizationId?: string
  }): Promise<void> {
    const task: Omit<CleanupTask, 'id'> = {
      provider: params.provider,
      storageKey: params.storageKey,
      credentialId: params.credentialId,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      nextAttempt: new Date(), // Immediate first attempt
      createdAt: new Date(),
      reason: params.reason,
    }

    try {
      // For now, store in Redis (could be DB table for persistence)
      // In production, use Redis or database storage
      await this.storeCleanupTask(task)
      
      logger.info('Scheduled cleanup task', {
        provider: params.provider,
        storageKey: params.storageKey,
        reason: params.reason,
      })
    } catch (error) {
      logger.error('Failed to schedule cleanup task', {
        provider: params.provider,
        storageKey: params.storageKey,
        error: error instanceof Error ? error.message : String(error),
      })
      // Don't throw - cleanup is best-effort
    }
  }

  /**
   * Process pending cleanup tasks
   * Should be called by background job/worker
   */
  async processCleanupTasks(): Promise<{
    processed: number
    succeeded: number
    failed: number
    errors: string[]
  }> {
    const tasks = await this.getPendingTasks()
    const errors: string[] = []
    let succeeded = 0
    let failed = 0

    for (const task of tasks) {
      try {
        const success = await this.executeCleanupTask(task)
        if (success) {
          succeeded++
          await this.markTaskCompleted(task.id)
        } else {
          failed++
          await this.handleTaskFailure(task)
        }
      } catch (error) {
        failed++
        const errorMessage = error instanceof Error ? error.message : String(error)
        errors.push(`Task ${task.id}: ${errorMessage}`)
        
        logger.error('Cleanup task execution failed', {
          taskId: task.id,
          provider: task.provider,
          storageKey: task.storageKey,
          error: errorMessage,
        })
        
        await this.handleTaskFailure(task)
      }
    }

    logger.info('Cleanup batch processed', {
      total: tasks.length,
      succeeded,
      failed,
      errorCount: errors.length,
    })

    return {
      processed: tasks.length,
      succeeded,
      failed,
      errors,
    }
  }

  /**
   * Execute a single cleanup task
   */
  private async executeCleanupTask(task: CleanupTask): Promise<boolean> {
    try {
      // Create storage manager with organization ID from task (optional)
      const storageManager = createStorageManager(task.organizationId)
      
      await storageManager.deleteByKey({
        provider: task.provider,
        key: task.storageKey,
        credentialId: task.credentialId,
      })

      logger.info('Successfully deleted orphaned object', {
        provider: task.provider,
        storageKey: task.storageKey,
        attempts: task.attempts + 1,
      })

      return true
    } catch (error) {
      logger.warn('Failed to delete orphaned object', {
        provider: task.provider,
        storageKey: task.storageKey,
        attempts: task.attempts + 1,
        error: error instanceof Error ? error.message : String(error),
      })

      return false
    }
  }

  /**
   * Handle task failure (retry with exponential backoff or give up)
   */
  private async handleTaskFailure(task: CleanupTask): Promise<void> {
    const newAttempts = task.attempts + 1

    if (newAttempts >= task.maxAttempts) {
      // Give up after max attempts
      await this.markTaskFailed(task.id, 'Max attempts exceeded')
      
      logger.warn('Cleanup task abandoned after max attempts', {
        taskId: task.id,
        provider: task.provider,
        storageKey: task.storageKey,
        attempts: newAttempts,
      })
    } else {
      // Schedule retry with exponential backoff
      const delayMs = Math.min(
        this.baseDelayMs * Math.pow(2, newAttempts - 1),
        this.maxDelayMs
      )
      
      const nextAttempt = new Date(Date.now() + delayMs)
      
      await this.updateTaskRetry(task.id, newAttempts, nextAttempt)
      
      logger.info('Cleanup task scheduled for retry', {
        taskId: task.id,
        provider: task.provider,
        storageKey: task.storageKey,
        attempts: newAttempts,
        nextAttempt: nextAttempt.toISOString(),
      })
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    pendingTasks: number
    completedTasks: number
    failedTasks: number
  }> {
    // Implementation depends on storage backend
    // For now, return dummy data
    return {
      pendingTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
    }
  }

  // ============= Storage Backend Methods =============
  // These would be implemented with Redis or database

  private async storeCleanupTask(task: Omit<CleanupTask, 'id'>): Promise<void> {
    // TODO: Implement with Redis or database
    // For now, log only (in production this would persist the task)
    logger.info('Would store cleanup task', { task })
  }

  private async getPendingTasks(): Promise<CleanupTask[]> {
    // TODO: Implement with Redis or database
    // For now, return empty array
    return []
  }

  private async markTaskCompleted(taskId: string): Promise<void> {
    // TODO: Implement with Redis or database
    logger.info('Would mark task completed', { taskId })
  }

  private async markTaskFailed(taskId: string, reason: string): Promise<void> {
    // TODO: Implement with Redis or database
    logger.warn('Would mark task failed', { taskId, reason })
  }

  private async updateTaskRetry(taskId: string, attempts: number, nextAttempt: Date): Promise<void> {
    // TODO: Implement with Redis or database
    logger.info('Would update task retry', { taskId, attempts, nextAttempt })
  }
}

// Export singleton instance
export const cleanupService = new CleanupService()

// Factory function for dependency injection
export const createCleanupService = () => new CleanupService()