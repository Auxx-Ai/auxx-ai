// packages/lib/src/workflow-engine/execution/trigger-manual-resource-workflow-bulk.ts

import { err, ok, Result } from 'neverthrow'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'
import { RedisWorkflowExecutionReporter } from '../execution-reporter'
import { createScopedLogger } from '@auxx/logger'
import { getWorkflowApp } from '@auxx/services/workflows'
import { database as db, schema } from '@auxx/database'
import { executeResourceQuery, fetchResourceById } from '../../resources/resource-fetcher'
import { RESOURCE_TABLE_MAP, isCustomResourceId, type TableId } from '../../resources/client'
import { inArray } from 'drizzle-orm'

const logger = createScopedLogger('trigger-manual-workflow-bulk')

/**
 * Error codes for bulk workflow triggering
 */
export type BulkTriggerErrorCode =
  | 'WORKFLOW_APP_NOT_FOUND'
  | 'WORKFLOW_NOT_ENABLED'
  | 'WORKFLOW_TYPE_MISMATCH'
  | 'WORKFLOW_NOT_PUBLISHED'
  | 'RESOURCE_NOT_FOUND'
  | 'WORKFLOW_EXECUTION_FAILED'

/**
 * Result for a single resource in bulk operation
 */
export interface ResourceTriggerResult {
  resourceId: string
  success: boolean
  workflowRunId?: string
  error?: {
    code: BulkTriggerErrorCode
    message: string
  }
}

/**
 * Bulk trigger response
 */
export interface BulkTriggerResponse {
  summary: {
    total: number
    succeeded: number
    failed: number
  }
  results: ResourceTriggerResult[]
}

/**
 * Bulk trigger error response
 */
export interface BulkTriggerError {
  code: BulkTriggerErrorCode
  message: string
  workflowAppId?: string
  resourceType?: string
}

/**
 * Manually trigger a specific workflow for multiple resources
 *
 * Strategy: Best-effort execution
 * - Validates workflow once (shared validation)
 * - Fetches all resources in batch
 * - Creates workflow runs in parallel
 * - Returns detailed results for each resource
 *
 * Security:
 * - Verifies workflow belongs to organization
 * - Verifies workflow is enabled and published
 * - Verifies workflow type matches resource type
 * - Verifies all resources belong to organization (batch check)
 *
 * @param params - Bulk trigger parameters
 * @returns Result with detailed success/failure per resource
 */
export async function triggerManualResourceWorkflowBulk(params: {
  workflowAppId: string
  resourceType: string
  resourceIds: string[]
  entityDefinitionId?: string // EntityDefinitionId UUID when resourceType === 'entity'
  organizationId: string
  createdBy: string
}): Promise<Result<BulkTriggerResponse, BulkTriggerError>> {
  const { workflowAppId, resourceType, resourceIds, entityDefinitionId, organizationId, createdBy } = params

  logger.info('Bulk manual trigger started', {
    workflowAppId,
    resourceType,
    resourceCount: resourceIds.length,
    entityDefinitionId,
    organizationId,
    createdBy,
  })

  // 1. Validate workflow (shared validation for all resources)
  const workflowResult = await getWorkflowApp({
    workflowAppId,
    organizationId,
  })

  if (workflowResult.isErr()) {
    return err(workflowResult.error)
  }

  const { workflowApp, publishedWorkflow } = workflowResult.value

  if (!workflowApp.enabled) {
    return err({
      code: 'WORKFLOW_NOT_ENABLED',
      message: `Workflow ${workflowAppId} is not enabled`,
      workflowAppId,
    })
  }

  // Verify workflow type matches resource type
  const expectedTriggerType = `${resourceType}-manual-trigger`
  if (publishedWorkflow.triggerType !== expectedTriggerType) {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH',
      message: `Workflow type mismatch. Expected ${expectedTriggerType}, got ${publishedWorkflow.triggerType}`,
      resourceType,
    })
  }

  // 2. Batch fetch all resources (single query for system, individual for custom entities)
  // For entities, use entityDefinitionId (UUID) directly
  const fetchResourceType =
    resourceType === 'entity' && entityDefinitionId ? entityDefinitionId : resourceType
  const resourcesMap = await fetchResourcesByIds(fetchResourceType, resourceIds, organizationId)

  logger.info('Resources fetched', {
    requested: resourceIds.length,
    found: resourcesMap.size,
  })

  // 3. Create workflow runs for each resource (parallel execution)
  const executionService = new WorkflowExecutionService(db)
  const results: ResourceTriggerResult[] = []

  // Use Promise.allSettled to handle partial failures
  const executions = resourceIds.map(async (resourceId): Promise<ResourceTriggerResult> => {
    try {
      // Check if resource exists
      const resourceData = resourcesMap.get(resourceId)
      if (!resourceData) {
        return {
          resourceId,
          success: false,
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `${resourceType} ${resourceId} not found or does not belong to organization`,
          },
        }
      }

      // Create workflow run
      // Use fetchResourceType for resource_type and data key so trigger node can find it
      const workflowRun = await executionService.createRun({
        workflowId: publishedWorkflow.id,
        inputs: {
          trigger_type: expectedTriggerType,
          resource_type: fetchResourceType,
          resource_id: resourceId,
          triggered_at: new Date().toISOString(),
          [fetchResourceType]: resourceData,
          createdBy,
        },
        mode: 'production',
        userId: createdBy,
        organizationId,
      })

      // Execute workflow asynchronously with reporter for node execution persistence
      const reporter = new RedisWorkflowExecutionReporter(workflowRun.id)
      executionService.executeWorkflowAsync(workflowRun, reporter).catch((error) => {
        logger.error('Async workflow execution failed', {
          workflowRunId: workflowRun.id,
          resourceId,
          error: error instanceof Error ? error.message : String(error),
        })
      })

      logger.debug('Workflow run created', {
        resourceId,
        workflowRunId: workflowRun.id,
      })

      return {
        resourceId,
        success: true,
        workflowRunId: workflowRun.id,
      }
    } catch (error) {
      logger.error('Failed to create workflow run', {
        resourceId,
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        resourceId,
        success: false,
        error: {
          code: 'WORKFLOW_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'Workflow execution failed',
        },
      }
    }
  })

  // Wait for all executions to complete
  const settled = await Promise.allSettled(executions)

  // Extract results
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(result.value)
    } else {
      // This shouldn't happen as we catch errors above, but handle it
      logger.error('Unexpected promise rejection', { error: result.reason })
    }
  }

  // Calculate summary
  const succeeded = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  logger.info('Bulk manual trigger completed', {
    workflowAppId,
    total: resourceIds.length,
    succeeded,
    failed,
  })

  return ok({
    summary: {
      total: resourceIds.length,
      succeeded,
      failed,
    },
    results,
  })
}

/**
 * Batch fetch resources by IDs
 * Supports both system resources (contact, ticket, etc.) and custom entities (entity_xxx)
 *
 * For system resources: Uses single batch query with IN clause
 * For custom entities: Fetches individually (no batch query available yet)
 *
 * @returns Map for O(1) lookup by ID
 */
async function fetchResourcesByIds(
  resourceType: string,
  resourceIds: string[],
  organizationId: string
): Promise<Map<string, any>> {
  const resourcesMap = new Map<string, any>()

  // Handle custom entities (entity_xxx)
  if (isCustomResourceId(resourceType)) {
    // Fetch each entity instance individually
    // TODO: Implement batch fetch for entity instances when available
    const fetchPromises = resourceIds.map(async (resourceId) => {
      const resource = await fetchResourceById(resourceType, resourceId, organizationId)
      if (resource) {
        resourcesMap.set(resourceId, resource)
      }
    })

    await Promise.all(fetchPromises)
    return resourcesMap
  }

  // Handle system resources (contact, ticket, thread, message)
  const tableInfo = RESOURCE_TABLE_MAP[resourceType as TableId]
  if (!tableInfo) {
    logger.error('Invalid resource type', { resourceType })
    return resourcesMap
  }

  // Build WHERE clause: id IN (...resourceIds)
  const whereSql = inArray(schema[tableInfo.dbName].id, resourceIds)

  // Fetch all resources in single query
  const resources = await executeResourceQuery(
    resourceType as TableId,
    organizationId,
    { where: whereSql },
    'findMany'
  )

  // Convert to Map for fast lookup
  if (Array.isArray(resources)) {
    for (const resource of resources) {
      resourcesMap.set(resource.id, resource)
    }
  }

  return resourcesMap
}
