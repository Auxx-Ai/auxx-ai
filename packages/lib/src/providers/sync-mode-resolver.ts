// packages/lib/src/providers/sync-mode-resolver.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('sync-mode-resolver')

type SyncMode = 'webhook' | 'polling' | 'auto'
type EffectiveSyncMode = 'webhook' | 'polling'

/**
 * Determines the effective sync mode for an integration.
 * - 'polling' or 'webhook' are used as-is
 * - 'auto' checks env vars to determine if webhooks are available
 */
export function resolveEffectiveSyncMode(integration: {
  syncMode: string
  provider: string
}): EffectiveSyncMode {
  const mode = integration.syncMode as SyncMode

  if (mode === 'polling') return 'polling'
  if (mode === 'webhook') return 'webhook'

  // auto mode: check if webhook infrastructure is available
  if (integration.provider === 'google') {
    const hasProjectId = !!configService.get<string>('GOOGLE_PROJECT_ID')
    const hasPubSubTopic = !!configService.get<string>('GOOGLE_PUBSUB_TOPIC')
    const hasPrivateKey = !!configService.get<string>('GOOGLE_PRIVATE_KEY')
    const hasClientEmail = !!configService.get<string>('GOOGLE_CLIENT_EMAIL')

    if (hasProjectId && hasPubSubTopic && hasPrivateKey && hasClientEmail) {
      return 'webhook'
    }

    logger.debug('Google webhook env vars missing, falling back to polling', {
      hasProjectId,
      hasPubSubTopic,
      hasPrivateKey,
      hasClientEmail,
    })
    return 'polling'
  }

  if (integration.provider === 'imap') {
    return 'polling'
  }

  if (integration.provider === 'outlook') {
    // Outlook webhooks need no extra env vars beyond app registration
    return 'webhook'
  }

  // Default for future providers (IMAP, etc.)
  return 'polling'
}

/** Checks if any provider in the system would resolve to polling. */
export function isPollingEnabled(): boolean {
  // Google resolves to polling if Pub/Sub env vars are missing
  const googleWouldPoll =
    !configService.get<string>('GOOGLE_PROJECT_ID') ||
    !configService.get<string>('GOOGLE_PUBSUB_TOPIC') ||
    !configService.get<string>('GOOGLE_PRIVATE_KEY') ||
    !configService.get<string>('GOOGLE_CLIENT_EMAIL')

  // Polling is always available as a fallback
  return googleWouldPoll || true
}
