// packages/seed/src/utils/organization-webhook-coordinator.ts
// Coordinates webhook disconnection and reconnection for organization-specific seeding

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('org-webhook-coordinator')

/** WebhookDisconnectResult stores metadata needed to reconnect webhooks */
export interface WebhookDisconnectResult {
  /** email stores Google/Outlook integrations that were disconnected */
  email: Array<{ id: string; provider: string }>
  /** shopify stores Shopify integrations that were disconnected */
  shopify: Array<{ id: string }>
}

/**
 * OrganizationWebhookCoordinator manages webhook lifecycle during organization seeding.
 * Disconnects webhooks before seeding to prevent stale data, then reconnects after.
 */
export class OrganizationWebhookCoordinator {
  constructor(private organizationId: string) {}

  /**
   * Disconnect all webhooks for organization's integrations.
   * Returns metadata needed to reconnect.
   */
  async disconnectAll(): Promise<WebhookDisconnectResult> {
    logger.info('Disconnecting webhooks for organization', {
      organizationId: this.organizationId,
    })

    const disconnected: WebhookDisconnectResult = {
      email: [],
      shopify: [],
    }

    try {
      // Fetch all integrations for this organization
      logger.info('Fetching integrations for webhook disconnect')
      const integrations = await db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          organizationId: schema.Integration.organizationId,
        })
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, this.organizationId))
      logger.info('Integrations fetched', { count: integrations.length })

      logger.info('Fetching shopify integrations for webhook disconnect')
      const shopifyIntegrations = await db
        .select({
          id: schema.ShopifyIntegration.id,
          organizationId: schema.ShopifyIntegration.organizationId,
        })
        .from(schema.ShopifyIntegration)
        .where(eq(schema.ShopifyIntegration.organizationId, this.organizationId))
      logger.info('Shopify integrations fetched', { count: shopifyIntegrations.length })

      // Disconnect email integrations (Google, Outlook)
      for (const integration of integrations) {
        if (integration.provider === 'google' || integration.provider === 'outlook') {
          try {
            // Dynamically import to avoid circular dependencies
            const { WebhookManagerService } = await import('@auxx/lib/providers')
            const { ProviderRegistryService } = await import('@auxx/lib/providers')

            const providerRegistry = new ProviderRegistryService(this.organizationId)
            const webhookManager = new WebhookManagerService(this.organizationId, providerRegistry)

            await webhookManager.removeWebhooks(integration.provider as any, integration.id)

            disconnected.email.push({
              id: integration.id,
              provider: integration.provider,
            })

            logger.info('Disconnected webhook', {
              integrationId: integration.id,
              provider: integration.provider,
            })
          } catch (error) {
            logger.error('Failed to disconnect webhook', {
              integrationId: integration.id,
              provider: integration.provider,
              error,
            })
            // Continue with other integrations even if one fails
          }
        }
      }

      // Disconnect Shopify integrations
      for (const integration of shopifyIntegrations) {
        try {
          // Dynamically import to avoid circular dependencies
          const { disableWebhooks } = await import('@auxx/lib/shopify')

          await disableWebhooks(integration.id)

          disconnected.shopify.push({ id: integration.id })

          logger.info('Disabled Shopify webhooks', {
            integrationId: integration.id,
          })
        } catch (error) {
          logger.error('Failed to disable Shopify webhooks', {
            integrationId: integration.id,
            error,
          })
          // Continue with other integrations even if one fails
        }
      }

      logger.info('Webhook disconnection completed', {
        organizationId: this.organizationId,
        emailCount: disconnected.email.length,
        shopifyCount: disconnected.shopify.length,
      })

      return disconnected
    } catch (error) {
      logger.error('Failed to disconnect webhooks', {
        organizationId: this.organizationId,
        error,
      })
      throw error
    }
  }

  /**
   * Reconnect webhooks using disconnect result metadata.
   */
  async reconnectAll(disconnectResult: WebhookDisconnectResult): Promise<void> {
    logger.info('Reconnecting webhooks for organization', {
      organizationId: this.organizationId,
      emailCount: disconnectResult.email.length,
      shopifyCount: disconnectResult.shopify.length,
    })

    let successCount = 0
    let failureCount = 0

    try {
      // Reconnect email integrations
      if (disconnectResult.email.length > 0) {
        const { WebhookManagerService } = await import('@auxx/lib/providers')
        const { ProviderRegistryService } = await import('@auxx/lib/providers')

        const providerRegistry = new ProviderRegistryService(this.organizationId)
        const webhookManager = new WebhookManagerService(this.organizationId, providerRegistry)

        for (const { id, provider } of disconnectResult.email) {
          try {
            await webhookManager.setupWebhooks(provider as any, id)

            logger.info('Reconnected webhook', {
              integrationId: id,
              provider,
            })

            successCount++
          } catch (error) {
            logger.error('Failed to reconnect webhook', {
              integrationId: id,
              provider,
              error,
            })
            failureCount++
            // Continue with other integrations even if one fails
          }
        }
      }

      // Reconnect Shopify integrations
      if (disconnectResult.shopify.length > 0) {
        const { setupShopifyWebhooks } = await import('@auxx/lib/shopify')

        for (const { id } of disconnectResult.shopify) {
          try {
            await setupShopifyWebhooks(id)

            logger.info('Reconnected Shopify webhooks', {
              integrationId: id,
            })

            successCount++
          } catch (error) {
            logger.error('Failed to reconnect Shopify webhooks', {
              integrationId: id,
              error,
            })
            failureCount++
            // Continue with other integrations even if one fails
          }
        }
      }

      logger.info('Webhook reconnection completed', {
        organizationId: this.organizationId,
        successCount,
        failureCount,
      })

      if (failureCount > 0) {
        logger.warn(
          `${failureCount} webhook(s) failed to reconnect. Manual intervention may be required.`
        )
      }
    } catch (error) {
      logger.error('Failed to reconnect webhooks', {
        organizationId: this.organizationId,
        error,
      })
      throw error
    }
  }
}
