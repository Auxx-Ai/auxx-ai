// apps/api/src/routes/webhooks.ts

import { LAMBDA_API_URL, SERVER_FUNCTION_EXECUTOR_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getWebhookHandler } from '@auxx/services/app-webhook-handlers'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

const log = createScopedLogger('webhooks-receiver')

const webhooks = new Hono<AppContext>()

/**
 * Handle webhook request (both POST and GET for verification)
 */
async function handleWebhookRequest(c: any) {
  const installationId = c.req.param('installationId')
  const handlerId = c.req.param('handlerId')

  log.info('Webhook request received', { installationId, handlerId, method: c.req.method })

  try {
    // 1. Validate webhook handler exists
    const handlerResult = await getWebhookHandler({
      appInstallationId: installationId,
      handlerId,
    })

    if (handlerResult.isErr()) {
      log.warn('Webhook handler not found', { installationId, handlerId })
      return c.json(errorResponse('NOT_FOUND', 'Webhook handler not found'), 404)
    }

    // 2. Get app installation and bundle (with organization)
    const installationResult = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, installationId),
      with: {
        organization: {
          columns: {
            id: true,
            handle: true,
          },
        },
      },
    })

    if (!installationResult || !installationResult.currentVersionId) {
      log.error('Installation not found or no version', { installationId })
      return c.json(errorResponse('NOT_FOUND', 'Installation not found'), 404)
    }

    const [versionBundle] = await database
      .select()
      .from(schema.AppVersionBundle)
      .where(eq(schema.AppVersionBundle.appVersionId, installationResult.currentVersionId))
      .limit(1)

    if (!versionBundle?.serverBundleS3Key) {
      log.error('Server bundle not found', { installationId })
      return c.json(errorResponse('NOT_FOUND', 'Server bundle not found'), 500)
    }

    // 3. Convert request to serializable format
    const body = await c.req.text()
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value: string, key: string) => {
      headers[key] = value
    })

    const webRequest = {
      method: c.req.method,
      url: c.req.url,
      headers,
      body,
    }

    // 4. Get Lambda executor URL from environment
    const executorUrl = SERVER_FUNCTION_EXECUTOR_URL
    // const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

    log.info('Invoking Lambda for webhook execution', { executorUrl, handlerId })

    // 5. Invoke Lambda via HTTP (works in dev AND production)
    const response = await fetch(executorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webhook',
        bundleKey: versionBundle.serverBundleS3Key,
        handlerId,
        request: webRequest,
        context: {
          organizationId: installationResult.organizationId,
          organizationHandle: installationResult.organization.handle,
          appId: installationResult.appId,
          appInstallationId: installationId,
          apiUrl: LAMBDA_API_URL,
          // Webhooks don't have user context - use system defaults
          userId: 'system',
          userEmail: 'system@webhook',
          // Connection data will be fetched by Lambda if needed
        },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      log.error('Webhook execution failed', { error: errorData, installationId, handlerId })
      return c.json(errorResponse('EXECUTION_ERROR', 'Webhook execution failed'), 500)
    }

    const result = await response.json()

    // 6. Return handler's response to third-party service
    const handlerExecutionResult = result.execution_result

    log.info('Webhook execution completed', {
      status: handlerExecutionResult.status,
      installationId,
      handlerId,
    })

    return new Response(handlerExecutionResult.body, {
      status: handlerExecutionResult.status,
      headers: handlerExecutionResult.headers || {},
    })
  } catch (error: any) {
    log.error('Webhook receiver error', { error: error.message, installationId, handlerId })
    return c.json(errorResponse('INTERNAL_ERROR', 'Internal server error'), 500)
  }
}

// Support both POST and GET (for webhook verification)
webhooks.post('/:installationId/:handlerId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId', handleWebhookRequest)

export default webhooks
