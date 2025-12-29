// packages/lib/src/workflow-engine/core/batched-join-updater.ts

import { createScopedLogger } from '@auxx/logger'
import type { BranchResult } from './types'

const logger = createScopedLogger('batched-join-updater')

/**
 * Batch update entry for a join node
 */
interface BatchEntry {
  joinNodeId: string
  executionId: string
  branchId: string
  result: BranchResult
  timestamp: number
}

/**
 * Handles batched updates to join states for improved performance
 */
export class BatchedJoinStateUpdater {
  private pendingUpdates = new Map<string, BatchEntry[]>()
  private flushTimer?: NodeJS.Timeout
  private readonly batchSize: number
  private readonly flushInterval: number
  private updateHandler?: (updates: Map<string, BatchEntry[]>) => Promise<void>

  constructor(
    batchSize = 100,
    flushInterval = 100 // milliseconds
  ) {
    this.batchSize = batchSize
    this.flushInterval = flushInterval
  }

  /**
   * Set the handler for processing batched updates
   */
  setUpdateHandler(handler: (updates: Map<string, BatchEntry[]>) => Promise<void>) {
    this.updateHandler = handler
  }

  /**
   * Add a branch arrival to the batch
   */
  async addBranchArrival(
    executionId: string,
    joinNodeId: string,
    branchId: string,
    result: BranchResult
  ): Promise<void> {
    const key = `${executionId}:${joinNodeId}`

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, [])
    }

    this.pendingUpdates.get(key)!.push({
      joinNodeId,
      executionId,
      branchId,
      result,
      timestamp: Date.now(),
    })

    // Check if we should flush due to batch size
    const totalPending = Array.from(this.pendingUpdates.values()).reduce(
      (sum, entries) => sum + entries.length,
      0
    )

    if (totalPending >= this.batchSize) {
      logger.debug('Flushing due to batch size', {
        batchSize: this.batchSize,
        totalPending,
      })
      await this.flush()
    } else {
      // Schedule flush if not already scheduled
      this.scheduleFlush()
    }
  }

  /**
   * Schedule a flush operation
   */
  private scheduleFlush(): void {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flush().catch((error) => {
          logger.error('Error in scheduled flush', { error })
        })
      }, this.flushInterval)
    }
  }

  /**
   * Flush all pending updates
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    if (this.pendingUpdates.size === 0) {
      return
    }

    const updates = new Map(this.pendingUpdates)
    this.pendingUpdates.clear()

    const totalUpdates = Array.from(updates.values()).reduce(
      (sum, entries) => sum + entries.length,
      0
    )

    logger.info('Flushing batch updates', {
      joinNodes: updates.size,
      totalUpdates,
      oldestUpdate: this.findOldestUpdate(updates),
    })

    try {
      if (this.updateHandler) {
        await this.updateHandler(updates)
      } else {
        logger.warn('No update handler configured for batch updates')
      }
    } catch (error) {
      logger.error('Failed to flush batch updates', {
        error: error instanceof Error ? error.message : String(error),
        joinNodes: updates.size,
        totalUpdates,
      })

      // Re-queue failed updates
      updates.forEach((entries, key) => {
        if (!this.pendingUpdates.has(key)) {
          this.pendingUpdates.set(key, [])
        }
        this.pendingUpdates.get(key)!.push(...entries)
      })

      // Reschedule flush for retry
      this.scheduleFlush()
      throw error
    }
  }

  /**
   * Find the oldest update timestamp
   */
  private findOldestUpdate(updates: Map<string, BatchEntry[]>): number | null {
    let oldest: number | null = null

    updates.forEach((entries) => {
      entries.forEach((entry) => {
        if (oldest === null || entry.timestamp < oldest) {
          oldest = entry.timestamp
        }
      })
    })

    return oldest ? Date.now() - oldest : null
  }

  /**
   * Get statistics about pending updates
   */
  getStats() {
    const totalPending = Array.from(this.pendingUpdates.values()).reduce(
      (sum, entries) => sum + entries.length,
      0
    )

    return {
      pendingJoinNodes: this.pendingUpdates.size,
      totalPendingUpdates: totalPending,
      isFlushScheduled: !!this.flushTimer,
    }
  }

  /**
   * Force flush and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    if (this.pendingUpdates.size > 0) {
      logger.info('Shutting down - flushing remaining updates', {
        pendingJoinNodes: this.pendingUpdates.size,
      })
      await this.flush()
    }
  }
}

// Singleton instance
export const batchedJoinUpdater = new BatchedJoinStateUpdater()
