// packages/lib/src/email/inbound/channel-resolver.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { PermanentProcessingError } from './errors'
import type { ForwardingIntegrationMetadata, ResolvedInboundIntegration } from './types'

const logger = createScopedLogger('inbound-channel-resolver')

/**
 * normalizeRecipient normalizes inbound recipient email addresses for matching.
 */
function normalizeRecipient(recipient: string): string {
  return recipient.trim().toLowerCase()
}

/**
 * getAllowedSenders extracts the forwarding allowlist from channel metadata.
 */
function getAllowedSenders(metadata: ForwardingIntegrationMetadata | null | undefined): string[] {
  if (!metadata || !Array.isArray(metadata.allowedSenders)) return []

  return metadata.allowedSenders
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

/**
 * InboundChannelResolver resolves a forwarded inbound recipient to a channel target.
 */
export class InboundChannelResolver {
  /**
   * resolve finds the first active forwarding channel for the provided recipients.
   */
  async resolve(recipients: string[]): Promise<ResolvedInboundIntegration> {
    const normalizedRecipients = recipients.map(normalizeRecipient).filter(Boolean)

    if (normalizedRecipients.length === 0) {
      throw new Error('Inbound email resolution requires at least one recipient')
    }

    const integrations = await db
      .select({
        organizationId: schema.Integration.organizationId,
        integrationId: schema.Integration.id,
        integrationEmail: schema.Integration.email,
        enabled: schema.Integration.enabled,
        provider: schema.Integration.provider,
        metadata: schema.Integration.metadata,
        inboxId: schema.InboxIntegration.inboxId,
      })
      .from(schema.Integration)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Integration.id)
      )
      .where(
        and(
          eq(schema.Integration.provider, 'email'),
          eq(schema.Integration.enabled, true),
          inArray(schema.Integration.email, normalizedRecipients),
          isNull(schema.Integration.deletedAt)
        )
      )

    const integrationByRecipient = new Map(
      integrations
        .filter((integration) => integration.integrationEmail)
        .map((integration) => [
          normalizeRecipient(integration.integrationEmail as string),
          integration,
        ])
    )

    for (const recipient of normalizedRecipients) {
      const integration = integrationByRecipient.get(recipient)

      if (!integration) continue

      const metadata = (integration.metadata ?? {}) as ForwardingIntegrationMetadata
      const resolved: ResolvedInboundIntegration = {
        organizationId: integration.organizationId,
        integrationId: integration.integrationId,
        inboxId: integration.inboxId ?? null,
        matchedRecipient: recipient,
        integrationEmail: integration.integrationEmail ?? null,
        metadata,
        allowedSenders: getAllowedSenders(metadata),
      }

      logger.info('Resolved inbound forwarding recipient', {
        matchedRecipient: resolved.matchedRecipient,
        organizationId: resolved.organizationId,
        integrationId: resolved.integrationId,
        inboxId: resolved.inboxId,
      })

      return resolved
    }

    throw new PermanentProcessingError(
      `No active forwarding channel found for recipients: ${normalizedRecipients.join(', ')}`,
      'integration_not_found'
    )
  }
}
