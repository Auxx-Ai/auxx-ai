// packages/lib/src/providers/webhook-manager-service.ts
import { WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { ProviderRegistryService } from './provider-registry-service'
import { resolveEffectiveSyncMode } from './sync-mode-resolver'
import type { ChannelProviderType } from './types'

const logger = createScopedLogger('webhook-manager-service')

/**
 * WebhookManagerService - Webhook lifecycle management extracted from MessageService
 *
 * Responsibilities:
 * - Webhook registration and unregistration
 * - Callback URL management and validation
 * - Bulk webhook operations across integrations
 * - Webhook error handling and recovery
 *
 * Does NOT handle:
 * - Provider initialization/management
 * - Message sending operations
 * - Message synchronization
 * - Database record creation
 */
export class WebhookManagerService {
  constructor(
    private organizationId: string,
    private providerRegistry: ProviderRegistryService
  ) {}

  /**
   * Register webhooks for a specific integration type or ID
   * Extracted from MessageService.registerWebhooks
   */
  async setupWebhooks(integrationType: ChannelProviderType, integrationId?: string): Promise<void> {
    try {
      // Build callback URL based on environment and provider type
      const baseUrl = WEBAPP_URL
      const callbackUrl = `${baseUrl}/api/${integrationType}/webhook`

      if (integrationId) {
        logger.info(`Registering webhook for specific integration`, {
          organizationId: this.organizationId,
          integrationType,
          integrationId,
        })

        // Ensure the provider instance exists before setting up webhook
        await this.providerRegistry.getProvider(integrationId)
        await this.setupWebhook(integrationType, integrationId, callbackUrl)
      } else {
        logger.info(
          `Registering webhooks for all enabled integrations of type ${integrationType}`,
          { organizationId: this.organizationId }
        )

        // Find all enabled integrations of this type for the org
        const integrations = await db
          .select({ id: schema.Integration.id })
          .from(schema.Integration)
          .where(
            and(
              eq(schema.Integration.organizationId, this.organizationId),
              eq(schema.Integration.provider, integrationType),
              eq(schema.Integration.enabled, true)
            )
          )

        if (integrations.length === 0) {
          logger.warn(
            `No enabled integrations found for type ${integrationType} to register webhooks.`,
            { organizationId: this.organizationId }
          )
          return
        }

        for (const integration of integrations) {
          try {
            // Ensure provider instance exists
            await this.providerRegistry.getProvider(integration.id)
            await this.setupWebhook(integrationType, integration.id, callbackUrl)
          } catch (singleError) {
            logger.error(`Failed to register webhook for integration ${integration.id}`, {
              error: singleError,
              organizationId: this.organizationId,
              integrationType,
            })
            // Continue with the next integration
          }
        }
      }

      logger.info('Webhook registration process completed.', {
        organizationId: this.organizationId,
        integrationType,
        integrationId: integrationId || 'all enabled integrations',
      })
    } catch (error) {
      logger.error('Failed to register webhooks:', {
        error,
        organizationId: this.organizationId,
        integrationType,
        integrationId,
      })
      throw error
    }
  }

  /**
   * Unregister webhooks for a specific integration type or ID
   * Extracted from MessageService.unregisterWebhooks
   */
  async removeWebhooks(
    integrationType: ChannelProviderType,
    integrationId?: string
  ): Promise<void> {
    try {
      if (integrationId) {
        logger.info(`Unregistering webhook for specific integration`, {
          organizationId: this.organizationId,
          integrationType,
          integrationId,
        })

        // Ensure provider instance exists before removing webhook
        await this.providerRegistry.getProvider(integrationId)
        await this.removeWebhook(integrationType, integrationId)
      } else {
        logger.info(`Unregistering webhooks for all integrations of type ${integrationType}`, {
          organizationId: this.organizationId,
        })

        // Find all integrations of this type (even disabled ones might have lingering webhooks)
        const integrations = await db
          .select({ id: schema.Integration.id })
          .from(schema.Integration)
          .where(
            and(
              eq(schema.Integration.organizationId, this.organizationId),
              eq(schema.Integration.provider, integrationType)
            )
          )

        if (integrations.length === 0) {
          logger.warn(`No integrations found for type ${integrationType} to unregister webhooks.`, {
            organizationId: this.organizationId,
          })
          return
        }

        for (const integration of integrations) {
          try {
            // Ensure provider instance exists
            await this.providerRegistry.getProvider(integration.id)
            await this.removeWebhook(integrationType, integration.id)
          } catch (singleError) {
            logger.error(`Failed to unregister webhook for integration ${integration.id}`, {
              error: singleError,
              organizationId: this.organizationId,
              integrationType,
            })
            // Continue with the next integration
          }
        }
      }

      logger.info('Webhook unregistration process completed.', {
        organizationId: this.organizationId,
        integrationType,
        integrationId: integrationId || 'all integrations',
      })
    } catch (error) {
      logger.error('Failed to unregister webhooks:', {
        error,
        organizationId: this.organizationId,
        integrationType,
        integrationId,
      })
      throw error
    }
  }

  /**
   * Setup webhook for a specific provider instance
   * Extracted from MessageService.setupWebhook
   */
  async setupWebhook(
    type: ChannelProviderType,
    integrationId: string,
    callbackUrl: string
  ): Promise<void> {
    try {
      // Skip webhook setup for polling-mode integrations
      const [integration] = await db
        .select({ syncMode: schema.Integration.syncMode, provider: schema.Integration.provider })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (integration) {
        const effectiveMode = resolveEffectiveSyncMode({
          syncMode: integration.syncMode,
          provider: integration.provider,
        })
        if (effectiveMode === 'polling') {
          logger.info('Skipping webhook setup — integration uses polling mode', {
            integrationId,
            provider: type,
          })
          return
        }
      }

      const provider = await this.providerRegistry.getProvider(integrationId)

      logger.info('Setting up webhook for provider:', {
        provider: type,
        integrationId,
        callbackUrl,
        organizationId: this.organizationId,
      })

      await provider.setupWebhook(callbackUrl)

      logger.info(`Webhook setup successful for ${type} - ${integrationId}`)
    } catch (error) {
      logger.error('Error setting up webhook:', {
        error,
        type,
        integrationId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Remove webhook for a specific provider instance
   * Extracted from MessageService.removeWebhook
   */
  async removeWebhook(type: ChannelProviderType, integrationId: string): Promise<void> {
    try {
      const provider = await this.providerRegistry.getProvider(integrationId)

      logger.info('Removing webhook for provider:', {
        provider: type,
        integrationId,
        organizationId: this.organizationId,
      })

      await provider.removeWebhook()

      logger.info(`Webhook removal successful for ${type} - ${integrationId}`)
    } catch (error) {
      logger.error('Error removing webhook:', {
        error,
        type,
        integrationId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Build callback URL for a specific provider type
   */
  private buildCallbackUrl(providerType: ChannelProviderType): string {
    const baseUrl = WEBAPP_URL
    return `${baseUrl}/api/${providerType}/webhook`
  }

  /**
   * Validate callback URL format
   */
  private validateCallbackUrl(callbackUrl: string): boolean {
    try {
      const url = new URL(callbackUrl)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  /**
   * Setup webhooks for all provider types with a single call
   */
  async setupAllWebhooks(integrationTypes?: ChannelProviderType[]): Promise<void> {
    const types = integrationTypes || ['google', 'outlook', 'facebook', 'instagram', 'openphone']

    logger.info('Setting up webhooks for all provider types', {
      organizationId: this.organizationId,
      types,
    })

    const setupPromises = types.map((type) =>
      this.setupWebhooks(type).catch((error) => {
        logger.error(`Failed to setup webhooks for ${type}`, {
          error,
          organizationId: this.organizationId,
        })
        return { type, error }
      })
    )

    const results = await Promise.allSettled(setupPromises)

    logger.info('Bulk webhook setup completed', {
      organizationId: this.organizationId,
      results: results.map((result, index) => ({
        type: types[index],
        status: result.status,
      })),
    })
  }

  /**
   * Remove webhooks for all provider types
   */
  async removeAllWebhooks(integrationTypes?: ChannelProviderType[]): Promise<void> {
    const types = integrationTypes || ['google', 'outlook', 'facebook', 'instagram', 'openphone']

    logger.info('Removing webhooks for all provider types', {
      organizationId: this.organizationId,
      types,
    })

    const removePromises = types.map((type) =>
      this.removeWebhooks(type).catch((error) => {
        logger.error(`Failed to remove webhooks for ${type}`, {
          error,
          organizationId: this.organizationId,
        })
        return { type, error }
      })
    )

    const results = await Promise.allSettled(removePromises)

    logger.info('Bulk webhook removal completed', {
      organizationId: this.organizationId,
      results: results.map((result, index) => ({
        type: types[index],
        status: result.status,
      })),
    })
  }
}
