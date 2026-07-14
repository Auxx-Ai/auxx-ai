// packages/lib/src/money/quote-lifecycle.ts

import type { RecordId, TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import type { CreateQuoteFromRequestInput, QuoteLifecycleInput } from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Assert the quote is currently at `expected` status, else reject with a clear message. */
function assertStatus(status: string | undefined, expected: string, action: string): void {
  if (status !== expected) {
    throw new BadRequestError(
      `Cannot ${action} — quote must be '${expected}' (currently '${status ?? 'unknown'}')`
    )
  }
}

/**
 * Read a quote's current `quote_status` + `quote_request` (if linked). Shared by the
 * three status-transition mutations below — all three need the same two fields.
 */
async function getQuoteStatusAndRequest(
  handler: UnifiedCrudHandler,
  organizationId: string,
  quoteRecordId: RecordId
): Promise<{ status: string | undefined; requestRecordId: RecordId | undefined }> {
  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['quote_status', 'quote_request'] as const)

  const fieldIds = [cf.quote_status, cf.quote_request].filter(Boolean).map((f) => f!.id)
  const values = await handler.getFieldValues(quoteRecordId, fieldIds)

  const statusTyped = cf.quote_status ? firstTyped(values.get(cf.quote_status.id)) : undefined
  const requestTyped = cf.quote_request ? firstTyped(values.get(cf.quote_request.id)) : undefined

  return {
    status: statusTyped ? (extractValue(statusTyped) as string) : undefined,
    requestRecordId: requestTyped?.type === 'relationship' ? requestTyped.recordId : undefined,
  }
}

/**
 * Mark a quote as sent (money MQ1 build spec §F.3). Bare status flip until MQ2 wraps
 * it with the real PDF/email send. Mirrors the linked request to `quoted` if present.
 *
 * Writes go through `FieldValueService` directly — this is the sanctioned writer the
 * `rejectManualLifecycleStatus` system pre-hook (resources/hooks/quote-hooks.ts) is
 * built to let through, since `FieldValueService` bypasses `UnifiedCrudHandler`'s
 * system pre-hook chain entirely (the M1 `converted`-mirror precedent).
 */
export async function markQuoteSent(input: QuoteLifecycleInput): Promise<void> {
  const { organizationId, userId, quoteInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const quoteRecordId = toRecordId('quote', quoteInstanceId)

  const { status, requestRecordId } = await getQuoteStatusAndRequest(
    handler,
    organizationId,
    quoteRecordId
  )
  assertStatus(status, 'draft', 'mark as sent')

  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: quoteRecordId,
    values: [{ fieldId: 'quote_status', value: 'sent' }],
  })

  if (requestRecordId) {
    await fieldValueService.setValuesForEntity({
      recordId: requestRecordId,
      values: [{ fieldId: 'service_request_status', value: 'quoted' }],
    })
  }
}

/**
 * Approve a sent quote (money MQ1 build spec §F.3). Mirrors the linked request to
 * `approved` if present.
 */
export async function approveQuote(input: QuoteLifecycleInput): Promise<void> {
  const { organizationId, userId, quoteInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const quoteRecordId = toRecordId('quote', quoteInstanceId)

  const { status, requestRecordId } = await getQuoteStatusAndRequest(
    handler,
    organizationId,
    quoteRecordId
  )
  assertStatus(status, 'sent', 'approve')

  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: quoteRecordId,
    values: [{ fieldId: 'quote_status', value: 'approved' }],
  })

  if (requestRecordId) {
    await fieldValueService.setValuesForEntity({
      recordId: requestRecordId,
      values: [{ fieldId: 'service_request_status', value: 'approved' }],
    })
  }
}

/**
 * Decline a sent quote (money MQ1 build spec §F.3). No request mirror — the request
 * stays `quoted`; the dispatcher decides lost/contacted manually.
 */
export async function declineQuote(input: QuoteLifecycleInput): Promise<void> {
  const { organizationId, userId, quoteInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const quoteRecordId = toRecordId('quote', quoteInstanceId)

  const { status } = await getQuoteStatusAndRequest(handler, organizationId, quoteRecordId)
  assertStatus(status, 'sent', 'decline')

  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: quoteRecordId,
    values: [{ fieldId: 'quote_status', value: 'declined' }],
  })
}

/**
 * Create a draft quote from a service request (money MQ1 build spec §F.3) — the M1
 * `convertRequestToWorkOrder` read pattern. Copies title/contact onto the new quote
 * and links `quote_request` back to the source. The request's own status is NOT
 * touched here — it flips on send, not on create (01-ui #5).
 *
 * One-active-quote guard: rejects if a quote already exists for this request whose
 * status isn't `declined`/`canceled` (single query, `not in` on `quote:status`).
 */
export async function createQuoteFromRequest(input: CreateQuoteFromRequestInput) {
  const { organizationId, userId, requestInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const requestRecordId = toRecordId('service_request', requestInstanceId)

  const existing = await handler.listFiltered({
    entityDefinitionId: 'quote',
    filters: [
      {
        id: 'active-quote-guard',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'active-quote-guard-request',
            fieldId: 'quote:request',
            operator: 'is',
            value: requestRecordId,
          },
          {
            id: 'active-quote-guard-status',
            fieldId: 'quote:status',
            operator: 'not in',
            value: ['declined', 'canceled'],
          },
        ],
      },
    ],
    limit: 1,
    mode: 'oneshot',
  })
  if (existing.ids.length > 0) {
    throw new BadRequestError('An active quote already exists for this service request')
  }

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['service_request_title', 'service_request_contact'] as const)

  const fieldIds = [cf.service_request_title, cf.service_request_contact]
    .filter(Boolean)
    .map((f) => f!.id)
  const requestValues = await handler.getFieldValues(requestRecordId, fieldIds)

  const titleTyped = cf.service_request_title
    ? firstTyped(requestValues.get(cf.service_request_title.id))
    : undefined
  const contactTyped = cf.service_request_contact
    ? firstTyped(requestValues.get(cf.service_request_contact.id))
    : undefined

  const title = titleTyped ? (extractValue(titleTyped) as string) : undefined
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined

  // Prefill validUntil/terms/deposit from the org's Documents settings (money MQ2 build spec
  // §F.5, deposit fields added by money MP2 §B.3) — always unset at this point (this is the
  // only quote-create path today), so "only prefill when empty" is trivially satisfied by
  // setting them unconditionally here.
  const { getOrganizationSetting } = await import('../settings/settings-service')
  const [validDays, defaultTerms, depositType, depositValue] = await Promise.all([
    getOrganizationSetting({ organizationId, key: 'documents.quote.validDays' }),
    getOrganizationSetting({ organizationId, key: 'documents.quote.defaultTerms' }),
    getOrganizationSetting({ organizationId, key: 'documents.quote.depositType' }),
    getOrganizationSetting({ organizationId, key: 'documents.quote.depositValue' }),
  ])
  const validUntil = new Date(Date.now() + Number(validDays ?? 30) * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const values: Record<string, unknown> = {
    quote_title: title || `Quote for ${requestInstanceId}`,
    quote_request: requestRecordId,
    quote_valid_until: validUntil,
    quote_deposit_type: depositType ?? 'none',
    quote_deposit_value: Number(depositValue ?? 0),
  }
  if (contactRecordId) values.quote_contact = contactRecordId
  if (defaultTerms) values.quote_terms = defaultTerms

  // Events ON (user-triggered): the §E.2 auto-number pre-hook fires like any create.
  return handler.create('quote', values)
}
