// packages/lib/src/workflow-engine/core/execution-utils.ts

import type { NodeExecutionResult } from './types'

/**
 * Calculate total tokens consumed across all node results
 * Checks result.metadata.totalTokens (not result.usage.totalTokens)
 */
export function calculateTotalTokens(nodeResults: Record<string, NodeExecutionResult>): number {
  let totalTokens = 0
  for (const result of Object.values(nodeResults)) {
    // Check if this node has token usage metadata
    if (
      result.metadata?.totalTokens &&
      typeof result.metadata.totalTokens === 'number' &&
      result.metadata.totalTokens > 0
    ) {
      totalTokens += result.metadata.totalTokens
    }
  }
  return totalTokens
}
