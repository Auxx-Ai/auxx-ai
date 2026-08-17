// packages/lib/src/cache/integration-catalog.ts

import { createScopedLogger } from '@auxx/logger'
import { PLATFORM_CAPABILITIES, type PlatformCapabilities } from '../channels/capabilities'
import { getIdentifier } from '../channels/internal/identifier'
import type { CachedChannel } from './providers/channels-provider'
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
  /**
   * The channel's OWN identifier — the address or number it sends *as*
   * (`getIdentifier`: `Integration.email`, else `metadata.email` /
   * `metadata.phoneNumber`, else the display name).
   *
   * Carried here because a phone channel's E.164 number is the only correct
   * source for the region a national (no `+`) recipient number must be parsed
   * against — see `regionFromIdentifier`. `null` when the channel exposes none.
   */
  identifier: string | null
  notes?: string
}

/**
 * Get the org's integration catalog, joined with `PLATFORM_CAPABILITIES`.
 * Skips integrations whose platform is not in the capability map (e.g. data-only
 * integrations) and integrations that can neither start a new conversation nor
 * reply on a thread. Also skips disabled channels — the catalog only surfaces
 * channels that kopilot can actually send through.
 *
 * TODO: gate by per-user permission once an integration-level permission system
 * exists. Pre-launch this returns the full org list to every user.
 */
export async function getCachedIntegrationCatalog(
  organizationId: string
): Promise<IntegrationCatalogEntry[]> {
  let channels: CachedChannel[]
  try {
    channels = await getOrgCache().get(organizationId, 'channels')
  } catch (err) {
    // Stale HMR cache: the singleton predates this provider being registered.
    // Surface in logs but treat as "no channels" so callers see an empty
    // catalog instead of a hard failure that breaks the whole turn.
    logger.warn('Failed to load channels cache; returning empty catalog', {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const entries: IntegrationCatalogEntry[] = []
  for (const c of channels) {
    if (!c.enabled) continue
    const caps = PLATFORM_CAPABILITIES[c.provider]
    if (!caps) continue
    if (!caps.newOutbound && !caps.threadReply) continue

    entries.push({
      integrationId: c.id,
      displayName: c.displayName,
      platform: c.provider,
      channel: caps.channel,
      newOutbound: caps.newOutbound,
      threadReply: caps.threadReply,
      subject: caps.subject,
      ccBcc: caps.ccBcc,
      drafts: caps.drafts,
      attachments: caps.attachments,
      recipientModel: caps.recipientModel,
      identifier: getIdentifier(c) ?? null,
      notes: caps.notes,
    })
  }
  return entries
}
