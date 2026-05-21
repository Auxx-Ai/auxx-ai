// packages/lib/src/cache/providers/channels-provider.ts

import { schema } from '@auxx/database'
import type { IntegrationProviderType } from '@auxx/database/types'
import { and, eq, isNull } from 'drizzle-orm'
import type { ChannelSettings } from '../../channels/types'
import type { CacheProvider } from '../org-cache-provider'

type ChatWidgetRow = typeof schema.ChatWidget.$inferSelect

/**
 * Channel row carried in the org cache. Includes everything the rich
 * `channel.list()` response needs *except* live sync state (syncStatus,
 * syncStage, throttle*) and Redis pending-import counts — those flip too
 * often and are merged in at read time.
 *
 * Joined with `PLATFORM_CAPABILITIES` at read time to produce the kopilot
 * integration catalog. Excludes credentials.
 */
export interface CachedChannel {
  id: string
  provider: IntegrationProviderType
  displayName: string
  name: string | null
  email: string | null
  metadata: unknown
  settings: ChannelSettings
  enabled: boolean
  updatedAt: Date
  lastSyncedAt: Date | null
  lastSuccessfulSync: Date | null
  authStatus: string | null
  requiresReauth: boolean
  lastAuthError: string | null
  lastAuthErrorAt: Date | null
  inboxId: string | null
  chatWidget: ChatWidgetRow | null
  isExample: boolean
}

/** Computes the channel list for an organization, excluding soft-deleted rows. */
export const channelsProvider: CacheProvider<CachedChannel[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        integration: schema.Integration,
        chatWidget: schema.ChatWidget,
        inboxId: schema.InboxIntegration.inboxId,
      })
      .from(schema.Integration)
      .leftJoin(schema.ChatWidget, eq(schema.ChatWidget.integrationId, schema.Integration.id))
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Integration.id)
      )
      .where(
        and(eq(schema.Integration.organizationId, orgId), isNull(schema.Integration.deletedAt))
      )

    return rows.map((r) => {
      const i = r.integration
      const metadata = (i.metadata as Record<string, unknown> | null) ?? null
      const settings = (metadata?.settings as ChannelSettings | undefined) ?? {}
      return {
        id: i.id,
        provider: i.provider,
        displayName: i.name ?? i.email ?? i.provider,
        name: i.name,
        email: i.email,
        metadata,
        settings,
        enabled: i.enabled,
        updatedAt: i.updatedAt,
        lastSyncedAt: i.lastSyncedAt,
        lastSuccessfulSync: i.lastSuccessfulSync,
        authStatus: i.authStatus,
        requiresReauth: i.requiresReauth,
        lastAuthError: i.lastAuthError,
        lastAuthErrorAt: i.lastAuthErrorAt,
        inboxId: r.inboxId,
        chatWidget: r.chatWidget,
        isExample: i.isExample,
      }
    })
  },
}
