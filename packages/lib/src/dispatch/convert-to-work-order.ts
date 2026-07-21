// packages/lib/src/dispatch/convert-to-work-order.ts

import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'
import { convertQuoteToWorkOrder } from '../money/convert-quote'
import { UnifiedCrudHandler } from '../resources/crud'
import type { ConvertRequestToWorkOrderInput } from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Convert a service request into a work order (01 §8/§9 PRIMARY intake path). Copies the
 * request's title/description/contact/address onto the new work order and links
 * `work_order_request` back to the source request, then flips the request's own status to
 * `converted`.
 *
 * The request is NEVER deleted or archived (README/01 §9) — it stays the historical record.
 * The status write goes through `FieldValueService` directly (the `writeThreadVisitFields`
 * mirror-service precedent, `chat/visit-fields.ts`) — NOT `handler.update()` — because the
 * §F.4b `rejectManualMirroredStatus` system pre-hook rejects manual `converted` writes on the
 * `UnifiedCrudHandler` path. This mutation is the one sanctioned writer. Events stay on
 * (`setValuesForEntity` defaults `publishEvents: true`) so timeline/realtime/record rules still
 * see the transition.
 *
 * @param input - organizationId, userId (acting user), requestInstanceId (EntityInstance id)
 * @returns The created work order (`CreateEntityResult` shape from `UnifiedCrudHandler.create`)
 */
export async function convertRequestToWorkOrder(input: ConvertRequestToWorkOrderInput) {
  const { organizationId, userId, requestInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  const requestRecordId = toRecordId('service_request', requestInstanceId)

  // Money MQ1 (01-ui #5): if an approved quote already exists for this request, convert
  // THROUGH the quote instead — same request status flip, but lines come along too.
  // Delegates to `convertQuoteToWorkOrder`, which does its own status allowlist + active-job
  // guard and request→'converted' mirror, so we return early rather than falling through to
  // the plain (line-less) path below.
  const approvedQuotes = await handler.listFiltered({
    entityDefinitionId: 'quote',
    filters: [
      {
        id: 'approved-quote-for-request',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'approved-quote-for-request-c1',
            fieldId: 'quote:request',
            operator: 'is',
            value: requestRecordId,
          },
          {
            id: 'approved-quote-for-request-c2',
            fieldId: 'quote:status',
            operator: 'is',
            value: 'approved',
          },
        ],
      },
    ],
    limit: 1,
    mode: 'oneshot',
  })
  if (approvedQuotes.ids.length > 0) {
    return convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: approvedQuotes.ids[0]!,
    })
  }

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'service_request_title',
      'service_request_description',
      'service_request_contact',
      'service_request_address',
      'service_request_number',
    ] as const)

  const fieldIds = [
    cf.service_request_title,
    cf.service_request_description,
    cf.service_request_contact,
    cf.service_request_address,
    cf.service_request_number,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const requestValues = await handler.getFieldValues(requestRecordId, fieldIds)

  const titleTyped = cf.service_request_title
    ? firstTyped(requestValues.get(cf.service_request_title.id))
    : undefined
  const descriptionTyped = cf.service_request_description
    ? firstTyped(requestValues.get(cf.service_request_description.id))
    : undefined
  const contactTyped = cf.service_request_contact
    ? firstTyped(requestValues.get(cf.service_request_contact.id))
    : undefined
  const addressTyped = cf.service_request_address
    ? firstTyped(requestValues.get(cf.service_request_address.id))
    : undefined
  const numberTyped = cf.service_request_number
    ? firstTyped(requestValues.get(cf.service_request_number.id))
    : undefined

  const title = titleTyped ? (extractValue(titleTyped) as string) : undefined
  const description = descriptionTyped ? (extractValue(descriptionTyped) as string) : undefined
  const requestNumber = numberTyped ? (extractValue(numberTyped) as string) : undefined
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  const serviceAddress = addressTyped?.type === 'json' ? addressTyped.value : undefined

  const values: Record<string, unknown> = {
    work_order_title: title || `Work order for ${requestNumber ?? requestInstanceId}`,
    work_order_description: description,
    work_order_status: 'new',
    work_order_request: requestRecordId,
    // jobType left at default 'one_off' — convert never sets it
  }
  if (contactRecordId) values.work_order_contact = contactRecordId
  if (serviceAddress) values.work_order_address = serviceAddress

  // Events ON (user-triggered): timeline + realtime `record:created` + the §F.4a number hook +
  // the visit auto-create hook all fire. The inverse (service_request_work_orders) syncs
  // automatically from the work_order_request RecordId value.
  const created = await handler.create('work_order', values)

  // The request is NEVER deleted or archived — it stays the historical record, just flips to
  // `converted`. Bypasses the §F.4b guard by writing through FieldValueService directly instead
  // of handler.update().
  const statusCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['service_request_status'] as const)
  if (statusCf.service_request_status) {
    const fieldValueService = new FieldValueService(organizationId, userId)
    await fieldValueService.setValuesForEntity({
      recordId: requestRecordId,
      values: [{ fieldId: statusCf.service_request_status.id, value: 'converted' }],
    })
  }

  return created
}
