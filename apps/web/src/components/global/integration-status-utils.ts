// apps/web/src/components/global/integration-status-utils.ts

import type { IntegrationSyncStage, IntegrationSyncStatus } from '@auxx/database/types'

export type IntegrationStatus =
  | 'authenticated'
  | 'auth_error'
  | 'sync_error'
  | 'disabled'
  | 'syncing'

/**
 * Format sync stage for tooltip display. When the stage is in the import phase
 * (`MESSAGES_IMPORT_PENDING` or `MESSAGES_IMPORT`) and a positive
 * `pendingImportCount` is provided, the remaining count is appended so the
 * user sees concrete progress instead of a generic "preparing/importing" line.
 */
export function formatSyncStage(stage: IntegrationSyncStage, pendingImportCount?: number): string {
  switch (stage) {
    case 'MESSAGE_LIST_FETCH_PENDING':
      return 'Preparing to fetch messages'
    case 'MESSAGE_LIST_FETCH':
      return 'Fetching message list'
    case 'MESSAGES_IMPORT_PENDING':
      return appendRemaining('Preparing to import messages', pendingImportCount)
    case 'MESSAGES_IMPORT':
      return appendRemaining('Importing messages', pendingImportCount)
    case 'FAILED':
      return 'Sync failed'
    case 'IDLE':
      return 'In progress'
  }
}

function appendRemaining(label: string, pendingImportCount: number | undefined): string {
  if (!pendingImportCount || pendingImportCount <= 0) return label
  return `${label} (${pendingImportCount.toLocaleString()} remaining)`
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
