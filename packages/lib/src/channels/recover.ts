// packages/lib/src/channels/recover.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { clearImportCache } from '../email/polling-import-cache'
import type { NotFoundError } from '../errors'
import { createScopedLogger } from '../logger'
import { clearCredentialReauth } from '../providers/credential-auth-state'
import { Result, type TypedResult } from '../result'
import { withAuthFailuresCleared } from './internal/auth-metadata'
import { validateChannelOwnership } from './internal/validate'
import { toggle } from './toggle'
import type { ChannelCtx } from './types'

const logger = createScopedLogger('channels.recover')

export interface RecoverChannelResult {
  success: true
  /** The channel was auto-disabled by auth failures and has been switched back on. */
  reEnabled: boolean
}

/**
 * Bring a channel back to a healthy baseline after the user re-authenticates it.
 *
 * Called on every successful reconnect, including the *silent* token refresh
 * that `useConnectFlow.attemptRefreshThenOAuth` tries first. That path matters
 * most: it never reaches the OAuth callback, so the post-connect provisioning
 * hook — the only other code that re-enables an existing channel — never runs.
 * Without this the user reconnects, is told it worked, and every sync still
 * fails with "Cannot sync messages for disabled channel", with no way back
 * other than finding the Enable item in the card menu.
 *
 * Recovery covers all three pieces of stuck state, because each one alone is
 * enough to keep mail from flowing:
 *  - `enabled` — flipped false by `AuthErrorHandler` after `DISABLE_THRESHOLD`
 *    reauth-class failures. Re-enabled through `toggle` so the provider's
 *    webhook is re-armed: a channel dark long enough to be auto-disabled has
 *    outlived its Gmail watch, and nothing else re-arms it on this path.
 *  - `metadata.auth` — the failure counter behind that flip (see
 *    {@link withAuthFailuresCleared}).
 *  - the sync breaker — `syncStatus`/`syncStage`/`throttle*`, which otherwise
 *    keeps showing "Sync Error" and, in webhook mode, never self-heals because
 *    the polling relaunch job skips those rows.
 *
 * Re-enabling is unconditional rather than gated on "was it auto-disabled":
 * pressing Reconnect *is* the request for a working channel, and the action is
 * only offered on a channel that needs re-auth in the first place.
 */
export async function recoverChannel(
  ctx: ChannelCtx,
  channelId: string,
  options: { fullResync?: boolean } = {}
): Promise<TypedResult<RecoverChannelResult, NotFoundError>> {
  const validated = await validateChannelOwnership(ctx, channelId)
  if (!validated.ok) return validated
  const channel = validated.value

  const reEnabled = !channel.enabled
  if (reEnabled) {
    const toggled = await toggle(ctx, channelId, true)
    if (!toggled.ok) return toggled
  }

  await clearImportCache(channelId)

  await ctx.db
    .update(schema.Integration)
    .set({
      syncStatus: 'ACTIVE',
      syncStage: 'IDLE',
      syncStageStartedAt: null,
      throttleFailureCount: 0,
      throttleRetryAfter: null,
      ...(options.fullResync ? { lastHistoryId: null } : {}),
      metadata: withAuthFailuresCleared(channel.metadata) as never,
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, channelId))

  await clearCredentialReauth(channelId)

  // Reconnect settles through TWO paths and only the OAuth popup runs the post-connect
  // provisioning hook (webhook-push-migration plan Phase 2.7) — the silent token-refresh path
  // that `useConnectFlow.attemptRefreshThenOAuth` tries first lands here instead, so without
  // this an Outlook channel that recovers silently never re-arms its Graph subscription and
  // stays dark. Best-effort: recovery of enabled/breaker state must not fail because Graph
  // happens to be down.
  if (channel.provider === 'outlook') {
    const { resolveEffectiveSyncMode } = await import('../providers/sync-mode-resolver')
    const effectiveMode = resolveEffectiveSyncMode({
      syncMode: channel.syncMode,
      provider: 'outlook',
    })
    if (effectiveMode === 'webhook') {
      const { armOutlookSubscription } = await import('../providers/outlook/outlook-subscription')
      await armOutlookSubscription({
        integrationId: channelId,
        organizationId: ctx.organizationId,
      }).catch((error) =>
        logger.warn('Outlook re-arm failed during channel recovery', {
          channelId,
          error: error instanceof Error ? error.message : String(error),
        })
      )
    }
  }

  // After the metadata write, not before: `toggle`'s own invalidation fires
  // while the stale `auth` block is still on the row, and the cached channel
  // list carries both `metadata` and `enabled`.
  await onCacheEvent('channel.toggled', { orgId: ctx.organizationId })

  logger.info('Channel recovered after reconnect', {
    channelId,
    provider: channel.provider,
    reEnabled,
    fullResync: !!options.fullResync,
  })

  return Result.ok({ success: true, reEnabled })
}
