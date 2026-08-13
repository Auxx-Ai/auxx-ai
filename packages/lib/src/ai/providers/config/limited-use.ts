// packages/lib/src/ai/providers/config/limited-use.ts

import { getOrgCache } from '../../../cache/singletons'
import { createScopedLogger } from '../../../logger'
import { FeaturePermissionService } from '../../../permissions/feature-permission-service'
import { FeatureKey } from '../../../permissions/types'
import { ProviderError } from '../base/types'
import { isProviderLimitedUseBlocked } from './context'

const logger = createScopedLogger('ai-limited-use-gate')

/**
 * Google Workspace Limited Use gate.
 *
 * An organization with a connected Google account may only use AI providers whose terms
 * forbid training on submitted data (`LIMITED_USE_SAFE_PROVIDERS`), because ticket bodies,
 * calendar entries and spreadsheet rows reaching a model are Workspace-derived data.
 *
 * This module deliberately imports neither `./cache` nor `../provider-registry`: `cache.ts`
 * already imports `ProviderRegistry`, so a shared helper living in either would create an
 * import cycle. Both enforcement layers import this one instead.
 */

/**
 * Whether the Limited Use restriction currently applies to an org.
 *
 * Gated unless the org has no connected Google account, or an operator has explicitly set
 * `unrestrictedAiProviders` on its plan. The `channels` cache provider already excludes
 * soft-deleted rows, so a disconnected Google channel correctly un-gates the org.
 *
 * Fails CLOSED: any error resolving the org's state leaves the org gated. A compliance
 * control that opens up when a cache read fails is worse than none.
 */
export async function isOrgLimitedUseGated(organizationId: string): Promise<boolean> {
  try {
    const channels = await getOrgCache().get(organizationId, 'channels')
    if (!channels.some((channel) => channel.provider === 'google')) return false

    // `hasAccess` is fail-closed for boolean gates (a missing key reads as false) and
    // returns true on self-hosted, where the operator runs their own OAuth client and is
    // their own data controller.
    const unrestricted = await new FeaturePermissionService().hasAccess(
      organizationId,
      FeatureKey.unrestrictedAiProviders
    )
    return !unrestricted
  } catch (error) {
    logger.error('Failed to resolve Limited Use gate state; defaulting to gated', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}

/**
 * Throw if a provider may not be used by this org. The hard backstop — every provider
 * client is constructed through `ProviderRegistry.createClient`, so a blocked provider
 * cannot be reached via a stored model id, a pinned agent version, a workflow node or a
 * scheduled job, regardless of what the UI shows.
 */
export async function assertProviderAllowed(
  providerId: string,
  organizationId: string
): Promise<void> {
  const gated = await isOrgLimitedUseGated(organizationId)
  if (!isProviderLimitedUseBlocked(providerId, gated)) return

  logger.warn('Blocked a Limited Use provider', { organizationId, provider: providerId })
  throw new ProviderError(
    `Provider '${providerId}' is unavailable for organizations with a connected Google account. ` +
      'Its terms permit training on submitted data, which the Google Workspace Limited Use ' +
      'requirements prohibit for Google user data.',
    providerId,
    'LIMITED_USE_BLOCKED'
  )
}
