// packages/lib/src/data-deletion/notify.ts
//
// Telling the org that one of its channels just stopped working. Both Meta
// kinds notify: `deauthorize` pauses the channel and `data_deletion`
// disconnects it, and in either case a support inbox silently goes quiet
// otherwise (plan §4.6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { MetaDataDeletionKind } from './client'

const logger = createScopedLogger('data-deletion')

export interface NotifyOrgOfMetaTeardownParams {
  organizationId: string
  /**
   * Display name of the Page / IG account, taken from the resolved
   * `Integration` row (`name`, else `metadata->>'pageName'`). Null falls back to
   * a platform label rather than a hardcoded product string.
   */
  channelName: string | null
  platform: 'facebook' | 'instagram'
  kind: MetaDataDeletionKind
}

/**
 * Notify an org's owners/admins in-app AND by email that a Meta channel was
 * taken offline by a deletion or deauthorize callback.
 *
 * The email goes through `enqueueEmailJob` rather than calling
 * `sendMetaChannelDisconnectedEmail` inline: the teardown already runs inside a
 * BullMQ job whose retries would re-revoke tokens, so the mail needs its own
 * retry budget on the email queue instead of sharing that one.
 *
 * Never throws: the teardown itself has already happened and a notification
 * failure must not fail — or look like it failed — a compliance action we have
 * already told Meta we performed.
 */
export async function notifyOrgOfMetaTeardown(
  db: Database,
  params: NotifyOrgOfMetaTeardownParams
): Promise<void> {
  const { organizationId, platform, kind } = params
  const platformLabel = platform === 'instagram' ? 'Instagram' : 'Facebook'
  const channelName = params.channelName?.trim() || `${platformLabel} channel`
  // `app-removed` is the email template's word for the deauthorize callback.
  const reason: 'app-removed' | 'data-deletion' =
    kind === 'deauthorize' ? 'app-removed' : 'data-deletion'
  const stateLabel = kind === 'deauthorize' ? 'paused' : 'disconnected'
  const cause =
    kind === 'deauthorize'
      ? 'removed Auxx.ai from their Facebook settings'
      : 'asked Meta to delete their data'
  const message =
    `Your ${platformLabel} channel "${channelName}" is ${stateLabel}: the person who ` +
    `connected it ${cause}. Your conversation history is unaffected — reconnect the channel ` +
    `in Settings to resume.`

  try {
    // Lazy imports on purpose: `notification-service` pulls the realtime barrel
    // and `enqueue-email-job` pulls bullmq — static imports of either drag both
    // into every consumer's graph and break `vi.mock` in tests
    // ([[project_realtime_barrel_import_cycle]]).
    const [{ getCachedMembers, getCachedOrgProfile }, { NotificationService }] = await Promise.all([
      import('../cache'),
      import('../notifications/notification-service'),
    ])

    const admins = await getCachedMembers(organizationId, {
      status: 'ACTIVE',
      roles: ['OWNER', 'ADMIN'],
    })
    if (admins.length === 0) {
      logger.warn('No org admins to notify about Meta channel teardown', { organizationId })
      return
    }

    const service = new NotificationService(db)
    await Promise.all(
      admins.map((admin) =>
        service
          .sendNotification({
            type: 'SYSTEM_MESSAGE',
            userId: admin.userId,
            organizationId,
            targetType: 'SETTINGS',
            targetIds: { path: '/app/settings/channels' },
            message,
          })
          .catch((error: unknown) => {
            logger.error('Failed to send Meta teardown notification', { error, organizationId })
          })
      )
    )

    const profile = await getCachedOrgProfile(organizationId)
    const organizationName = profile?.name || 'your organization'
    const { enqueueEmailJob } = await import('../jobs/email/enqueue-email-job')

    await Promise.all(
      admins.map((admin) => {
        const email = admin.user?.email
        if (!email) return Promise.resolve()
        return enqueueEmailJob('meta-channel-disconnected', {
          recipient: { email, name: admin.user?.name ?? undefined },
          organizationName,
          channelName,
          platform,
          reason,
          source: 'data-deletion',
          organizationId,
        }).catch((error: unknown) => {
          logger.error('Failed to enqueue Meta teardown email', { error, organizationId })
        })
      })
    )
  } catch (error) {
    logger.error('Failed to notify org of Meta channel teardown', { error, organizationId, kind })
  }
}
