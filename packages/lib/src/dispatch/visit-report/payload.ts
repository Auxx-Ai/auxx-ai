// packages/lib/src/dispatch/visit-report/payload.ts
//
// Visit-report PDF payload (37d §5) — a per-visit proof-of-service document: visit header +
// work-order context + the QC checklist (items, notes, captioned photos). Deliberately NOT part
// of the documents registry / `DocumentPdfPayload` union: a visit is a `WorkOrderVisit` row, not
// a FieldValue-backed EntityInstance, so it has no pointer field and can't use `ensure-pdf.ts`'s
// pointer cache. The report renders on demand (see `./render.ts`), reusing the shared `parts.tsx`
// PDF building blocks + `resolvePhotoRef` from the documents module.

import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { type AddressStructValue, formatAddress } from '@auxx/utils/address'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { loadPdfContact, type QuotePdfContact } from '../../documents/payload'
import {
  type ResolvedDocumentSettings,
  resolveDocumentSettings,
} from '../../documents/resolve-settings'
import { NotFoundError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud'
import { listVisitQcItems } from '../qc'

/** A photo reference on the visit report — `"asset:<id>"`, resolved to bytes by `./render.ts`. */
export interface VisitReportPhoto {
  ref: string
  caption?: string
}

/** One checklist row on the visit report. */
export interface VisitReportChecklistItem {
  title: string
  isRequired: boolean
  checked: boolean
  /** ISO timestamp the item was checked, or `null`. */
  checkedAt: string | null
  /** Display name of whoever checked it, or `null`. */
  checkedByName: string | null
  note: string | null
  photos: VisitReportPhoto[]
}

/** Everything `<VisitReportPdf>` needs to render. */
export interface VisitReportPayload {
  /** Needed by `./render.ts` to load the logo + photo bytes server-side. */
  organizationId: string
  /** ISO — the visit's scheduled date (start time, or the recurring occurrence date). */
  visitDate: string | null
  /** ISO scheduled window, or `null` when not yet scheduled. */
  startTime: string | null
  endTime: string | null
  status: string
  assigneeName: string | null
  workOrderTitle: string | null
  workOrderNumber: string | null
  instructions: string | null
  serviceAddress: string | null
  contact: QuotePdfContact
  items: VisitReportChecklistItem[]
  settings: ResolvedDocumentSettings
}

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Build the visit-report payload for one `WorkOrderVisit` — mirrors `getMyVisitDetail`'s
 * work-order/contact reads (`my-schedule.ts`) and reuses `listVisitQcItems` for the checklist.
 * Assignee + per-item checker display names are resolved in one batched `User` read.
 *
 * @throws {NotFoundError} when the visit doesn't exist in this org.
 */
export async function buildVisitReportPayload(params: {
  organizationId: string
  userId: string
  visitId: string
}): Promise<VisitReportPayload> {
  const { organizationId, userId, visitId } = params

  const visit = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
  })
  if (!visit) throw new NotFoundError('Visit not found')

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const workOrderRecordId = toRecordId('work_order', visit.workOrderId)

  const [instance, cf, settings, qc] = await Promise.all([
    database.query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, visit.workOrderId),
      columns: { displayName: true },
    }),
    cache
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'work_order_number',
        'work_order_description',
        'work_order_contact',
        'work_order_address',
      ] as const),
    resolveDocumentSettings(organizationId),
    listVisitQcItems(organizationId, visitId),
  ])

  const woFieldIds = [
    cf.work_order_number,
    cf.work_order_description,
    cf.work_order_contact,
    cf.work_order_address,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const woValues = await handler.getFieldValues(workOrderRecordId, woFieldIds)
  const get = (f?: { id: string } | null) => (f ? firstTyped(woValues.get(f.id)) : undefined)

  const numberTyped = get(cf.work_order_number)
  const descriptionTyped = get(cf.work_order_description)
  const contactTyped = get(cf.work_order_contact)
  const addressTyped = get(cf.work_order_address)

  const workOrderNumber = numberTyped ? (extractValue(numberTyped) as string) : null
  const instructions = descriptionTyped ? (extractValue(descriptionTyped) as string) : null
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  const domesticCountry = settings.business.address?.country
  const serviceAddress =
    addressTyped?.type === 'json'
      ? formatAddress(addressTyped.value as Partial<AddressStructValue>, { domesticCountry }) ||
        null
      : null

  const contact = await loadPdfContact(cache, handler, organizationId, contactRecordId)

  // Resolve assignee + per-item checker display names in one read.
  const userIds = new Set<string>()
  if (visit.assigneeUserId) userIds.add(visit.assigneeUserId)
  for (const item of qc.items) if (item.checkedByUserId) userIds.add(item.checkedByUserId)
  const nameById = new Map<string, string>()
  if (userIds.size > 0) {
    const users = await database.query.User.findMany({
      where: inArray(schema.User.id, [...userIds]),
      columns: { id: true, name: true },
    })
    for (const u of users) nameById.set(u.id, u.name ?? '')
  }

  const items: VisitReportChecklistItem[] = qc.items.map((item) => ({
    title: item.title,
    isRequired: item.isRequired,
    checked: !!item.checkedAt,
    checkedAt: item.checkedAt ? item.checkedAt.toISOString() : null,
    checkedByName: item.checkedByUserId ? nameById.get(item.checkedByUserId) || null : null,
    note: item.note,
    photos: item.photos
      .filter((p) => p.assetId)
      .map((p) =>
        p.caption
          ? { ref: `asset:${p.assetId}`, caption: p.caption }
          : { ref: `asset:${p.assetId}` }
      ),
  }))

  return {
    organizationId,
    visitDate: visit.startTime ? visit.startTime.toISOString() : (visit.occurrenceDate ?? null),
    startTime: visit.startTime ? visit.startTime.toISOString() : null,
    endTime: visit.endTime ? visit.endTime.toISOString() : null,
    status: visit.status,
    assigneeName: visit.assigneeUserId ? nameById.get(visit.assigneeUserId) || null : null,
    workOrderTitle: instance?.displayName ?? null,
    workOrderNumber,
    instructions,
    serviceAddress,
    contact,
    items,
    settings,
  }
}
