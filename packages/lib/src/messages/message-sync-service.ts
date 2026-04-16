// packages/lib/src/messages/message-sync-service.ts
import { database as db, schema } from '@auxx/database'
import { IntegrationAuthStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { ProviderRegistryService } from '../providers/provider-registry-service'
import type { ChannelProviderType } from '../providers/types'

const logger = createScopedLogger('message-sync-service')

/**
 * MessageSyncService - Provider synchronization operations extracted from MessageService
 *
 * Responsibilities:
 * - Message synchronization with external providers
 * - Sync result processing and error recovery
 * - Bulk sync operations across multiple providers
 * - Last sync timestamp management
 *
 * Does NOT handle:
 * - Provider initialization/management
 * - Message sending operations
 * - Webhook management
 * - Database record creation (beyond sync tracking)
 */
export class MessageSyncService {
  constructor(
    private organizationId: string,
    private providerRegistry: ProviderRegistryService
  ) {}

  /**
   * Synchronize messages for a specific provider instance
   * Extracted from MessageService.syncMessages
   */
  async syncMessages(
    type: ChannelProviderType,
    integrationId: string,
    since?: Date
  ): Promise<void> {
    const provider = await this.providerRegistry.getProvider(integrationId)

    try {
      logger.info('Syncing messages from provider:', {
        provider: type,
        integrationId,
        since: since ? since.toISOString() : 'provider default',
        organizationId: this.organizationId,
      })

      // Call provider's sync method
      await provider.syncMessages(since)

      // Single write: stamp lastSyncedAt, mark authenticated, clear failure counter in metadata.
      // Replaces the previous two-step update (lastSyncedAt UPDATE + resetFailureCounter SELECT+UPDATE).
      const now = new Date()
      await db
        .update(schema.Integration)
        .set({
          lastSyncedAt: now,
          authStatus: IntegrationAuthStatus.AUTHENTICATED,
          metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object(
            'auth',
            COALESCE(${schema.Integration.metadata}->'auth', '{}'::jsonb) || jsonb_build_object(
              'consecutiveFailures', 0,
              'lastSuccessAt', ${now.toISOString()}::text
            )
          )`,
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info(`Sync completed and lastSyncedAt updated for ${type} - ${integrationId}`)
    } catch (error) {
      logger.error('Error syncing messages:', {
        error,
        type,
        integrationId,
        organizationId: this.organizationId,
      })

      throw error
    }
  }

  /**
   * Sync messages for all initialized providers
   * Extracted from MessageService.syncAllMessages
   */
  async syncAllMessages(since?: Date): Promise<void> {
    // Ensure all providers are initialized
    await this.providerRegistry.initializeAll()

    const providerInstances = this.providerRegistry.getAllProviderInstances()

    if (providerInstances.length === 0) {
      logger.warn('No providers initialized, skipping syncAllMessages.', {
        organizationId: this.organizationId,
      })
      return
    }

    logger.info(`Starting sync for all ${providerInstances.length} initialized providers.`, {
      since: since?.toISOString(),
      organizationId: this.organizationId,
    })

    const syncPromises = providerInstances.map(({ type, integrationId }) =>
      this.syncMessages(type, integrationId, since).catch((error) => {
        // Log error for this specific provider but don't stop others
        logger.error(`Sync failed for provider ${type} - ${integrationId}`, {
          error,
          organizationId: this.organizationId,
        })
        // Return error info for Promise.allSettled tracking
        return { status: 'rejected', reason: error, type, integrationId }
      })
    )

    // Wait for all sync operations to complete or fail
    const results = await Promise.allSettled(syncPromises)

    // Process and log sync results
    await this.processSyncResults(results, providerInstances)

    logger.info('Sync all messages process completed.', {
      totalProviders: providerInstances.length,
      organizationId: this.organizationId,
    })
  }

  /**
   * Sync messages for specific provider types only
   */
  async syncMessagesByType(providerTypes: ChannelProviderType[], since?: Date): Promise<void> {
    logger.info('Starting selective sync by provider types', {
      providerTypes,
      since: since?.toISOString(),
      organizationId: this.organizationId,
    })

    const allProviders = this.providerRegistry.getAllProviderInstances()
    const filteredProviders = allProviders.filter((provider) =>
      providerTypes.includes(provider.type)
    )

    if (filteredProviders.length === 0) {
      logger.warn('No providers found for specified types', {
        providerTypes,
        organizationId: this.organizationId,
      })
      return
    }

    const syncPromises = filteredProviders.map(({ type, integrationId }) =>
      this.syncMessages(type, integrationId, since).catch((error) => {
        logger.error(`Sync failed for provider ${type} - ${integrationId}`, {
          error,
          organizationId: this.organizationId,
        })
        return { status: 'rejected', reason: error, type, integrationId }
      })
    )

    const results = await Promise.allSettled(syncPromises)
    await this.processSyncResults(results, filteredProviders)

    logger.info('Selective sync by provider types completed.', {
      providerTypes,
      syncedProviders: filteredProviders.length,
      organizationId: this.organizationId,
    })
  }

  /**
   * Get the last sync timestamp for a specific integration
   */
  async getLastSyncTimestamp(integrationId: string): Promise<Date | null> {
    try {
      const [integration] = await db
        .select({ lastSyncedAt: schema.Integration.lastSyncedAt })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      return integration?.lastSyncedAt || null
    } catch (error) {
      logger.error('Error getting last sync timestamp', {
        error,
        integrationId,
        organizationId: this.organizationId,
      })
      return null
    }
  }

  /**
   * Get sync status for all integrations in the organization
   */
  async getSyncStatus(): Promise<
    Array<{
      integrationId: string
      providerType: string
      lastSyncedAt: Date | null
      enabled: boolean
    }>
  > {
    try {
      const integrations = await db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          lastSyncedAt: schema.Integration.lastSyncedAt,
          enabled: schema.Integration.enabled,
        })
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, this.organizationId))

      return integrations.map((integration) => ({
        integrationId: integration.id,
        providerType: integration.provider,
        lastSyncedAt: integration.lastSyncedAt,
        enabled: integration.enabled,
      }))
    } catch (error) {
      logger.error('Error getting sync status', {
        error,
        organizationId: this.organizationId,
      })
      return []
    }
  }

  /**
   * Force sync for stale integrations (not synced within specified hours)
   */
  async syncStaleIntegrations(maxHoursSinceLastSync: number = 24): Promise<void> {
    const staleThreshold = new Date(Date.now() - maxHoursSinceLastSync * 60 * 60 * 1000)

    logger.info('Starting sync for stale integrations', {
      maxHoursSinceLastSync,
      staleThreshold: staleThreshold.toISOString(),
      organizationId: this.organizationId,
    })

    const staleIntegrations = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
        lastSyncedAt: schema.Integration.lastSyncedAt,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, this.organizationId),
          eq(schema.Integration.enabled, true),
          or(
            isNull(schema.Integration.lastSyncedAt),
            lt(schema.Integration.lastSyncedAt, staleThreshold)
          )
        )
      )

    if (staleIntegrations.length === 0) {
      logger.info('No stale integrations found', {
        organizationId: this.organizationId,
      })
      return
    }

    logger.info(`Found ${staleIntegrations.length} stale integrations to sync`, {
      staleIntegrations: staleIntegrations.map((i) => ({
        id: i.id,
        provider: i.provider,
        lastSyncedAt: i.lastSyncedAt,
      })),
      organizationId: this.organizationId,
    })

    const syncPromises = staleIntegrations.map((integration) =>
      this.syncMessages(integration.provider as ChannelProviderType, integration.id).catch(
        (error) => {
          logger.error('Failed to sync stale integration', {
            error,
            integrationId: integration.id,
            provider: integration.provider,
          })
          return { status: 'rejected', reason: error, integrationId: integration.id }
        }
      )
    )

    await Promise.allSettled(syncPromises)

    logger.info('Stale integrations sync completed', {
      processedIntegrations: staleIntegrations.length,
      organizationId: this.organizationId,
    })
  }

  /**
   * Process sync results and provide detailed logging
   * Private helper extracted from MessageService logic
   */
  private async processSyncResults(
    results: PromiseSettledResult<any>[],
    providerInstances: Array<{ type: ChannelProviderType; integrationId: string }>
  ): Promise<void> {
    const successCount = results.filter((r) => r.status === 'fulfilled').length
    const failureCount = results.filter((r) => r.status === 'rejected').length

    logger.info('Sync results summary', {
      totalProviders: results.length,
      successCount,
      failureCount,
      organizationId: this.organizationId,
    })

    // Log detailed results for failures
    results.forEach((result, index) => {
      const providerInstance = providerInstances[index]
      if (result.status === 'rejected') {
        logger.warn(
          `Sync failed for: ${providerInstance.type} - ${providerInstance.integrationId}`,
          {
            reason: result.reason,
            organizationId: this.organizationId,
          }
        )
      } else {
        logger.debug(
          `Sync succeeded for: ${providerInstance.type} - ${providerInstance.integrationId}`,
          { organizationId: this.organizationId }
        )
      }
    })

    // If too many failures, log a warning
    if (failureCount > 0 && failureCount / results.length > 0.5) {
      logger.warn('High sync failure rate detected', {
        failureRate: `${Math.round((failureCount / results.length) * 100)}%`,
        failureCount,
        totalProviders: results.length,
        organizationId: this.organizationId,
      })
    }
  }
}
