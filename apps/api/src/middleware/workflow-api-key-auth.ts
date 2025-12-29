// apps/api/src/middleware/workflow-api-key-auth.ts

import { createMiddleware } from 'hono/factory'
import { validateWorkflowApiKey } from '@auxx/services/workflow-share'
import { createScopedLogger } from '@auxx/logger'
import { errorResponse } from '../lib/response'

const logger = createScopedLogger('workflow-api-key-auth')

/**
 * Context type for workflow API key authentication
 */
export type WorkflowApiKeyContext = {
  Variables: {
    workflowAppId: string
    apiKeyValidation: {
      isValid: boolean
      apiKeyId?: string
    }
  }
}

/**
 * Extract API key from Authorization header
 * Expects: Authorization: Bearer {api_key}
 */
function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7) // Remove 'Bearer ' prefix
}

/**
 * Middleware to validate workflow API key
 * Requires workflowAppId to be set in context before this middleware runs
 * Sets c.set('apiKeyValidation', { isValid, apiKeyId }) on success
 */
export const workflowApiKeyAuthMiddleware = createMiddleware<WorkflowApiKeyContext>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization')
    const apiKey = extractApiKey(authHeader)

    if (!apiKey) {
      return c.json(
        errorResponse('UNAUTHORIZED', 'Missing Authorization header. Expected: Bearer {api_key}'),
        401
      )
    }

    // workflowAppId should be set by earlier middleware/handler that resolved the shareToken
    const workflowAppId = c.get('workflowAppId')

    if (!workflowAppId) {
      logger.error('workflowAppId not set in context for API key auth')
      return c.json(errorResponse('INTERNAL_ERROR', 'Workflow context not available'), 500)
    }

    const validationResult = await validateWorkflowApiKey({
      workflowAppId,
      apiKey,
    })

    if (validationResult.isErr()) {
      logger.warn('API key validation failed', {
        workflowAppId,
        error: validationResult.error.message,
      })
      return c.json(errorResponse('UNAUTHORIZED', 'Invalid or expired API key'), 401)
    }

    if (!validationResult.value.isValid) {
      logger.warn('API key not valid for workflow', { workflowAppId })
      return c.json(errorResponse('UNAUTHORIZED', 'Invalid or expired API key'), 401)
    }

    // Set validation result for downstream handlers
    c.set('apiKeyValidation', validationResult.value)

    await next()
  }
)

/**
 * Helper function to validate API key for a workflow (non-middleware version)
 * Used when conditional authentication is needed based on access mode
 */
export async function validateApiKeyForWorkflow(
  authHeader: string | undefined,
  workflowAppId: string
): Promise<{ isValid: boolean; apiKeyId?: string; error?: string }> {
  const apiKey = extractApiKey(authHeader)

  if (!apiKey) {
    return { isValid: false, error: 'Missing Authorization header. Expected: Bearer {api_key}' }
  }

  const validationResult = await validateWorkflowApiKey({
    workflowAppId,
    apiKey,
  })

  if (validationResult.isErr()) {
    logger.warn('API key validation failed', {
      workflowAppId,
      error: validationResult.error.message,
    })
    return { isValid: false, error: 'Invalid or expired API key' }
  }

  if (!validationResult.value.isValid) {
    return { isValid: false, error: 'Invalid or expired API key' }
  }

  return {
    isValid: true,
    apiKeyId: validationResult.value.apiKeyId,
  }
}
