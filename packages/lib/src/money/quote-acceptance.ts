// packages/lib/src/money/quote-acceptance.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { NotificationService } from '../notifications/notification-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { batchReadSystemValues } from './billing-projection'
import {
  convertQuoteToWorkOrder,
  findActiveJobForQuote,
  stampQuoteDepositsOnWorkOrder,
} from './convert-quote'
import { approveQuote, declineQuote } from './quote-lifecycle'
import type { PublicQuotePayload } from './quote-public-token'
import { getPublicQuotePayload, resolveQuoteByPublicToken } from './quote-public-token'
import { recomputeTotals } from './totals-hooks'

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
      targetType: 'ENTITY_INSTANCE',
      targetIds: { entityDefinitionId: 'quote', entityInstanceId: quoteInstanceId },
      message,
      organizationId,
      metadata: { kind: 'SYSTEM_MESSAGE', source: 'quote-acceptance' },
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
  /**
   * Public accept-page optional-line selection (plan 18 §5) — the instance ids of every
   * optional line the customer left checked. Standard HTML checkbox-form semantics: an
   * unchecked box simply isn't in the submitted set, so a submitted-but-absent optional line
   * id is treated as deselected.
   *
   * `undefined` (the field omitted entirely) means "no selection was submitted" — the
   * internal/legacy accept path (no public form, or the quote's `acceptancePageEnabled` is
   * off) takes the seller's pre-checked `optionalSelected` defaults as-is and this input is
   * never touched.
   *
   * `[]` is an EXPLICIT submission that deselects every optional line (an all-unchecked
   * public form) — it is honored as a real selection, not treated the same as `undefined`.
   */
  selectedLineIds?: string[]
}

/** Result of {@link acceptQuoteByToken}. */
export interface AcceptQuoteByTokenResult {
  /** `true` when the quote was already `approved` — idempotent re-submit, no error. */
  alreadyAccepted: boolean
  /** `true` when auto-convert-to-work-order ran and succeeded. */
  converted: boolean
  /**
   * `true` when an active job already existed for this quote at accept time (early
   * convert, money plan 20) — the create was skipped (NOT an error), deposits were
   * stamped onto the existing job, and the creator notification carries the
   * review-the-job variant.
   */
  linkedExistingJob: boolean
}

/**
 * Validate a public accept-page selection against a quote's actual optional-line ids (plan 18
 * §5 step 2). Pure and DB-free so it's unit-testable without a live quote. Every id in
 * `selectedLineIds` must appear in `optionalLineInstanceIds` — an id that's simply unknown OR
 * belongs to one of the quote's *required* lines is rejected, never silently ignored (decision:
 * the plan explicitly calls for a throw, not a drop).
 *
 * @throws {BadRequestError} on the first id that isn't one of the quote's optional lines.
 */
export function validateSelectedLineIds(
  optionalLineInstanceIds: readonly string[],
  selectedLineIds: readonly string[]
): Set<string> {
  const optionalSet = new Set(optionalLineInstanceIds)
  for (const id of selectedLineIds) {
    if (!optionalSet.has(id)) {
      throw new BadRequestError(`"${id}" is not a selectable option on this quote`)
    }
  }
  return new Set(selectedLineIds)
}

/**
 * Write the public accept-page's optional-line selection onto the quote and recompute its
 * totals once (plan 18 §5 steps 1–3, amendment 3). Called AFTER the status/expiry/signature
 * guards and BEFORE `approveQuote` — a second POST against an already-`approved` quote never
 * reaches here (the idempotent early return in {@link acceptQuoteByToken} sits above it).
 *
 * Zero-optional quotes (no `line_item_optional` lines at all) are a total no-op — today's exact
 * path, `selectedLineIds` or not. See {@link AcceptQuoteByTokenInput.selectedLineIds} for the
 * `undefined` vs `[]` distinction that governs everything past that point.
 *
 * @returns The instance ids of the optional lines whose stored `optionalSelected` actually
 * changed — the accept path uses a non-empty result to pick the "option selection changed"
 * notification variant when an early-converted job exists (money plan 20 §D).
 */
async function applyOptionalLineSelections(params: {
  organizationId: string
  userId: string
  quoteInstanceId: string
  selectedLineIds: string[] | undefined
}): Promise<string[]> {
  const { organizationId, userId, quoteInstanceId, selectedLineIds } = params
  const quoteRecordId = toRecordId('quote', quoteInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)

  const { ids: optionalLineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'quote-optional-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'quote-optional-lines-quote',
            fieldId: 'line_item:quote',
            operator: 'is',
            value: quoteRecordId,
          },
          {
            id: 'quote-optional-lines-optional',
            fieldId: 'line_item:optional',
            operator: 'is',
            value: true,
          },
        ],
      },
    ],
    limit: 1000,
    mode: 'oneshot',
  })

  // Zero-optional quote: skip entirely, no matter what the caller submitted.
  if (optionalLineInstanceIds.length === 0) return []
  // No selection submitted (internal/legacy accept, or acceptancePageEnabled off): the
  // seller's pre-checked defaults ARE the selection — leave them untouched.
  if (selectedLineIds === undefined) return []

  const selectedSet = validateSelectedLineIds(optionalLineInstanceIds, selectedLineIds)

  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_optional_selected'] as const)
  const optionalSelectedField = cf.line_item_optional_selected
  if (!optionalSelectedField) return [] // pre-migration org — field doesn't exist, nothing to write

  const fieldValueService = new FieldValueService(organizationId, userId)
  const currentById = await batchReadSystemValues({
    service: fieldValueService,
    organizationId,
    entityType: 'line_item',
    entityInstanceIds: optionalLineInstanceIds,
    attributes: ['line_item_optional_selected'] as const,
  })

  // Def-UUID-form RecordId — `toRecordId('line_item', id)` would stamp the literal string
  // "line_item" into FieldValue.entityDefinitionId (a known trap: the write looks successful
  // but the row is orphaned from every query that resolves the real def UUID first).
  const lineItemDefId = await requireCachedEntityDefId(organizationId, 'line_item')

  const changedLineIds: string[] = []
  for (const lineInstanceId of optionalLineInstanceIds) {
    const nextSelected = selectedSet.has(lineInstanceId)
    const currentSelected =
      (currentById.get(lineInstanceId)?.get('line_item_optional_selected') as
        | boolean
        | undefined) ?? true
    if (currentSelected === nextSelected) continue // stored value already matches — skip the write
    changedLineIds.push(lineInstanceId)

    // Hook-free write path (amendment 3) — `setValueWithType` bypasses the field-change hooks
    // that `setValuesForEntity` fires, so this doesn't trigger N redundant per-line recomputes;
    // the one explicit `recomputeTotals` call below is the single deterministic recompute.
    await fieldValueService.setValueWithType({
      recordId: toRecordId(lineItemDefId, lineInstanceId),
      fieldId: optionalSelectedField.id,
      fieldType: optionalSelectedField.type,
      value: { type: 'boolean', value: nextSelected },
    })
  }

  await recomputeTotals({
    organizationId,
    userId,
    documentType: 'quote',
    documentInstanceId: quoteInstanceId,
  })

  return changedLineIds
}

/**
 * Best-effort display number of a work order (`WO-0007`) for notification copy — undefined
 * on any failure so callers can fall back to numberless phrasing.
 */
async function readWorkOrderNumber(params: {
  organizationId: string
  userId: string
  workOrderInstanceId: string
}): Promise<string | undefined> {
  const { organizationId, userId, workOrderInstanceId } = params
  try {
    const byId = await batchReadSystemValues({
      service: new FieldValueService(organizationId, userId),
      organizationId,
      entityType: 'work_order',
      entityInstanceIds: [workOrderInstanceId],
      attributes: ['work_order_number'] as const,
    })
    const number = byId.get(workOrderInstanceId)?.get('work_order_number')
    return typeof number === 'string' && number ? number : undefined
  } catch {
    return undefined
  }
}

/**
 * Accept a quote from the public `/quote/{token}` page (v5 build spec 01). Flips
 * `quote_status` via `approveQuote` (mirrors the linked service request), stamps
 * `quote_accepted_by_name`/`quote_accepted_at` as acceptance evidence, notifies the quote's
 * creator, then auto-converts to a work order when `documents.quote.autoConvertOnAccept` is on
 * (default). Deposit collection is deferred — no payment/checkout step here.
 *
 * Optional-line selections (plan 18 §5), when submitted, are written and priced into totals
 * BEFORE `approveQuote` — see {@link applyOptionalLineSelections}.
 */
export async function acceptQuoteByToken(
  token: string,
  input: AcceptQuoteByTokenInput = {}
): Promise<AcceptQuoteByTokenResult> {
  const { organizationId, quoteInstanceId, payload } = await resolveForMutation(token)
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')

  if (payload.status === 'approved') {
    return { alreadyAccepted: true, converted: false, linkedExistingJob: false }
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

  const selectionChangedLineIds = await applyOptionalLineSelections({
    organizationId,
    userId: systemUserId,
    quoteInstanceId,
    selectedLineIds: input.selectedLineIds,
  })

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

  // Early-converted job detection (money plan 20 §C) — a job created from this quote
  // BEFORE acceptance. The snapshot model means we never touch its lines here; we skip
  // the auto-convert (not an error), stamp deposits, and flag the drift for a human via
  // the notification variants below.
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const existingJobInstanceId = await findActiveJobForQuote(
    handler,
    toRecordId('quote', quoteInstanceId)
  )

  const who = payload.contact.name || 'A customer'
  let message = `${who} accepted quote ${payload.number}`
  if (existingJobInstanceId) {
    const jobNumber = await readWorkOrderNumber({
      organizationId,
      userId: systemUserId,
      workOrderInstanceId: existingJobInstanceId,
    })
    const jobRef = jobNumber ? `job ${jobNumber}` : 'its job'
    // The quote may also have been edited since the early convert in ways we can't
    // cheaply diff (FieldValue writes don't bump EntityInstance.updatedAt), so the
    // no-delta variant still says review.
    message =
      selectionChangedLineIds.length > 0
        ? `${who} accepted quote ${payload.number} — their option selection changed; review ${jobRef}'s line items`
        : `${who} accepted quote ${payload.number} — ${jobRef} already exists; review its line items for changes`
  }
  await notifyQuoteCreator({ organizationId, quoteInstanceId, message })

  if (existingJobInstanceId) {
    // Covers a deposit paid after the early convert but before accept; idempotent.
    await stampQuoteDepositsOnWorkOrder({
      organizationId,
      quoteInstanceId,
      workOrderInstanceId: existingJobInstanceId,
    })
    return { alreadyAccepted: false, converted: false, linkedExistingJob: true }
  }

  const { getOrganizationSetting } = await import('../settings/settings-service')
  const autoConvertOnAccept = await getOrganizationSetting({
    organizationId,
    key: 'documents.quote.autoConvertOnAccept',
  })

  let converted = false
  if (autoConvertOnAccept !== false) {
    try {
      // Runs AFTER applyOptionalLineSelections, so the fresh job's line snapshot already
      // reflects the customer's final selection — zero drift by construction.
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

  return { alreadyAccepted: false, converted, linkedExistingJob: false }
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

  // Early-converted job warning (money plan 20 §D) — the declined quote may already have a
  // job with scheduled visits. Never auto-cancel; just make the notification say so. The
  // job's Origin card shows the declined quote badge on its own.
  let jobSuffix = ''
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const existingJobInstanceId = await findActiveJobForQuote(
    handler,
    toRecordId('quote', quoteInstanceId)
  )
  if (existingJobInstanceId) {
    const jobNumber = await readWorkOrderNumber({
      organizationId,
      userId: systemUserId,
      workOrderInstanceId: existingJobInstanceId,
    })
    jobSuffix = ` — ${jobNumber ? `job ${jobNumber}` : 'a job'} exists for this quote`
  }

  await notifyQuoteCreator({
    organizationId,
    quoteInstanceId,
    message: reason
      ? `${payload.contact.name || 'A customer'} declined quote ${payload.number}: ${reason}${jobSuffix}`
      : `${payload.contact.name || 'A customer'} declined quote ${payload.number}${jobSuffix}`,
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
