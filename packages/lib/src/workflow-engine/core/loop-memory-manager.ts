// packages/lib/src/workflow-engine/core/loop-memory-manager.ts

import { createScopedLogger } from '@auxx/logger'
import type { LoopExecutionState } from './loop-context-extensions'

const logger = createScopedLogger('loop-memory-manager')

/**
 * Memory usage information
 */
export interface MemoryUsageInfo {
  heapUsed: number
  heapTotal: number
  external: number
  rss: number
  heapUsedMB: number
  heapTotalMB: number
  percentUsed: number
}

/**
 * Loop execution limits configuration
 */
export interface LoopExecutionLimits {
  maxIterations: number
  maxExecutionTime: number
  maxMemoryUsageMB: number
  warningThresholdMB: number
  throttleDelayMs: number
  batchSize: number
}

/**
 * Default limits for loop execution
 */
export const DEFAULT_LOOP_LIMITS: LoopExecutionLimits = {
  maxIterations: 1000,
  maxExecutionTime: 5 * 60 * 1000, // 5 minutes
  maxMemoryUsageMB: 512,
  warningThresholdMB: 256,
  throttleDelayMs: 10,
  batchSize: 100,
}

/**
 * Manages memory usage and execution limits for loop nodes
 */
export class LoopMemoryManager {
  private limits: LoopExecutionLimits
  private lastGCTime: number = 0
  private gcInterval: number = 30000 // 30 seconds
  private baselineMemoryMB: number = 0

  constructor(limits: Partial<LoopExecutionLimits> = {}) {
    this.limits = { ...DEFAULT_LOOP_LIMITS, ...limits }
  }

  /**
   * Record baseline memory before loop execution starts
   */
  recordBaseline(): void {
    const usage = this.checkMemoryUsage()
    this.baselineMemoryMB = usage.heapUsedMB
    logger.debug('Recorded baseline memory for loop execution', {
      baselineMemoryMB: this.baselineMemoryMB,
    })
  }

  /**
   * Get the delta memory usage since baseline was recorded
   */
  private getDeltaMemoryMB(currentMemoryMB: number): number {
    return Math.max(0, currentMemoryMB - this.baselineMemoryMB)
  }

  /**
   * Check current memory usage
   */
  checkMemoryUsage(): MemoryUsageInfo {
    const usage = process.memoryUsage()
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024)
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024)

    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      heapUsedMB,
      heapTotalMB,
      percentUsed: Math.round((usage.heapUsed / usage.heapTotal) * 100),
    }
  }

  /**
   * Check if memory usage is high and throttling is needed
   */
  shouldThrottle(loopState: LoopExecutionState): boolean {
    const usage = this.checkMemoryUsage()
    const deltaMemoryMB = this.getDeltaMemoryMB(usage.heapUsedMB)

    // Check delta memory usage (memory growth since loop started)
    if (deltaMemoryMB > this.limits.warningThresholdMB) {
      logger.warn('High memory usage detected in loop', {
        loopNodeId: loopState.loopNodeId,
        iteration: loopState.currentIteration,
        deltaMemoryMB,
        baselineMemoryMB: this.baselineMemoryMB,
        currentMemoryMB: usage.heapUsedMB,
        thresholdMB: this.limits.warningThresholdMB,
      })
      return true
    }

    // Check if accumulating large results
    if (loopState.results.length > 1000) {
      const resultSize = this.estimateObjectSize(loopState.results)
      const resultSizeMB = resultSize / 1024 / 1024

      if (resultSizeMB > 100) {
        // 100MB of results
        logger.warn('Large result accumulation detected', {
          loopNodeId: loopState.loopNodeId,
          resultCount: loopState.results.length,
          estimatedSizeMB: Math.round(resultSizeMB),
        })
        return true
      }
    }

    // Check heap usage percentage
    if (usage.percentUsed > 80) {
      logger.warn('High heap usage percentage', {
        loopNodeId: loopState.loopNodeId,
        percentUsed: usage.percentUsed,
      })
      return true
    }

    return false
  }

  /**
   * Calculate dynamic batch size based on available memory
   */
  calculateBatchSize(itemCount: number): number {
    const usage = this.checkMemoryUsage()
    const deltaMemoryMB = this.getDeltaMemoryMB(usage.heapUsedMB)
    const availableMemory = this.limits.maxMemoryUsageMB - deltaMemoryMB

    // Dynamic batch sizing based on available memory
    let batchSize: number
    if (availableMemory < 100) {
      batchSize = Math.min(10, itemCount)
    } else if (availableMemory < 200) {
      batchSize = Math.min(50, itemCount)
    } else {
      batchSize = Math.min(this.limits.batchSize, itemCount)
    }

    logger.debug('Calculated batch size', {
      deltaMemoryMB,
      availableMemoryMB: availableMemory,
      itemCount,
      batchSize,
    })

    return batchSize
  }

  /**
   * Check if execution time limit is exceeded
   */
  isExecutionTimeExceeded(startTime: number): boolean {
    return Date.now() - startTime > this.limits.maxExecutionTime
  }

  /**
   * Get throttle delay based on current conditions
   */
  getThrottleDelay(loopState: LoopExecutionState): number {
    const usage = this.checkMemoryUsage()
    const deltaMemoryMB = this.getDeltaMemoryMB(usage.heapUsedMB)

    // Increase delay if delta memory usage is very high
    if (deltaMemoryMB > this.limits.maxMemoryUsageMB * 0.9) {
      return this.limits.throttleDelayMs * 10 // 10x delay
    } else if (deltaMemoryMB > this.limits.warningThresholdMB) {
      return this.limits.throttleDelayMs * 5 // 5x delay
    }

    // Normal throttle delay
    return this.limits.throttleDelayMs
  }

  /**
   * Try to trigger garbage collection if available
   */
  async tryGarbageCollection(): Promise<void> {
    const now = Date.now()

    // Only attempt GC every gcInterval
    if (now - this.lastGCTime < this.gcInterval) {
      return
    }

    this.lastGCTime = now

    // Check if global.gc is available (requires --expose-gc flag)
    if (global.gc) {
      logger.debug('Triggering garbage collection')

      try {
        global.gc()

        // Give GC time to complete
        await new Promise((resolve) => setTimeout(resolve, 100))

        const usage = this.checkMemoryUsage()
        logger.debug('Memory usage after GC', {
          heapUsedMB: usage.heapUsedMB,
          percentUsed: usage.percentUsed,
        })
      } catch (error) {
        logger.error('Failed to trigger garbage collection', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Estimate the size of an object in bytes
   */
  private estimateObjectSize(obj: any): number {
    try {
      // Rough estimation using JSON stringify
      const jsonString = JSON.stringify(obj)
      // UTF-16 characters in JavaScript
      return jsonString.length * 2
    } catch (error) {
      // If stringify fails, return a conservative estimate
      logger.warn('Failed to estimate object size', {
        error: error instanceof Error ? error.message : String(error),
      })
      return 1024 * 1024 // 1MB default
    }
  }

  /**
   * Create a memory report for logging
   */
  getMemoryReport(): string {
    const usage = this.checkMemoryUsage()
    return `Memory: ${usage.heapUsedMB}MB / ${usage.heapTotalMB}MB (${usage.percentUsed}%)`
  }

  /**
   * Check if loop should be terminated due to resource constraints
   */
  shouldTerminateLoop(loopState: LoopExecutionState): { terminate: boolean; reason?: string } {
    const usage = this.checkMemoryUsage()
    const deltaMemoryMB = this.getDeltaMemoryMB(usage.heapUsedMB)

    // Check memory limit (delta memory - memory growth since loop started)
    if (deltaMemoryMB > this.limits.maxMemoryUsageMB) {
      return {
        terminate: true,
        reason: `Loop memory growth (${deltaMemoryMB}MB) exceeds limit (${this.limits.maxMemoryUsageMB}MB). Baseline: ${this.baselineMemoryMB}MB, Current: ${usage.heapUsedMB}MB`,
      }
    }

    // Check execution time
    if (this.isExecutionTimeExceeded(loopState.startTime)) {
      const duration = Date.now() - loopState.startTime
      return {
        terminate: true,
        reason: `Execution time (${Math.round(duration / 1000)}s) exceeds limit (${Math.round(this.limits.maxExecutionTime / 1000)}s)`,
      }
    }

    // Check iteration limit
    if (loopState.currentIteration >= this.limits.maxIterations) {
      return {
        terminate: true,
        reason: `Iteration count (${loopState.currentIteration}) exceeds limit (${this.limits.maxIterations})`,
      }
    }

    return { terminate: false }
  }
}

/**
 * Utility function to throttle execution
 */
export async function throttle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
