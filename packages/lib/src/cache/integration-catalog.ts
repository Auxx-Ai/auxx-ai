// packages/lib/src/cache/integration-catalog.ts

import { createScopedLogger } from '@auxx/logger'
import { PLATFORM_CAPABILITIES, type PlatformCapabilities } from '../integrations/capabilities'
import type { CachedIntegration } from './providers/integrations-provider'
import { getOrgCache } from './singletons'

const logger = createScopedLogger('integration-catalog')

/**
 * Joined integration + capability shape consumed by kopilot tools and the
 * system-prompt catalog section.
 */
export interface IntegrationCatalogEntry {
  integrationId: string
  displayName: string
  platform: string
  channel: PlatformCapabilities['channel']
  newOutbound: boolean
  threadReply: boolean
  subject: boolean
  ccBcc: boolean
  drafts: boolean
  attachments: boolean
  recipientModel: PlatformCapabilities['recipientModel']
  notes?: string
}

/**
 * Get the org's integration catalog, joined with `PLATFORM_CAPABILITIES`.
 * Skips integrations whose platform is not in the capability map (e.g. data-only
 * integrations) and integrations that can neither start a new conversation nor
 * reply on a thread.
 *
 * TODO: gate by per-user permission once an integration-level permission system
 * exists. Pre-launch this returns the full org list to every user.
 */
export async function getCachedIntegrationCatalog(
  organizationId: string
): Promise<IntegrationCatalogEntry[]> {
  let integrations: CachedIntegration[]
  try {
    integrations = await getOrgCache().get(organizationId, 'integrations')
  } catch (err) {
    // Stale HMR cache: the singleton predates this provider being registered.
    // Surface in logs but treat as "no integrations" so callers see an empty
    // catalog instead of a hard failure that breaks the whole turn.
    logger.warn('Failed to load integrations cache; returning empty catalog', {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const entries: IntegrationCatalogEntry[] = []
  for (const i of integrations) {
    const caps = PLATFORM_CAPABILITIES[i.platform]
    if (!caps) continue
    if (!caps.newOutbound && !caps.threadReply) continue

    entries.push({
      integrationId: i.integrationId,
      displayName: i.displayName,
      platform: i.platform,
      channel: caps.channel,
      newOutbound: caps.newOutbound,
      threadReply: caps.threadReply,
      subject: caps.subject,
      ccBcc: caps.ccBcc,
      drafts: caps.drafts,
      attachments: caps.attachments,
      recipientModel: caps.recipientModel,
      notes: caps.notes,
    })
  }
  return entries
}
