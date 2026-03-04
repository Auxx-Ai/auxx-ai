// apps/api/src/routes/webhooks.ts

import { database } from '@auxx/database'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { getWebhookHandler } from '@auxx/services/app-webhook-handlers'
import { invokeLambdaExecutor, prepareLambdaContext } from '@auxx/services/lambda-execution'
import { randomUUID } from 'crypto'
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
  const connectionId = c.req.param('connectionId') as string | undefined

  log.info('Webhook request received', { installationId, handlerId, method: c.req.method })

  try {
    // 1. Validate webhook handler exists
    const handlerResult = await getWebhookHandler({
      appInstallationId: installationId,
      handlerId,
      connectionId,
    })

    if (handlerResult.isErr()) {
      log.warn('Webhook handler not found', { installationId, handlerId })
      return c.json(errorResponse('NOT_FOUND', 'Webhook handler not found'), 404)
    }

    // 2. Get app installation with current deployment and bundles
    const installation = await database.query.AppInstallation.findFirst({
      where: (inst, { eq }) => eq(inst.id, installationId),
      with: {
        organization: {
          columns: {
            id: true,
            handle: true,
          },
        },
        currentDeployment: {
          with: {
            serverBundle: true,
          },
        },
      },
    })

    if (!installation || !installation.currentDeployment) {
      log.error('Installation not found or no active deployment', { installationId })
      return c.json(errorResponse('NOT_FOUND', 'Installation not found'), 404)
    }

    const { currentDeployment } = installation
    const serverBundleSha = currentDeployment.serverBundle.sha256

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
      appId: installation.appId,
      installationId,
      organizationId: installation.organizationId,
      organizationHandle: installation.organization.handle,
      userId: 'system',
      userEmail: 'system@webhook',
      userName: null,
    })

    const lambdaResult = await invokeLambdaExecutor({
      caller: 'webhook-route',
      payload: {
        type: 'webhook',
        serverBundleSha,
        appId: installation.appId,
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

    // 6. If handler returned trigger data and handler has a triggerId, enqueue dispatch job
    const handler = handlerResult.value
    if (handlerExecutionResult.triggerData && handler.triggerId) {
      try {
        const appTriggerQueue = getQueue(Queues.appTriggerQueue)
        await appTriggerQueue.add('dispatchAppTrigger', {
          appInstallationId: installationId,
          appId: installation.appId,
          triggerId: handler.triggerId,
          connectionId: handler.connectionId ?? undefined,
          triggerData: handlerExecutionResult.triggerData,
          eventId: handlerExecutionResult.eventId || randomUUID(),
          organizationId: installation.organizationId,
        })

        log.info('Enqueued app trigger dispatch', {
          installationId,
          appId: installation.appId,
          triggerId: handler.triggerId,
          eventId: handlerExecutionResult.eventId,
        })
      } catch (dispatchError: any) {
        // Don't fail the webhook response if dispatch fails — log and continue
        log.error('Failed to enqueue app trigger dispatch', {
          error: dispatchError.message,
          installationId,
          handlerId,
          triggerId: handler.triggerId,
        })
      }
    }

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
// Connection-scoped routes (must be registered first to avoid ambiguity)
webhooks.post('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId/:connectionId', handleWebhookRequest)
// Legacy routes (no connectionId)
webhooks.post('/:installationId/:handlerId', handleWebhookRequest)
webhooks.get('/:installationId/:handlerId', handleWebhookRequest)

export default webhooks
