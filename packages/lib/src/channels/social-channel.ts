// packages/lib/src/channels/social-channel.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { getChannelTokens } from '../providers/channel-token-accessor'
import { SOCIAL_SUBSCRIBED_FIELDS, subscribePageToApp } from '../providers/social/api'

const logger = createScopedLogger('social-channel')

export type SocialProviderKey = 'facebook' | 'instagram'

/**
 * Re-arm a page's `subscribed_apps` subscription outside the OAuth popup.
 *
 * **Why this exists at all.** Reconnect settles through two paths and only the
 * OAuth popup runs the post-connect provisioning hook. The silent token-refresh
 * path that `useConnectFlow.attemptRefreshThenOAuth` tries first lands in
 * `recoverChannel` instead — so a channel that recovers silently never re-runs
 * `subscribePageToApp` and stays deaf while showing as connected. Outlook and Quo
 * both carry the same branch for the same reason.
 *
 * Idempotent: Meta treats a repeat subscription POST as a no-op, so this can be
 * re-run freely and can never leave two subscriptions for one page.
 *
 * Throws on failure — the caller decides whether that is fatal. `recoverChannel`
 * catches and warns, because recovering the enabled/breaker state must not fail
 * just because Graph is briefly unavailable.
 */
export async function rearmSocialPageSubscription(
  integrationId: string,
  provider: SocialProviderKey
): Promise<void> {
  const [integration] = await db
    .select({ metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
    .limit(1)

  const pageId = (integration?.metadata as { pageId?: string } | null)?.pageId
  if (!pageId) {
    logger.warn('Cannot re-arm social page subscription: no pageId on the channel', {
      integrationId,
      provider,
    })
    return
  }

  const tokens = await getChannelTokens(integrationId)
  if (!tokens.accessToken) {
    logger.warn('Cannot re-arm social page subscription: no page access token', {
      integrationId,
      provider,
    })
    return
  }

  // The SAME field set the provisioning hook uses. Re-arming with a narrower set
  // is how a channel ends up subscribed but missing half its events.
  await subscribePageToApp(pageId, tokens.accessToken, SOCIAL_SUBSCRIBED_FIELDS[provider])

  logger.info('Re-armed social page subscription', {
    integrationId,
    provider,
    pageId,
    subscribedFields: SOCIAL_SUBSCRIBED_FIELDS[provider],
  })
}
