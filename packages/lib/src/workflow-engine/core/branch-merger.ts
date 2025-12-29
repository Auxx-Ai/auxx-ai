// packages/lib/src/workflow-engine/core/branch-merger.ts

import type { BranchResult, MergeStrategy } from './types'
import type { ExecutionContextManager } from './execution-context'

/**
 * Handles branch result merging at join points
 * Extracted from JoinNode processor to be used by workflow engine
 */
export class BranchMerger {
  /**
   * Merge branch results using specified strategy
   */
  async mergeBranchResults(
    branchResults: Record<string, BranchResult>,
    strategy: MergeStrategy,
    contextManager: ExecutionContextManager,
    joinNodeId: string
  ): Promise<Record<string, any>> {
    const merged: Record<string, any> = {}
    const conflicts: Array<{ variable: string; values: any[] }> = []

    // Collect all variable changes from successful branches
    const allChanges: Array<{ branch: string; changes: Record<string, any> }> = []

    for (const [branchId, result] of Object.entries(branchResults)) {
      if (result.status === 'success' && result.contextChanges) {
        allChanges.push({ branch: branchId, changes: result.contextChanges })
      }
    }

    // Apply merge strategy
    switch (strategy.type) {
      case 'last-write':
        // Last branch to complete wins
        const sortedByTime = allChanges.sort((a, b) => {
          const timeA = branchResults[a.branch]!.completedAt.getTime()
          const timeB = branchResults[b.branch]!.completedAt.getTime()
          return timeA - timeB
        })

        for (const { changes } of sortedByTime) {
          Object.assign(merged, changes)
        }
        break

      case 'first-write':
        // First branch to complete wins
        const sortedByTimeReverse = allChanges.sort((a, b) => {
          const timeA = branchResults[a.branch]!.completedAt.getTime()
          const timeB = branchResults[b.branch]!.completedAt.getTime()
          return timeB - timeA
        })

        for (const { changes } of sortedByTimeReverse) {
          Object.assign(merged, changes)
        }
        break

      case 'merge-all':
        // Detect conflicts and merge intelligently
        const variableValues = new Map<string, any[]>()

        for (const { changes } of allChanges) {
          for (const [key, value] of Object.entries(changes)) {
            if (!variableValues.has(key)) {
              variableValues.set(key, [])
            }
            variableValues.get(key)!.push(value)
          }
        }

        // Merge each variable
        for (const [key, values] of variableValues) {
          if (values.length === 1) {
            // No conflict
            merged[key] = values[0]
          } else {
            // Conflict detected
            const uniqueValues = [...new Set(values.map((v) => JSON.stringify(v)))].map((v) =>
              JSON.parse(v)
            )

            if (uniqueValues.length === 1) {
              // All branches set same value
              merged[key] = uniqueValues[0]
            } else {
              // Real conflict
              conflicts.push({ variable: key, values: uniqueValues })

              // Apply conflict resolution
              merged[key] = this.resolveConflict(
                key,
                uniqueValues,
                strategy.conflictResolution || 'warn'
              )
            }
          }
        }
        break

      case 'custom':
        if (strategy.customMerger) {
          Object.assign(merged, strategy.customMerger(Object.values(branchResults)))
        }
        break
    }

    // Log conflicts if any
    if (conflicts.length > 0) {
      contextManager.log('WARN', joinNodeId, 'Variable conflicts detected during merge', {
        conflicts: conflicts.map((c) => ({ variable: c.variable, valueCount: c.values.length })),
      })
    }

    return merged
  }

  /**
   * Resolve conflicting variable values
   */
  private resolveConflict(
    variable: string,
    values: any[],
    resolution: 'error' | 'warn' | 'ignore' | 'last-wins' | 'first-wins' | 'custom'
  ): any {
    switch (resolution) {
      case 'error':
        throw new Error(`Conflict in variable '${variable}': multiple values from branches`)
      case 'warn':
      case 'ignore':
      case 'last-wins':
        // Take last value
        return values[values.length - 1]
      case 'first-wins':
        // Take first value
        return values[0]
      default:
        // Default to last value
        return values[values.length - 1]
    }
  }

  /**
   * Analyze branch execution statuses
   */
  analyzeBranchStatuses(branchResults: Record<string, BranchResult>): {
    totalCount: number
    successCount: number
    errorCount: number
    timeoutCount: number
    details: Record<string, { status: string; error?: any; duration?: number }>
  } {
    const analysis = {
      totalCount: Object.keys(branchResults).length,
      successCount: 0,
      errorCount: 0,
      timeoutCount: 0,
      details: {} as Record<string, any>,
    }

    for (const [branchId, result] of Object.entries(branchResults)) {
      switch (result.status) {
        case 'success':
          analysis.successCount++
          break
        case 'error':
          analysis.errorCount++
          break
        case 'timeout':
          analysis.timeoutCount++
          break
      }

      analysis.details[branchId] = {
        status: result.status,
        error: result.error,
        duration: result.executionTime,
      }
    }

    return analysis
  }

  /**
   * Aggregate errors from multiple branches
   */
  aggregateErrors(branchResults: Record<string, BranchResult>): {
    summary: string
    totalErrors: number
    errorsByBranch: Record<string, any>
  } {
    const errors: Array<{ branch: string; error: any }> = []

    for (const [branchId, result] of Object.entries(branchResults)) {
      if (result.status === 'error' && result.error) {
        errors.push({ branch: branchId, error: result.error })
      }
    }

    return {
      summary:
        errors.length === 1
          ? `Branch ${errors[0]!.branch} failed: ${errors[0]!.error.message}`
          : `${errors.length} branches failed`,
      totalErrors: errors.length,
      errorsByBranch: errors.reduce(
        (acc, { branch, error }) => {
          acc[branch] = error
          return acc
        },
        {} as Record<string, any>
      ),
    }
  }

  /**
   * Collect errors from branches (simple list)
   */
  collectErrors(branchResults: Record<string, BranchResult>): any[] {
    const errors = []

    for (const [branchId, result] of Object.entries(branchResults)) {
      if (result.status === 'error' && result.error) {
        errors.push({ branch: branchId, error: result.error })
      }
    }

    return errors
  }
}
