// packages/lib/src/workflow-engine/core/join-execution-manager.ts

import { createScopedLogger } from '@auxx/logger'
import { BatchedJoinStateUpdater } from './batched-join-updater'
import { JoinStateCache } from './join-state-cache'
import type { BranchResult, BranchError, NodeExecutionResult, NodeRunningStatus } from './types'

import { JoinState } from './types'

const logger = createScopedLogger('join-execution-manager')

/**
 * Options for waiting at join nodes
 */
export interface JoinWaitOptions {
  timeout?: number
  minRequired?: number
  waitStrategy: 'all' | 'any' | 'count' | 'timeout'
  errorStrategy: 'fail-fast' | 'collect-all' | 'best-effort'
}

/**
 * Result of waiting for branches at a join node
 */
export interface BranchArrivalStatus {
  canProceed: boolean
  reason?: 'timeout' | 'error' | 'waiting'
  arrivedCount: number
  expectedCount: number
  successfulBranches: string[]
  failedBranches: string[]
  errors: Array<{ branch: string; error: any }>
  firstError?: { branch: string; error: any }
}

/**
 * Result of join execution
 */
export interface JoinExecutionResult {
  status: 'completed' | 'waiting' | 'timeout' | 'error'
  nodeResult?: NodeExecutionResult
  waitState?: {
    joinNodeId: string
    expectedCount: number
    arrivedCount: number
  }
}

/**
 * Active join tracker for managing ongoing join operations
 * V5 enhancement: Added waitingForBranches tracking
 */
interface ActiveJoinTracker {
  joinNodeId: string
  executionId: string // Track executionId for cache invalidation
  joinState: JoinState
  continuationCallback?: () => Promise<void>
  timeoutHandle?: NodeJS.Timeout
  waitOptions: JoinWaitOptions
  startTime: number

  // V5: Track which branches we're waiting for
  waitingForBranches: Set<string> // Branch execution IDs
}

/**
 * Manages join node execution and branch convergence
 * V5 enhancement: Added executedJoins for idempotency
 */
export class JoinExecutionManager {
  private activeJoins = new Map<string, ActiveJoinTracker>()
  private executedJoins = new Set<string>() // V5: Idempotency guard

  constructor(
    private batchedJoinUpdater: BatchedJoinStateUpdater,
    private joinStateCache: JoinStateCache
  ) {
    // Set up the update handler for batched updates
    this.batchedJoinUpdater.setUpdateHandler(async (updates) => {
      await this.processBatchedUpdates(updates)
    })
  }

  /**
   * Register a continuation callback for when a join is ready
   * V5 enhancement: Added waitingForBranches parameter
   */
  async registerContinuation(
    executionId: string,
    joinNodeId: string,
    joinState: JoinState,
    callback: () => Promise<void>,
    waitOptions: JoinWaitOptions,
    waitingForBranches: string[] = [] // V5: NEW parameter
  ): Promise<void> {
    const tracker: ActiveJoinTracker = {
      joinNodeId,
      executionId,
      joinState,
      continuationCallback: callback,
      waitOptions,
      startTime: Date.now(),
      waitingForBranches: new Set(waitingForBranches), // V5: NEW
    }

    // Set up timeout if specified
    if (waitOptions.timeout) {
      tracker.timeoutHandle = setTimeout(() => {
        this.handleJoinTimeout(joinNodeId)
      }, waitOptions.timeout)
    }

    this.activeJoins.set(joinNodeId, tracker)

    logger.info('Registered join continuation', {
      joinNodeId,
      expectedBranches: joinState.expectedInputs.size,
      arrivedBranches: joinState.completedInputs.size,
      waitingForBranches: waitingForBranches.length,
      timeout: waitOptions.timeout,
    })
  }

  /**
   * Execute join node with proper waiting and convergence
   */
  async executeJoin(
    joinNodeId: string,
    joinState: JoinState,
    strategy: JoinWaitOptions
  ): Promise<JoinExecutionResult> {
    const waitResult = await this.waitForBranches(joinState, strategy)

    if (!waitResult.canProceed) {
      return {
        status: 'waiting',
        waitState: {
          joinNodeId,
          expectedCount: waitResult.expectedCount,
          arrivedCount: waitResult.arrivedCount,
        },
      }
    }

    return {
      status: 'completed',
    }
  }

  /**
   * Wait for branches with configurable strategies
   */
  async waitForBranches(
    joinState: JoinState,
    options: JoinWaitOptions
  ): Promise<BranchArrivalStatus> {
    const result: BranchArrivalStatus = {
      canProceed: false,
      arrivedCount: joinState.completedInputs.size,
      expectedCount: joinState.expectedInputs.size,
      successfulBranches: [],
      failedBranches: [],
      errors: [],
    }

    // Analyze branch results
    for (const [branchId, branchResult] of Object.entries(joinState.branchResults)) {
      if (branchResult.status === 'success') {
        result.successfulBranches.push(branchId)
      } else if (branchResult.status === 'error') {
        result.failedBranches.push(branchId)
        const error = {
          branch: branchId,
          error: branchResult.error,
        }
        result.errors.push(error)
        if (!result.firstError) {
          result.firstError = error
        }
      }
    }

    // Apply wait strategy
    switch (options.waitStrategy) {
      case 'all':
        result.canProceed = result.arrivedCount === result.expectedCount
        break

      case 'any':
        result.canProceed = result.arrivedCount > 0
        break

      case 'count':
        result.canProceed = result.arrivedCount >= (options.minRequired || 1)
        break

      case 'timeout':
        const elapsed = Date.now() - joinState.startedAt.getTime()
        const isTimeout = options.timeout ? elapsed >= options.timeout : false
        result.canProceed = result.arrivedCount === result.expectedCount || isTimeout
        if (isTimeout && !result.canProceed) {
          result.reason = 'timeout'
        }
        break
    }

    // Apply error strategy if we can proceed
    if (result.canProceed && result.errors.length > 0) {
      switch (options.errorStrategy) {
        case 'fail-fast':
          result.canProceed = false
          result.reason = 'error'
          break

        case 'best-effort':
          // Check if we have minimum successful branches
          const minSuccessful = options.minRequired || 1
          if (result.successfulBranches.length < minSuccessful) {
            result.canProceed = false
            result.reason = 'error'
          }
          break

        case 'collect-all':
          // Continue even with errors
          break
      }
    }

    if (!result.canProceed && !result.reason) {
      result.reason = 'waiting'
    }

    return result
  }

  /**
   * Mark a branch as arrived and check if join can proceed
   * V5 enhancement: Added idempotency guard and waitingForBranches tracking
   */
  async markBranchArrived(
    executionId: string,
    joinNodeId: string,
    branchId: string,
    result: BranchResult
  ): Promise<void> {
    // V5: Check if join already executed (late arrival after timeout)
    const joinKey = `${executionId}:${joinNodeId}`
    if (this.executedJoins.has(joinKey)) {
      logger.warn('Branch arrived after join execution', {
        branchId,
        joinNodeId,
        reason: 'timeout or early completion',
      })
      return // Ignore late arrival
    }

    // Add to batched updates
    await this.batchedJoinUpdater.addBranchArrival(executionId, joinNodeId, branchId, result)

    // Check if this join has a continuation waiting
    const tracker = this.activeJoins.get(joinNodeId)
    if (tracker) {
      // Update the join state
      tracker.joinState.completedInputs.add(branchId)
      tracker.joinState.branchResults[branchId] = result

      // V5: Remove from waiting list
      tracker.waitingForBranches.delete(`${executionId}-branch-${branchId}`)

      // Check if join can now proceed
      const waitResult = await this.waitForBranches(tracker.joinState, tracker.waitOptions)

      if (waitResult.canProceed) {
        // V5: IDEMPOTENCY GUARD
        if (this.executedJoins.has(joinKey)) {
          logger.warn('Join already executed, skipping', { joinKey })
          return
        }

        this.executedJoins.add(joinKey)

        logger.info('Join ready to proceed', {
          joinNodeId,
          arrivedCount: waitResult.arrivedCount,
          expectedCount: waitResult.expectedCount,
          reason: waitResult.reason,
        })

        // Clear timeout if set
        if (tracker.timeoutHandle) {
          clearTimeout(tracker.timeoutHandle)
        }

        // Execute continuation callback
        if (tracker.continuationCallback) {
          try {
            await tracker.continuationCallback()
          } catch (error) {
            this.executedJoins.delete(joinKey) // V5: Allow retry on error
            logger.error('Error executing join continuation', {
              joinNodeId,
              error: error instanceof Error ? error.message : String(error),
            })
            throw error
          }
        }

        // Clean up
        this.activeJoins.delete(joinNodeId)
      }
    }
  }

  /**
   * Handle join timeout
   */
  private handleJoinTimeout(joinNodeId: string): void {
    const tracker = this.activeJoins.get(joinNodeId)
    if (!tracker) return

    logger.warn('Join timeout reached', {
      joinNodeId,
      elapsed: Date.now() - tracker.startTime,
      arrivedCount: tracker.joinState.completedInputs.size,
      expectedCount: tracker.joinState.expectedInputs.size,
    })

    // Mark any unarrived branches as timeout
    tracker.joinState.expectedInputs.forEach((branchId) => {
      if (!tracker.joinState.completedInputs.has(branchId)) {
        // Create proper Error object with code property
        const timeoutError = new Error(
          `Branch timed out waiting for join after ${tracker.waitOptions.timeout}ms`
        ) as BranchError
        timeoutError.code = 'TIMEOUT'

        tracker.joinState.branchResults[branchId] = {
          branchNodeId: branchId,
          status: 'timeout',
          completedAt: new Date(),
          error: timeoutError,
        }
      }
    })

    // Execute continuation if configured for timeout
    if (tracker.waitOptions.waitStrategy === 'timeout' && tracker.continuationCallback) {
      tracker.continuationCallback().catch((error) => {
        logger.error('Error executing timeout continuation', {
          joinNodeId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    this.activeJoins.delete(joinNodeId)
  }

  /**
   * Process batched updates from the BatchedJoinUpdater
   */
  private async processBatchedUpdates(
    updates: Map<
      string,
      Array<{
        joinNodeId: string
        executionId: string
        branchId: string
        result: BranchResult
        timestamp: number
      }>
    >
  ): Promise<void> {
    for (const [key, entries] of updates) {
      for (const entry of entries) {
        // Update join state cache with correct parameters
        const joinState = this.joinStateCache.get(entry.executionId, entry.joinNodeId)
        if (joinState) {
          joinState.completedInputs.add(entry.branchId)
          joinState.branchResults[entry.branchId] = entry.result
          this.joinStateCache.set(entry.executionId, entry.joinNodeId, joinState)
        }

        // Check for active continuations directly (avoid recursive call)
        const tracker = this.activeJoins.get(entry.joinNodeId)
        if (tracker) {
          // Update the join state in tracker
          tracker.joinState.completedInputs.add(entry.branchId)
          tracker.joinState.branchResults[entry.branchId] = entry.result

          // Check if join can now proceed
          const waitResult = await this.waitForBranches(tracker.joinState, tracker.waitOptions)

          if (waitResult.canProceed) {
            logger.info('Join ready to proceed (from batch update)', {
              joinNodeId: entry.joinNodeId,
              arrivedCount: waitResult.arrivedCount,
              expectedCount: waitResult.expectedCount,
            })

            // Clear timeout if set
            if (tracker.timeoutHandle) {
              clearTimeout(tracker.timeoutHandle)
            }

            // Execute continuation callback
            if (tracker.continuationCallback) {
              try {
                await tracker.continuationCallback()
              } catch (error) {
                logger.error('Error executing join continuation from batch', {
                  joinNodeId: entry.joinNodeId,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            }

            // Clean up
            this.activeJoins.delete(entry.joinNodeId)
          }
        }
      }
    }
  }

  /**
   * Clean up join state after execution
   */
  /**
   * V5: Find active join by branch execution ID
   * Used during branch resume to find waiting join
   */
  findJoinForBranch(branchExecutionId: string): ActiveJoinTracker | undefined {
    const parentExecutionId = branchExecutionId.split('-branch-')[0]

    for (const tracker of this.activeJoins.values()) {
      if (tracker.executionId === parentExecutionId) {
        if (tracker.waitingForBranches.has(branchExecutionId)) {
          return tracker
        }
      }
    }

    return undefined
  }

  /**
   * V5: Cleanup for completed workflows
   */
  cleanup(executionId: string): void {
    // Remove executed join guards
    for (const key of this.executedJoins) {
      if (key.startsWith(executionId + ':')) {
        this.executedJoins.delete(key)
      }
    }

    // Clear active joins
    for (const [joinNodeId, tracker] of this.activeJoins.entries()) {
      if (tracker.executionId === executionId) {
        if (tracker.timeoutHandle) {
          clearTimeout(tracker.timeoutHandle)
        }
        this.activeJoins.delete(joinNodeId)
      }
    }
  }

  async cleanupJoin(joinNodeId: string): Promise<void> {
    // Remove from active joins
    const tracker = this.activeJoins.get(joinNodeId)
    if (tracker) {
      if (tracker.timeoutHandle) {
        clearTimeout(tracker.timeoutHandle)
      }

      // Invalidate cache with executionId from tracker
      this.joinStateCache.invalidate(tracker.executionId, joinNodeId)

      this.activeJoins.delete(joinNodeId)
      logger.debug('Cleaned up join state', { joinNodeId, executionId: tracker.executionId })
    } else {
      // If no tracker, we can't properly invalidate cache (executionId unknown)
      // The cache will clean up naturally via LRU eviction
      logger.debug('Cleaned up join state (no tracker found)', { joinNodeId })
    }

    // Flush any pending updates
    await this.batchedJoinUpdater.flush()
  }

  /**
   * Create a waiting result for workflow engine
   */
  createWaitingResult(joinNodeId: string, waitState: BranchArrivalStatus): NodeExecutionResult {
    return {
      nodeId: joinNodeId,
      status: 'Waiting' as NodeRunningStatus,
      output: {
        waitingFor: 'branches',
        arrivedCount: waitState.arrivedCount,
        expectedCount: waitState.expectedCount,
        reason: waitState.reason,
      },
      executionTime: 0,
      metadata: {
        isWaitingForJoin: true,
      },
    }
  }
}
