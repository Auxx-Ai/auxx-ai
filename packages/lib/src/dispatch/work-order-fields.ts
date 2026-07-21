// packages/lib/src/dispatch/work-order-fields.ts
//
// One sanctioned reader for work-order field projections across the dispatch surfaces
// (board/digest/notify/schedule). Resolves the requested system-attribute field ids from the
// org cache, then reads them through `FieldValueService.batchGetValues` — a single typed,
// org-scoped, O(1)-query fetch for the whole work-order set — replacing the hand-rolled
// `database.select().from(FieldValue)` + manual scalar/JSON extraction each caller used to
// repeat. Values come back already typed, so there's no per-column coalescing here.

import { extractValue } from '@auxx/types'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { type AddressStructValue, formatAddress } from '@auxx/utils/address'
import { getOrgCache } from '../cache'
import { resolveDocumentSettings } from '../documents'
import { FieldValueService } from '../field-values/field-value-service'

/** The work-order attributes callers can project — mapped to their system attribute. */
export type WorkOrderProjectionAttr =
  | 'number'
  | 'title'
  | 'description'
  | 'address'
  | 'status'
  | 'contact'

const ATTR_TO_SYSTEM_ATTRIBUTE = {
  number: 'work_order_number',
  title: 'work_order_title',
  description: 'work_order_description',
  address: 'work_order_address',
  status: 'work_order_status',
  contact: 'work_order_contact',
} as const satisfies Record<WorkOrderProjectionAttr, SystemAttribute>

/** Projected work-order fields — only the requested attrs are populated. */
export interface WorkOrderProjection {
  /** `work_order_number` scalar. */
  number?: string
  /** `work_order_title` scalar. */
  title?: string
  /** `work_order_description` scalar. */
  description?: string
  /** `work_order_address` rendered single-line (via {@link formatAddress}), null when empty. */
  address?: string
  /** `work_order_status` scalar (option id or text). */
  status?: string
  /** `work_order_contact` related RecordId — resolve the display name separately. */
  contactRecordId?: RecordId
}

/**
 * Read a bounded set of work orders' field projections in one typed batch. Attributes not in
 * `attrs` (or not configured for the org) are simply absent from each entry. Every requested
 * work-order id gets a (possibly empty) map entry so callers can `.get(id)` without a null check.
 *
 * @param userId - Acting user for the FieldValueService context, or `undefined` for system
 *   sweeps (the daily digest) — reads are org-scoped regardless of who's asking.
 */
export async function getWorkOrderProjections(
  organizationId: string,
  userId: string | undefined,
  workOrderIds: string[],
  attrs: readonly WorkOrderProjectionAttr[]
): Promise<Map<string, WorkOrderProjection>> {
  const result = new Map<string, WorkOrderProjection>()
  for (const id of workOrderIds) result.set(id, {})
  if (workOrderIds.length === 0 || attrs.length === 0) return result

  const systemAttributes = attrs.map((a) => ATTR_TO_SYSTEM_ATTRIBUTE[a])
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(systemAttributes)

  // Org's business-address country (decision #10), only fetched when `address` is actually
  // requested — cache-backed via `getAllOrganizationSettings`, so this is cheap either way.
  const domesticCountry = attrs.includes('address')
    ? (await resolveDocumentSettings(organizationId)).business.address?.country
    : undefined

  // Map each field ref back to the attr it satisfies (batchGetValues echoes the ref we pass),
  // and build the batch refs.
  const attrByRef = new Map<string, WorkOrderProjectionAttr>()
  const fieldReferences: ResourceFieldId[] = []
  for (const attr of attrs) {
    const field = cf[ATTR_TO_SYSTEM_ATTRIBUTE[attr]]
    if (!field) continue
    const ref = toResourceFieldId('work_order', field.id)
    attrByRef.set(ref, attr)
    fieldReferences.push(ref)
  }
  if (fieldReferences.length === 0) return result

  const service = new FieldValueService(organizationId, userId)
  const { values } = await service.batchGetValues({
    recordIds: workOrderIds.map((id) => toRecordId('work_order', id)),
    fieldReferences,
  })

  for (const row of values) {
    const workOrderId = parseRecordId(row.recordId).entityInstanceId
    const entry = result.get(workOrderId)
    if (!entry) continue
    const attr = typeof row.fieldRef === 'string' ? attrByRef.get(row.fieldRef) : undefined
    if (!attr) continue
    // These work-order fields are all single-value; take the first if an array comes back.
    const typed = Array.isArray(row.value) ? row.value[0] : row.value
    if (!typed) continue

    if (attr === 'address') {
      if (typed.type === 'json') {
        entry.address =
          formatAddress(typed.value as Partial<AddressStructValue>, { domesticCountry }) ||
          undefined
      }
    } else if (attr === 'contact') {
      if (typed.type === 'relationship') entry.contactRecordId = typed.recordId
    } else {
      // attr narrowed to 'number' | 'title' | 'description' | 'status' — all string fields.
      entry[attr] = extractValue(typed) as string
    }
  }

  return result
}
