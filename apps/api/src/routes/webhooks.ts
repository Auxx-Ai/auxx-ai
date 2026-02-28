// apps/api/src/routes/webhooks.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getWebhookHandler } from '@auxx/services/app-webhook-handlers'
import { invokeLambdaExecutor, prepareLambdaContext } from '@auxx/services/lambda-execution'
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

    log.info('Invoking Lambda for webhook execution', { handlerId })

    // 4. Build context and invoke Lambda via shared helper
    const context = prepareLambdaContext({
      appId: installationResult.appId,
      installationId,
      organizationId: installationResult.organizationId,
      organizationHandle: installationResult.organization.handle,
      userId: 'system',
      userEmail: 'system@webhook',
      userName: null,
    })

    const lambdaResult = await invokeLambdaExecutor({
      caller: 'webhook-route',
      payload: {
        type: 'webhook',
        bundleKey: versionBundle.serverBundleS3Key,
        handlerId,
        request: webRequest,
        context,
      },
    })

    if (lambdaResult.isErr()) {
      const error = lambdaResult.error
      log.error('Webhook execution failed', { error, installationId, handlerId })
      return c.json(errorResponse('EXECUTION_ERROR', 'Webhook execution failed'), 500)
    }

    const result = lambdaResult.value

    // 5. Return handler's response to third-party service
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
