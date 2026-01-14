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
import { parseResourceId, type ResourceId } from '@auxx/types/resource'

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
 * - Verifies workflow trigger type is 'manual' and entityDefinitionId matches
 * - Verifies all resources belong to organization (batch check)
 *
 * @param params - Bulk trigger parameters
 * @returns Result with detailed success/failure per resource
 */
export async function triggerManualResourceWorkflowBulk(params: {
  workflowAppId: string
  resourceIds: ResourceId[]
  organizationId: string
  createdBy: string
}): Promise<Result<BulkTriggerResponse, BulkTriggerError>> {
  const { workflowAppId, resourceIds, organizationId, createdBy } = params

  // Parse all ResourceIds
  const parsedResources = resourceIds.map(parseResourceId)

  // Validate all have same entityDefinitionId (workflows are entity-specific)
  const entityDefinitionIds = [...new Set(parsedResources.map(r => r.entityDefinitionId))]
  if (entityDefinitionIds.length > 1) {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH',
      message: 'Cannot trigger workflow for resources from different entity types',
    })
  }
  if (entityDefinitionIds.length === 0) {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH',
      message: 'No resources provided',
    })
  }

  const entityDefinitionId = entityDefinitionIds[0]!
  const entityInstanceIds = parsedResources.map(r => r.entityInstanceId)

  logger.info('Bulk manual trigger started', {
    workflowAppId,
    entityDefinitionId,
    resourceCount: resourceIds.length,
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

  // Verify workflow trigger type is 'manual' and entityDefinitionId matches
  if (publishedWorkflow.triggerType !== 'manual') {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH',
      message: `Workflow type mismatch. Expected 'manual', got '${publishedWorkflow.triggerType}'`,
    })
  }

  if (publishedWorkflow.entityDefinitionId !== entityDefinitionId) {
    return err({
      code: 'WORKFLOW_TYPE_MISMATCH',
      message: `Entity definition mismatch. Expected '${entityDefinitionId}', got '${publishedWorkflow.entityDefinitionId}'`,
    })
  }

  // 2. Batch fetch all resources
  const resourcesMap = await fetchResourcesByIds(resourceIds, organizationId)

  logger.info('Resources fetched', {
    requested: resourceIds.length,
    found: resourcesMap.size,
  })

  // 3. Create workflow runs for each resource (parallel execution)
  const executionService = new WorkflowExecutionService(db)
  const results: ResourceTriggerResult[] = []

  // Use Promise.allSettled to handle partial failures
  const executions = entityInstanceIds.map(async (entityInstanceId, index): Promise<ResourceTriggerResult> => {
    try {
      // Check if resource exists
      const resourceData = resourcesMap.get(entityInstanceId)
      if (!resourceData) {
        return {
          resourceId: entityInstanceId,
          success: false,
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: `Resource ${entityInstanceId} not found or does not belong to organization`,
          },
        }
      }

      // Create workflow run
      const workflowRun = await executionService.createRun({
        workflowId: publishedWorkflow.id,
        inputs: {
          trigger_type: 'manual',
          entity_definition_id: entityDefinitionId,
          resource_id: entityInstanceId,
          triggered_at: new Date().toISOString(),
          [entityDefinitionId]: resourceData, // Store resource data under entity-specific key
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
          entityInstanceId,
          error: error instanceof Error ? error.message : String(error),
        })
      })

      logger.debug('Workflow run created', {
        entityInstanceId,
        workflowRunId: workflowRun.id,
      })

      return {
        resourceId: entityInstanceId,
        success: true,
        workflowRunId: workflowRun.id,
      }
    } catch (error) {
      logger.error('Failed to create workflow run', {
        entityInstanceId,
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        resourceId: entityInstanceId,
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
 * Supports both system resources (contact, ticket, etc.) and custom entities (UUID/CUID format)
 *
 * For system resources: Uses single batch query with IN clause
 * For custom entities: Fetches individually (no batch query available yet)
 *
 * @param resourceIds - Array of ResourceIds in format "entityDefinitionId:instanceId"
 * @param organizationId - Organization ID for scoping
 * @returns Map for O(1) lookup by instance ID
 */
async function fetchResourcesByIds(
  resourceIds: ResourceId[],
  organizationId: string
): Promise<Map<string, any>> {
  const resourcesMap = new Map<string, any>()

  // Parse all ResourceIds
  const parsedResources = resourceIds.map(parseResourceId)

  // Validate all have same entityDefinitionId
  const entityDefinitionIds = [...new Set(parsedResources.map(r => r.entityDefinitionId))]
  if (entityDefinitionIds.length > 1) {
    logger.error('Mixed entity types in batch fetch', { entityDefinitionIds })
    return resourcesMap
  }
  if (entityDefinitionIds.length === 0) {
    return resourcesMap
  }

  const entityDefinitionId = entityDefinitionIds[0]!
  const resourceType = entityDefinitionId
  const entityInstanceIds = parsedResources.map(r => r.entityInstanceId)

  // Handle custom entities (UUID/CUID format)
  if (isCustomResourceId(resourceType)) {
    // Fetch each entity instance individually
    // TODO: Implement batch fetch for entity instances when available
    const fetchPromises = resourceIds.map(async (resourceId) => {
      const resource = await fetchResourceById(resourceId, organizationId)
      if (resource) {
        // Use entityInstanceId as the key for lookup
        const { entityInstanceId } = parseResourceId(resourceId)
        resourcesMap.set(entityInstanceId, resource)
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

  // Build WHERE clause: id IN (...entityInstanceIds)
  const whereSql = inArray(schema[tableInfo.dbName].id, entityInstanceIds)

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
