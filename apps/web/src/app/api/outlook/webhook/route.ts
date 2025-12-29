// apps/web/src/app/api/outlook/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { database as db, schema } from '@auxx/database'
import { MessageService, IntegrationProviderType } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
// Note: env import removed as not currently used

const logger = createScopedLogger('outlook-webhook')

// Microsoft Graph webhook notification interface
interface GraphWebhookNotification {
  subscriptionId: string
  clientState?: string
  changeType: 'created' | 'updated' | 'deleted'
  resource: string
  resourceData?: {
    '@odata.type': string
    '@odata.id': string
    id?: string
  }
  subscriptionExpirationDateTime: string
  tenantId?: string
}

interface GraphWebhookPayload {
  value: GraphWebhookNotification[]
}

/**
 * Verifies Microsoft Graph webhook notification by checking client state
 * @param notification - The webhook notification to verify
 * @param expectedClientState - The expected client state from integration metadata
 * @returns boolean indicating if verification passed
 */
function verifyClientState(
  notification: GraphWebhookNotification,
  expectedClientState: string
): boolean {
  if (!notification.clientState) {
    logger.warn('Missing clientState in webhook notification')
    return false
  }

  return notification.clientState === expectedClientState
}

/**
 * GET handler - Microsoft Graph subscription validation
 * During subscription setup, Microsoft sends a validationToken that must be echoed back
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const validationToken = searchParams.get('validationToken')

  if (validationToken) {
    logger.info('Received Microsoft Graph subscription validation request')
    // Echo back the validation token as plain text
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // Health check if no validation token
  return NextResponse.json({ status: 'ok', timestamp: Date.now() })
}

/**
 * POST handler - Process Microsoft Graph webhook notifications
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.info('Received Microsoft Graph webhook notification')

  try {
    const body: GraphWebhookPayload = await req.json()

    if (!body || !body.value || !Array.isArray(body.value)) {
      logger.error('Invalid Microsoft Graph webhook payload format', { body })
      return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
    }

    // Process each notification in the payload
    const results = await Promise.allSettled(
      body.value.map((notification) => processNotification(notification))
    )

    // Log any failures but still acknowledge the webhook
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length > 0) {
      logger.warn('Some notifications failed to process', {
        total: body.value.length,
        failures: failures.length,
      })
    }

    return NextResponse.json({
      success: true,
      processed: body.value.length,
      failures: failures.length,
    })
  } catch (error: any) {
    logger.error('Error processing Microsoft Graph webhook:', {
      error: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: 'Internal server error processing webhook' }, { status: 500 })
  }
}

/**
 * Process a single Microsoft Graph webhook notification
 * @param notification - The notification to process
 */
async function processNotification(notification: GraphWebhookNotification): Promise<void> {
  logger.debug('Processing notification', {
    subscriptionId: notification.subscriptionId,
    changeType: notification.changeType,
    resource: notification.resource,
  })

  // Find the integration by subscription ID
  const [integration] = await db
    .select({
      id: schema.Integration.id,
      organizationId: schema.Integration.organizationId,
      metadata: schema.Integration.metadata,
      updatedAt: schema.Integration.updatedAt,
    })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.provider, 'outlook'),
        eq(schema.Integration.enabled, true),
        sql`${schema.Integration.metadata} ->> 'graphSubscriptionId' = ${notification.subscriptionId}`
      )
    )
    .limit(1)

  if (!integration) {
    logger.warn('No active Outlook integration found for subscription ID', {
      subscriptionId: notification.subscriptionId,
    })
    // Don't throw error - acknowledge the webhook to prevent retries
    return
  }

  // Verify client state if present
  const metadata = integration.metadata as Record<string, any> | null
  const webhookSecret = metadata?.webhookSecret as string | undefined
  if (webhookSecret && !verifyClientState(notification, webhookSecret)) {
    logger.error('Client state verification failed', {
      integrationId: integration.id,
      subscriptionId: notification.subscriptionId,
    })
    throw new Error('Client state verification failed')
  }

  // Handle subscription expiration notifications
  const expirationTime = new Date(notification.subscriptionExpirationDateTime)
  const now = new Date()
  const hoursUntilExpiration = (expirationTime.getTime() - now.getTime()) / (1000 * 60 * 60)

  if (hoursUntilExpiration < 24) {
    logger.warn('Microsoft Graph subscription expiring soon', {
      integrationId: integration.id,
      subscriptionId: notification.subscriptionId,
      expiresAt: notification.subscriptionExpirationDateTime,
      hoursUntilExpiration: Math.round(hoursUntilExpiration * 100) / 100,
    })
    // TODO: Trigger subscription renewal logic
  }

  // Only process created and updated messages
  if (notification.changeType === 'created' || notification.changeType === 'updated') {
    logger.info('Triggering Outlook sync for integration', {
      integrationId: integration.id,
      organizationId: integration.organizationId,
      changeType: notification.changeType,
    })

    // Initialize message service and trigger sync
    const messageService = new MessageService(integration.organizationId)

    try {
      await messageService.syncMessages('outlook' as IntegrationProviderType, integration.id)
      logger.info('Outlook sync initiated successfully via webhook', {
        integrationId: integration.id,
      })
    } catch (syncError) {
      logger.error('Error during Outlook sync initiated by webhook', {
        error: syncError,
        integrationId: integration.id,
      })
      // Don't throw - log error but acknowledge webhook to prevent retries
    }
  } else {
    logger.debug('Ignoring notification with changeType', {
      changeType: notification.changeType,
      integrationId: integration.id,
    })
  }
}
