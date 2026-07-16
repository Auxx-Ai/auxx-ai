// packages/lib/src/money/quote-acceptance.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { NotificationService } from '../notifications/notification-service'
import { convertQuoteToWorkOrder } from './convert-quote'
import { approveQuote, declineQuote } from './quote-lifecycle'
import type { PublicQuotePayload } from './quote-public-token'
import { getPublicQuotePayload, resolveQuoteByPublicToken } from './quote-public-token'

const logger = createScopedLogger('money:quote-acceptance')

/**
 * The token-scoped public quote mutations (v5 build spec 01 — client-facing quote acceptance
 * page). Every export here resolves the token first (an unknown token throws `NotFoundError`,
 * same as a disabled acceptance page — the public route never leaks which case it is) and
 * runs as the org's system user, mirroring the invoice pay-page's unauthenticated-but-
 * capability-scoped write pattern.
 */

/** Resolve a token to its org/instance ids + the shared public payload (status/settings/
 * evidence reads), throwing `NotFoundError` for an unknown token OR a disabled acceptance
 * page — the public page must not be able to distinguish the two. */
async function resolveForMutation(token: string): Promise<{
  organizationId: string
  quoteInstanceId: string
  payload: PublicQuotePayload
}> {
  const resolved = await resolveQuoteByPublicToken(token)
  if (!resolved) throw new NotFoundError('Quote not found')

  const payload = await getPublicQuotePayload(token)
  if (!payload || !payload.acceptancePageEnabled) {
    throw new NotFoundError('Quote not found')
  }

  return {
    organizationId: resolved.organizationId,
    quoteInstanceId: resolved.quoteInstanceId,
    payload,
  }
}

/**
 * Notify the quote's creator (`EntityInstance.createdById`) of a public-page event. Best
 * effort — a notify failure must never fail the underlying accept/decline/request-update
 * mutation. Silently no-ops when the quote has no resolvable creator (system-created quotes).
 */
async function notifyQuoteCreator(params: {
  organizationId: string
  quoteInstanceId: string
  message: string
}): Promise<void> {
  const { organizationId, quoteInstanceId, message } = params
  try {
    const instance = await database.query.EntityInstance.findFirst({
      where: (t, { eq }) => eq(t.id, quoteInstanceId),
      columns: { createdById: true },
    })
    if (!instance?.createdById) return

    const notificationService = new NotificationService()
    await notificationService.sendNotification({
      // No dedicated quote NotificationType exists yet (adding one is a schema/enum
      // migration) — SYSTEM_MESSAGE is the generic catch-all other org-notify call sites
      // fall back to.
      type: 'SYSTEM_MESSAGE',
      userId: instance.createdById,
      entityId: quoteInstanceId,
      entityType: 'quote',
      message,
      organizationId,
    })
  } catch (error) {
    logger.warn('Failed to notify quote creator', {
      organizationId,
      quoteInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Input for {@link acceptQuoteByToken}. */
export interface AcceptQuoteByTokenInput {
  /** Typed-signature name — required when `documents.quote.requireSignature` is on. */
  name?: string
}

/** Result of {@link acceptQuoteByToken}. */
export interface AcceptQuoteByTokenResult {
  /** `true` when the quote was already `approved` — idempotent re-submit, no error. */
  alreadyAccepted: boolean
  /** `true` when auto-convert-to-work-order ran and succeeded. */
  converted: boolean
}

/**
 * Accept a quote from the public `/quote/{token}` page (v5 build spec 01). Flips
 * `quote_status` via `approveQuote` (mirrors the linked service request), stamps
 * `quote_accepted_by_name`/`quote_accepted_at` as acceptance evidence, notifies the quote's
 * creator, then auto-converts to a work order when `documents.quote.autoConvertOnAccept` is on
 * (default). Deposit collection is deferred — no payment/checkout step here.
 */
export async function acceptQuoteByToken(
  token: string,
  input: AcceptQuoteByTokenInput = {}
): Promise<AcceptQuoteByTokenResult> {
  const { organizationId, quoteInstanceId, payload } = await resolveForMutation(token)
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')

  if (payload.status === 'approved') {
    return { alreadyAccepted: true, converted: false }
  }
  if (payload.status !== 'sent') {
    throw new BadRequestError('This quote can no longer be accepted')
  }
  if (payload.isExpired) {
    throw new BadRequestError('This quote has expired')
  }

  const name = input.name?.trim()
  if (payload.requireSignature && !name) {
    throw new BadRequestError('Please type your full name to accept')
  }

  await approveQuote({ organizationId, userId: systemUserId, quoteInstanceId })

  const fieldValueService = new FieldValueService(organizationId, systemUserId)
  const values: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'quote_accepted_at', value: new Date().toISOString() },
  ]
  if (name) values.push({ fieldId: 'quote_accepted_by_name', value: name })
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId('quote', quoteInstanceId),
    values,
  })

  await notifyQuoteCreator({
    organizationId,
    quoteInstanceId,
    message: `${payload.contact.name || 'A customer'} accepted quote ${payload.number}`,
  })

  const { getOrganizationSetting } = await import('../settings/settings-service')
  const autoConvertOnAccept = await getOrganizationSetting({
    organizationId,
    key: 'documents.quote.autoConvertOnAccept',
  })

  let converted = false
  if (autoConvertOnAccept !== false) {
    try {
      await convertQuoteToWorkOrder({ organizationId, userId: systemUserId, quoteInstanceId })
      converted = true
    } catch (error) {
      logger.error('Auto-convert on quote accept failed', {
        organizationId,
        quoteInstanceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { alreadyAccepted: false, converted }
}

/** Input for {@link declineQuoteByToken}. */
export interface DeclineQuoteByTokenInput {
  reason?: string
}

/** Result of {@link declineQuoteByToken}. */
export interface DeclineQuoteByTokenResult {
  /** `true` when the quote was already `declined` — idempotent re-submit, no error. */
  alreadyDeclined: boolean
}

/**
 * Decline a quote from the public `/quote/{token}` page (v5 build spec 01). Flips
 * `quote_status` via `declineQuote` (no request mirror — same as the dispatcher-facing
 * decline), stamps `quote_decline_reason` when provided, notifies the quote's creator.
 * Declined is terminal on the public page (locked, per the plan's open-question 5 default).
 */
export async function declineQuoteByToken(
  token: string,
  input: DeclineQuoteByTokenInput = {}
): Promise<DeclineQuoteByTokenResult> {
  const { organizationId, quoteInstanceId, payload } = await resolveForMutation(token)
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')

  if (payload.status === 'declined') {
    return { alreadyDeclined: true }
  }
  if (payload.status !== 'sent') {
    throw new BadRequestError('This quote can no longer be declined')
  }
  if (!payload.allowDecline) {
    throw new BadRequestError('Declining this quote is not available')
  }

  await declineQuote({ organizationId, userId: systemUserId, quoteInstanceId })

  const reason = input.reason?.trim()
  if (reason) {
    const fieldValueService = new FieldValueService(organizationId, systemUserId)
    await fieldValueService.setValuesForEntity({
      recordId: toRecordId('quote', quoteInstanceId),
      values: [{ fieldId: 'quote_decline_reason', value: reason }],
    })
  }

  await notifyQuoteCreator({
    organizationId,
    quoteInstanceId,
    message: reason
      ? `${payload.contact.name || 'A customer'} declined quote ${payload.number}: ${reason}`
      : `${payload.contact.name || 'A customer'} declined quote ${payload.number}`,
  })

  return { alreadyDeclined: false }
}

/**
 * "Request an updated quote" from the public `/quote/{token}` page (v5 build spec 01) — the
 * expired-quote CTA. Allowed for any `sent` quote, expired or not; no status change, just a
 * best-effort notify to the quote's creator. Naive rate-limit: a notify failure (or no
 * resolvable creator) is a silent no-op rather than a retry loop.
 */
export async function requestQuoteUpdateByToken(token: string): Promise<void> {
  const { organizationId, quoteInstanceId, payload } = await resolveForMutation(token)

  if (payload.status !== 'sent') {
    throw new BadRequestError('This quote is not awaiting a response')
  }

  await notifyQuoteCreator({
    organizationId,
    quoteInstanceId,
    message: `${payload.contact.name || 'A customer'} requested an updated quote ${payload.number}`,
  })
}
