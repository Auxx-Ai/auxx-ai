// apps/api/src/routes/workflows/run/parameters.ts

import { Hono } from 'hono'
import { getWorkflowByApiKey } from '@auxx/services/workflow-share'
import { extractFormInputConfigs } from '@auxx/lib/workflow-engine'
import { createScopedLogger } from '@auxx/logger'
import { successResponse, errorResponse } from '../../../lib/response'

const logger = createScopedLogger('workflow-run-parameters')

/**
 * Parameters route for programmatic workflow access
 * GET /api/v1/workflows/run/parameters
 */
const parametersRoute = new Hono()

/**
 * Extract API key from Authorization header
 * Expects: Authorization: Bearer {api_key}
 */
function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7)
}

/**
 * GET /api/v1/workflows/run/parameters
 * Returns the input schema for a workflow
 * Requires API key authentication - workflow is identified by the API key
 */
parametersRoute.get('/', async (c) => {
  const authHeader = c.req.header('Authorization')
  const apiKey = extractApiKey(authHeader)

  if (!apiKey) {
    return c.json(
      errorResponse('UNAUTHORIZED', 'Missing Authorization header. Expected: Bearer {api_key}'),
      401
    )
  }

  // Get workflow by API key (validates key and checks apiEnabled)
  const workflowResult = await getWorkflowByApiKey({
    apiKey,
    includeGraph: true,
  })

  if (workflowResult.isErr()) {
    const error = workflowResult.error
    logger.warn('Failed to get workflow by API key', { error: error.code })

    if (error.code === 'INVALID_API_KEY') {
      return c.json(errorResponse(error.code, error.message), 401)
    }
    if (error.code === 'API_ACCESS_DISABLED') {
      return c.json(errorResponse(error.code, error.message), 403)
    }
    if (error.code === 'WORKFLOW_NOT_FOUND') {
      return c.json(errorResponse(error.code, error.message), 404)
    }
    if (error.code === 'WORKFLOW_DISABLED') {
      return c.json(errorResponse(error.code, error.message), 410)
    }
    return c.json(errorResponse('INTERNAL_ERROR', 'Failed to fetch workflow'), 500)
  }

  const workflow = workflowResult.value

  logger.info('API key validated for parameters', {
    workflowAppId: workflow.id,
    apiKeyId: workflow.apiKeyId,
  })

  // Extract input fields from workflow graph
  const inputConfigs = workflow.graph ? extractFormInputConfigs(workflow.graph) : []

  // Transform to API response format
  const inputs = inputConfigs.map((config) => ({
    key: config.nodeId,
    label: config.label,
    type: config.inputType,
    required: config.required ?? false,
    hint: config.hint,
    options:
      config.typeOptions?.enum?.map((opt) => ({
        label: opt.label,
        value: opt.value,
      })) ?? undefined,
    fileOptions: config.typeOptions?.file ?? undefined,
  }))

  return c.json(
    successResponse({
      workflowId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      inputs,
    })
  )
})

export default parametersRoute
