// apps/web/src/app/api/outlook/webhook/shared.ts

import { database as db, schema } from '@auxx/database'
import { timingSafeStringEqual } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createScopedLogger('outlook-webhook')

/** Microsoft Graph change notification (main webhook route). */
export interface GraphWebhookNotification {
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

export interface GraphWebhookPayload {
  value: GraphWebhookNotification[]
}

export interface OutlookIntegrationRow {
  id: string
  organizationId: string
  metadata: Record<string, any> | null
}

/**
 * `metadata.outlookSubscription.clientState`, falling back to the legacy flat
 * `metadata.webhookSecret` key for one release (plan §1.2 metadata migration).
 */
export function getStoredClientState(
  metadata: Record<string, any> | null | undefined
): string | undefined {
  return metadata?.outlookSubscription?.clientState ?? metadata?.webhookSecret
}

/**
 * Resolve the Outlook integration a Graph `subscriptionId` belongs to.
 *
 * Prefers the indexed `webhookRouteKey` column (plan §3.4 — a lookup key belongs in a column,
 * not an unindexed jsonb scan). Falls back to the legacy `metadata->>'graphSubscriptionId'` scan
 * for one release of deploy-skew tolerance, per plan Phase 1.2.
 */
export async function resolveIntegrationBySubscriptionId(
  subscriptionId: string
): Promise<OutlookIntegrationRow | undefined> {
  const [byColumn] = await db
    .select({
      id: schema.Integration.id,
      organizationId: schema.Integration.organizationId,
      metadata: schema.Integration.metadata,
    })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.provider, 'outlook'),
        eq(schema.Integration.enabled, true),
        isNull(schema.Integration.deletedAt),
        eq(schema.Integration.webhookRouteKey, subscriptionId)
      )
    )
    .limit(1)

  if (byColumn) return byColumn as OutlookIntegrationRow

  const [byLegacyMetadata] = await db
    .select({
      id: schema.Integration.id,
      organizationId: schema.Integration.organizationId,
      metadata: schema.Integration.metadata,
    })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.provider, 'outlook'),
        eq(schema.Integration.enabled, true),
        isNull(schema.Integration.deletedAt),
        sql`${schema.Integration.metadata} ->> 'graphSubscriptionId' = ${subscriptionId}`
      )
    )
    .limit(1)

  return byLegacyMetadata as OutlookIntegrationRow | undefined
}

/**
 * Verifies a Graph notification's `clientState` against the integration's stored secret — our
 * only authenticity signal (plan §2.7). Never throws: an unverifiable notification must be
 * dropped, not turned into a 500 (Graph would just retry a notification we will never accept).
 */
export function verifyClientState(
  notification: { clientState?: string },
  expectedClientState: string
): boolean {
  if (!notification.clientState) {
    logger.warn('Missing clientState in webhook notification')
    return false
  }

  return timingSafeStringEqual(notification.clientState, expectedClientState)
}

/**
 * Build the subscription-validation handshake response.
 *
 * Graph requires HTTP 200, `text/plain`, and the URL-decoded token as the entire
 * body, within 10 seconds — anything else and the subscription is never created.
 * `searchParams.get` already returns the decoded value.
 */
export function validationResponse(validationToken: string): NextResponse {
  logger.info('Received Microsoft Graph subscription validation request')
  return new NextResponse(validationToken, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}
