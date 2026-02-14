// packages/lib/src/workflow-engine/executors/app-workflow-block-executor.ts

/**
 * Executor for app workflow blocks
 * Integrates app workflow blocks with the workflow engine
 */

import { API_URL } from '@auxx/config/urls'
import { createHash } from 'crypto'

/**
 * Workflow node data for app workflow blocks
 */
export interface AppWorkflowBlockNodeData {
  appId: string
  blockId: string
  installationId: string
  [key: string]: any
}

/**
 * Execution context for workflow blocks
 */
export interface WorkflowBlockExecutionContext {
  workflowId: string
  executionId: string
  nodeId: string
  userId: string
  organizationId: string
  variables: Record<string, any>
  authToken: string
}

/**
 * Execute an app workflow block
 */
export async function executeAppWorkflowBlock(
  nodeData: AppWorkflowBlockNodeData,
  context: WorkflowBlockExecutionContext
): Promise<any> {
  const { appId, blockId, installationId, ...blockData } = nodeData

  if (!appId || !blockId) {
    throw new Error('Invalid app workflow block: missing appId or blockId')
  }

  console.log('[AppWorkflowBlockExecutor] Executing block:', {
    appId: appId,
    blockId: blockId,
    nodeId: context.nodeId,
  })

  // Check cache (if enabled)
  const cacheKey = generateCacheKey(context.nodeId, blockData, context.variables)
  const cached = await checkCache(cacheKey, blockData.caching)

  if (cached) {
    console.log('[AppWorkflowBlockExecutor] Cache hit:', cacheKey)
    return cached
  }

  // Execute via API
  const response = await fetch(
    `${API_URL}/api/v1/workflows/${context.workflowId}/executions/${context.executionId}/blocks/${blockId}/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${context.authToken}`,
      },
      body: JSON.stringify({
        appId: appId,
        nodeId: context.nodeId,
        data: blockData,
        variables: context.variables,
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    console.error('[AppWorkflowBlockExecutor] Execution failed:', {
      status: response.status,
      error,
    })
    throw new Error(error.error?.message || 'Failed to execute workflow block')
  }

  const result = await response.json()

  console.log('[AppWorkflowBlockExecutor] Execution complete:', {
    success: result.success,
    duration: result.metadata?.duration,
  })

  // Handle errors
  if (!result.success || result.error) {
    throw new Error(result.error?.message || 'Workflow block execution failed')
  }

  // Cache result (if enabled)
  if (blockData.caching && blockData.caching !== 'none') {
    await cacheResult(cacheKey, result.data, blockData.caching)
  }

  // Return output data
  return result.data
}

/**
 * Generate cache key from inputs
 */
function generateCacheKey(nodeId: string, data: any, variables: Record<string, any>): string {
  // Create deterministic cache key from inputs
  const input = JSON.stringify({ data, variables })
  const hash = createHash('sha256').update(input).digest('hex')
  return `workflow-block:${nodeId}:${hash}`
}

/**
 * Check cache for result
 */
async function checkCache(cacheKey: string, caching?: string): Promise<any | null> {
  if (!caching || caching === 'none') {
    return null
  }

  // TODO: Implement Redis cache lookup
  // For now, return null (no cache)
  return null
}

/**
 * Cache result
 */
async function cacheResult(cacheKey: string, data: any, caching: string): Promise<void> {
  const ttl = caching === 'session' ? 3600 : 86400 // 1 hour or 1 day

  // TODO: Implement Redis cache storage
  // For now, do nothing
  console.log('[AppWorkflowBlockExecutor] Would cache result:', {
    key: cacheKey,
    ttl,
  })
}
