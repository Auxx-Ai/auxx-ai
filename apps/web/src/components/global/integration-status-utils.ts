// apps/web/src/components/global/integration-status-utils.ts

import type { IntegrationSyncStage, IntegrationSyncStatus } from '@auxx/database/types'

export type IntegrationStatus =
  | 'authenticated'
  | 'auth_error'
  | 'sync_error'
  | 'disabled'
  | 'syncing'

/**
 * Format sync stage for tooltip display
 */
export function formatSyncStage(stage: IntegrationSyncStage): string {
  switch (stage) {
    case 'MESSAGE_LIST_FETCH':
      return 'Fetching message list'
    case 'MESSAGES_IMPORT':
      return 'Importing messages'
    case 'FAILED':
      return 'Sync failed'
    case 'IDLE':
      return 'In progress'
  }
}

/**
 * Helper function to determine status from integration data.
 * Precedence: disabled > auth_error > syncing > sync_error > authenticated
 */
export function getIntegrationStatus(integration: {
  enabled: boolean
  requiresReauth?: boolean
  lastAuthError?: string | null
  lastSyncedAt?: Date | null
  syncStatus?: IntegrationSyncStatus | null
}): IntegrationStatus {
  if (!integration.enabled) return 'disabled'
  if (integration.requiresReauth || integration.lastAuthError) return 'auth_error'
  if (integration.syncStatus === 'SYNCING') return 'syncing'
  if (integration.syncStatus === 'FAILED') return 'sync_error'
  // Covers ACTIVE, NOT_SYNCED, and null (e.g. chat widgets with no sync)
  return 'authenticated'
}
