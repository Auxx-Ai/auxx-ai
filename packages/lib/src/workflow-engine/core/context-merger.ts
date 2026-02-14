// packages/lib/src/workflow-engine/core/context-merger.ts

import { createScopedLogger } from '@auxx/logger'
import type { BranchResult, ExecutionContext, MergeStrategy } from './types'

const logger = createScopedLogger('context-merger')

/**
 * Conflict resolution options for context merging
 */
export interface MergeOptions {
  conflictResolution: 'last-wins' | 'first-wins' | 'error' | 'custom'
  onConflict: (key: string, values: any[]) => any
}

/**
 * Manages the merging of execution contexts from parallel branches
 */
export class ContextMerger {
  /**
   * Merge branch results according to the specified strategy
   */
  merge(
    branchResults: BranchResult[],
    strategy: MergeStrategy,
    baseContext: ExecutionContext
  ): ExecutionContext {
    switch (strategy.type) {
      case 'merge-all':
        return this.mergeAllContexts(branchResults, baseContext, {
          conflictResolution: strategy.conflictResolution || 'last-wins',
          onConflict: (key: string, values: any[]) => {
            // Log conflict for debugging
            logger.warn('Context merge conflict', { key, values })

            switch (strategy.conflictResolution) {
              case 'last-wins':
                return values[values.length - 1]
              case 'first-wins':
                return values[0]
              case 'error':
                throw new Error(`Merge conflict on key: ${key}`)
              case 'custom':
                if (strategy.customMerger) {
                  // Use custom merger for the specific key
                  return strategy.customMerger(branchResults)[key]
                }
                return values[values.length - 1]
              default:
                return values[values.length - 1]
            }
          },
        })

      case 'first-write':
        return this.firstWinsMerge(branchResults, baseContext)

      case 'last-write':
        return this.lastWinsMerge(branchResults, baseContext)

      case 'custom':
        return this.customMerge(branchResults, strategy.customMerger, baseContext)

      default:
        logger.warn('Unknown merge strategy, using merge-all', { strategy })
        return this.mergeAllContexts(branchResults, baseContext, {
          conflictResolution: 'last-wins',
          onConflict: (key, values) => values[values.length - 1],
        })
    }
  }

  /**
   * Merge all contexts with conflict detection and resolution
   */
  private mergeAllContexts(
    branchResults: BranchResult[],
    baseContext: ExecutionContext,
    options: MergeOptions
  ): ExecutionContext {
    const mergedVariables = { ...baseContext.variables }
    const conflicts = new Map<string, any[]>()

    // Track all changes and detect conflicts
    for (const result of branchResults) {
      if (result.status === 'success' && result.contextChanges) {
        for (const [key, value] of Object.entries(result.contextChanges)) {
          if (key in mergedVariables && mergedVariables[key] !== value) {
            // Conflict detected
            if (!conflicts.has(key)) {
              conflicts.set(key, [mergedVariables[key]])
            }
            conflicts.get(key)!.push(value)
          }
          mergedVariables[key] = value
        }
      }
    }

    // Resolve conflicts
    for (const [key, values] of conflicts) {
      mergedVariables[key] = options.onConflict(key, values)
    }

    // Log merge summary
    logger.info('Context merge completed', {
      branchCount: branchResults.length,
      successfulBranches: branchResults.filter((r) => r.status === 'success').length,
      variableCount: Object.keys(mergedVariables).length,
      conflictCount: conflicts.size,
    })

    return {
      ...baseContext,
      variables: mergedVariables,
    }
  }

  /**
   * First branch to complete wins for each variable
   */
  private firstWinsMerge(
    branchResults: BranchResult[],
    baseContext: ExecutionContext
  ): ExecutionContext {
    const mergedVariables = { ...baseContext.variables }
    const variableOwners = new Map<string, string>()

    // Sort by completion time (earliest first)
    const sortedResults = [...branchResults]
      .filter((r) => r.status === 'success' && r.contextChanges)
      .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())

    for (const result of sortedResults) {
      if (result.contextChanges) {
        for (const [key, value] of Object.entries(result.contextChanges)) {
          if (!variableOwners.has(key)) {
            // First write wins
            mergedVariables[key] = value
            variableOwners.set(key, result.branchNodeId)
          }
        }
      }
    }

    logger.debug('First-wins merge completed', {
      variableOwners: Object.fromEntries(variableOwners),
    })

    return {
      ...baseContext,
      variables: mergedVariables,
    }
  }

  /**
   * Last branch to complete wins for each variable
   */
  private lastWinsMerge(
    branchResults: BranchResult[],
    baseContext: ExecutionContext
  ): ExecutionContext {
    const mergedVariables = { ...baseContext.variables }

    // Sort by completion time (latest first)
    const sortedResults = [...branchResults]
      .filter((r) => r.status === 'success' && r.contextChanges)
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())

    // Apply changes in reverse chronological order
    for (const result of sortedResults) {
      if (result.contextChanges) {
        Object.assign(mergedVariables, result.contextChanges)
      }
    }

    return {
      ...baseContext,
      variables: mergedVariables,
    }
  }

  /**
   * Use custom merge function
   */
  private customMerge(
    branchResults: BranchResult[],
    customFn: ((results: BranchResult[]) => any) | undefined,
    baseContext: ExecutionContext
  ): ExecutionContext {
    if (!customFn) {
      logger.warn('Custom merge strategy specified but no function provided')
      return baseContext
    }

    const customVariables = customFn(branchResults)

    return {
      ...baseContext,
      variables: {
        ...baseContext.variables,
        ...customVariables,
      },
    }
  }

  /**
   * Advanced merge with selective variable merging
   */
  selectiveMerge(
    branchResults: BranchResult[],
    selector: (key: string, values: Array<{ branch: string; value: any }>) => any,
    baseContext: ExecutionContext
  ): ExecutionContext {
    const mergedVariables = { ...baseContext.variables }
    const variableValues = new Map<string, Array<{ branch: string; value: any }>>()

    // Collect all variable values by key
    for (const result of branchResults) {
      if (result.status === 'success' && result.contextChanges) {
        for (const [key, value] of Object.entries(result.contextChanges)) {
          if (!variableValues.has(key)) {
            variableValues.set(key, [])
          }
          variableValues.get(key)!.push({
            branch: result.branchNodeId,
            value,
          })
        }
      }
    }

    // Apply selector to each variable
    for (const [key, values] of variableValues) {
      mergedVariables[key] = selector(key, values)
    }

    return {
      ...baseContext,
      variables: mergedVariables,
    }
  }

  /**
   * Analyze merge conflicts and patterns
   */
  analyzeMergeConflicts(branchResults: BranchResult[]): {
    hasConflicts: boolean
    conflictingKeys: string[]
    conflictDetails: Map<string, { values: any[]; branches: string[] }>
  } {
    const conflictDetails = new Map<string, { values: any[]; branches: string[] }>()
    const allChanges = new Map<string, Array<{ branch: string; value: any }>>()

    // Collect all changes
    for (const result of branchResults) {
      if (result.status === 'success' && result.contextChanges) {
        for (const [key, value] of Object.entries(result.contextChanges)) {
          if (!allChanges.has(key)) {
            allChanges.set(key, [])
          }
          allChanges.get(key)!.push({
            branch: result.branchNodeId,
            value,
          })
        }
      }
    }

    // Detect conflicts
    for (const [key, changes] of allChanges) {
      const uniqueValues = new Map<string, { value: any; branches: string[] }>()

      for (const change of changes) {
        const valueStr = JSON.stringify(change.value)
        if (!uniqueValues.has(valueStr)) {
          uniqueValues.set(valueStr, { value: change.value, branches: [] })
        }
        uniqueValues.get(valueStr)!.branches.push(change.branch)
      }

      if (uniqueValues.size > 1) {
        // Conflict detected
        conflictDetails.set(key, {
          values: Array.from(uniqueValues.values()).map((v) => v.value),
          branches: changes.map((c) => c.branch),
        })
      }
    }

    return {
      hasConflicts: conflictDetails.size > 0,
      conflictingKeys: Array.from(conflictDetails.keys()),
      conflictDetails,
    }
  }
}
