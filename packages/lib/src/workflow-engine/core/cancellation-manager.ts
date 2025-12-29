// packages/lib/src/workflow-engine/core/cancellation-manager.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('cancellation-manager')

/**
 * Manages workflow execution cancellation
 *
 * Tracks cancelled executions and workflow runs, providing abort signals
 * for cooperative cancellation patterns.
 *
 * KEY CONCEPTS:
 * - Execution-level cancellation: Cancel a specific execution by ID
 * - Run-level cancellation: Cancel all executions for a workflow run
 * - Abort signals: Provides AbortController for async operation cancellation
 */
export class CancellationManager {
  /** Tracks individual cancelled execution IDs and run-prefixed IDs */
  private cancelledExecutions = new Set<string>()

  /** Tracks cancelled workflow run IDs */
  private cancelledWorkflowRuns = new Set<string>()

  /** Stores abort controllers for workflow runs */
  private cancellationSignals = new Map<string, AbortController>()

  /**
   * Cancel a specific execution
   *
   * @param executionId - The execution ID to cancel
   */
  cancelExecution(executionId: string): void {
    this.cancelledExecutions.add(executionId)
    logger.info('Workflow execution cancelled', { executionId })
  }

  /**
   * Cancel all executions for a workflow run
   *
   * This creates an abort signal that can be used by nodes to detect
   * cancellation during long-running operations.
   *
   * @param workflowRunId - The workflow run ID to cancel
   */
  cancelWorkflowRun(workflowRunId: string): void {
    // Store with prefix to distinguish from execution IDs
    this.cancelledExecutions.add(`run:${workflowRunId}`)
    this.cancelledWorkflowRuns.add(workflowRunId)

    // Create and immediately abort controller
    const abortController = new AbortController()
    this.cancellationSignals.set(workflowRunId, abortController)
    abortController.abort()

    logger.info('Workflow run cancelled with abort signal', { workflowRunId })
  }

  /**
   * Check if an execution or workflow run is cancelled
   *
   * Checks multiple cancellation sources:
   * 1. Direct execution ID cancellation
   * 2. Workflow run ID cancellation
   * 3. Prefixed run cancellation
   * 4. Abort signal status
   *
   * @param executionId - The execution ID to check
   * @param workflowRunId - Optional workflow run ID to check
   * @returns true if cancelled via any mechanism
   */
  isCancelled(executionId: string, workflowRunId?: string): boolean {
    // Check direct execution ID
    if (this.cancelledExecutions.has(executionId)) {
      return true
    }

    // Check workflow run cancellation (if provided)
    if (workflowRunId) {
      // Check run set
      if (this.cancelledWorkflowRuns.has(workflowRunId)) {
        return true
      }
      // Check prefixed run
      if (this.cancelledExecutions.has(`run:${workflowRunId}`)) {
        return true
      }
      // Check abort signal
      const abortController = this.cancellationSignals.get(workflowRunId)
      if (abortController?.signal.aborted) {
        return true
      }
    }

    return false
  }

  /**
   * Get abort signal for a workflow run
   *
   * Can be passed to async operations (fetch, etc.) to support
   * cooperative cancellation.
   *
   * @param workflowRunId - The workflow run ID
   * @returns AbortSignal or undefined if not found
   */
  getAbortSignal(workflowRunId: string): AbortSignal | undefined {
    return this.cancellationSignals.get(workflowRunId)?.signal
  }

  /**
   * Clean up cancellation tracking
   *
   * Should be called in the finally block of workflow execution
   * to prevent memory leaks.
   *
   * @param executionId - The execution ID to cleanup
   * @param workflowRunId - Optional workflow run ID to cleanup
   */
  cleanup(executionId: string, workflowRunId?: string): void {
    this.cancelledExecutions.delete(executionId)

    if (workflowRunId) {
      this.cancelledExecutions.delete(`run:${workflowRunId}`)
      this.cancelledWorkflowRuns.delete(workflowRunId)

      // Clean up abort controller
      const abortController = this.cancellationSignals.get(workflowRunId)
      if (abortController) {
        this.cancellationSignals.delete(workflowRunId)
      }
    }
  }

  /**
   * Check if a workflow run has been cancelled
   *
   * Convenience method for checking run-level cancellation only.
   *
   * @param workflowRunId - The workflow run ID to check
   * @returns true if the run is cancelled
   */
  isWorkflowRunCancelled(workflowRunId: string): boolean {
    return (
      this.cancelledWorkflowRuns.has(workflowRunId) ||
      this.cancelledExecutions.has(`run:${workflowRunId}`)
    )
  }

  /**
   * Get all cancelled execution IDs (for debugging/monitoring)
   */
  getCancelledExecutions(): string[] {
    return Array.from(this.cancelledExecutions)
  }

  /**
   * Get all cancelled workflow run IDs (for debugging/monitoring)
   */
  getCancelledWorkflowRuns(): string[] {
    return Array.from(this.cancelledWorkflowRuns)
  }

  /**
   * Clear all cancellation state (for testing)
   */
  clearAll(): void {
    this.cancelledExecutions.clear()
    this.cancelledWorkflowRuns.clear()
    this.cancellationSignals.clear()
  }
}
