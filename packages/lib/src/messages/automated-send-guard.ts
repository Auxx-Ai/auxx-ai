// packages/lib/src/messages/automated-send-guard.ts

import { createScopedLogger } from '@auxx/logger'
import { getOrganizationSetting } from '../settings/settings-service'
import { checkFixedWindowLimit } from '../utils/rate-limiter/fixed-window'

const logger = createScopedLogger('automated-send-guard')

/** Per-recipient cooldown window (1 hour). */
export const RECIPIENT_WINDOW_MS = 60 * 60 * 1000
/** Org circuit-breaker window (15 minutes). */
export const ORG_WINDOW_MS = 15 * 60 * 1000

export type AutomatedSendLimitResult =
  | { allowed: true }
  | {
      allowed: false
      scope: 'recipient' | 'org'
      limit: number
      count: number
      /** True on the first blocked send of an org window — the caller should notify admins. */
      firstTrip: boolean
    }

/**
 * Rate limits for automated email sends (machine-mail plan Phase 3) — the
 * defense-in-depth layer for whatever machine-mail detection misses. Two fixed
 * windows, checked in order of value:
 *
 * 1. Per-recipient cooldown (default 2/hour) — loops hop threads, so per-thread
 *    caps miss them; a single address getting hammered is the loop signature.
 * 2. Org circuit breaker (default 30 automated sends/15 min) — catches fan-out
 *    loops across many recipients.
 *
 * Thresholds are org settings; 0 disables a limit. Fails open when Redis is
 * unavailable (guardrail, not billing enforcement).
 */
export async function checkAutomatedSendLimits(opts: {
  organizationId: string
  recipientEmail: string
}): Promise<AutomatedSendLimitResult> {
  const { organizationId, recipientEmail } = opts

  const [recipientRaw, orgRaw] = await Promise.all([
    getOrganizationSetting({ organizationId, key: 'email.automation.maxPerRecipientPerHour' }),
    getOrganizationSetting({ organizationId, key: 'email.automation.maxPerOrgPer15Min' }),
  ])
  const recipientLimit = typeof recipientRaw === 'number' ? recipientRaw : 0
  const orgLimit = typeof orgRaw === 'number' ? orgRaw : 0

  if (recipientLimit > 0) {
    const recipient = await checkFixedWindowLimit({
      key: `ratelimit:autosend:recipient:${organizationId}:${recipientEmail.toLowerCase()}`,
      limit: recipientLimit,
      windowMs: RECIPIENT_WINDOW_MS,
    })
    if (!recipient.allowed) {
      logger.warn('Automated send blocked: per-recipient cooldown', {
        organizationId,
        recipientEmail,
        count: recipient.count,
        limit: recipientLimit,
      })
      return {
        allowed: false,
        scope: 'recipient',
        limit: recipientLimit,
        count: recipient.count,
        firstTrip: recipient.count === recipientLimit + 1,
      }
    }
  }

  if (orgLimit > 0) {
    const org = await checkFixedWindowLimit({
      key: `ratelimit:autosend:org:${organizationId}`,
      limit: orgLimit,
      windowMs: ORG_WINDOW_MS,
    })
    if (!org.allowed) {
      logger.warn('Automated send blocked: org circuit breaker', {
        organizationId,
        count: org.count,
        limit: orgLimit,
      })
      return {
        allowed: false,
        scope: 'org',
        limit: orgLimit,
        count: org.count,
        // INCR makes the count exact: only the first blocked send in the window notifies.
        firstTrip: org.count === orgLimit + 1,
      }
    }
  }

  return { allowed: true }
}

/**
 * Notify org owners/admins that the automated-send circuit breaker tripped.
 * Best-effort — never throws (the caller is about to throw the ForbiddenError
 * that actually blocks the send).
 */
export async function notifyAdminsOfSendBreakerTrip(opts: {
  organizationId: string
  limit: number
}): Promise<void> {
  const { organizationId, limit } = opts
  try {
    // Lazy imports: notification-service pulls the realtime barrel (vi.mock breaks on it).
    const [{ getCachedMembers }, { NotificationService }] = await Promise.all([
      import('../cache'),
      import('../notifications/notification-service'),
    ])
    const admins = await getCachedMembers(organizationId, {
      status: 'ACTIVE',
      roles: ['OWNER', 'ADMIN'],
    })
    const service = new NotificationService()
    await Promise.all(
      admins.map((admin) =>
        service.sendNotification({
          type: 'SYSTEM_MESSAGE',
          userId: admin.userId,
          targetType: 'SETTINGS',
          targetIds: { path: '/app/settings/general' },
          organizationId,
          message:
            `Automated email sending paused: more than ${limit} automated emails were sent ` +
            'in 15 minutes, which usually means a workflow or sequence is misbehaving. ' +
            'Automated sends are blocked until the rate drops.',
          metadata: { kind: 'SYSTEM_MESSAGE', type: 'AUTOMATED_SEND_BREAKER' },
        })
      )
    )
  } catch (error) {
    logger.error('Failed to notify admins of send circuit breaker trip', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
