// packages/lib/src/returns/evidence-pack-reads.ts

/**
 * Everything the chargeback evidence pack is assembled from, gathered in one
 * pass (plans/money/tasks/54-returns.md section 7).
 *
 * Reads only. The assembly is pure and lives in `evidence-pack-payload.ts`; the
 * action that writes the PDF is `evidence-pack.ts`. No permission checks - the
 * router asserts (`docs/lib-module-guide.md` section 6).
 *
 * ## Two rules this file exists to honour
 *
 * 1. 🛑 **Nothing here refuses.** A return with no order, no contact and no
 *    ticket is the 15 percent dock case (section 3.2) and must still produce a
 *    pack. Every loader below returns an empty section rather than throwing,
 *    and the org not having a definition at all is reported as a flag rather
 *    than swallowed - "there were no messages" and "we did not look" read
 *    identically to a card network, so the payload has to be able to tell them
 *    apart.
 * 2. 🛑 **The delivery scan is opportunistic.** `fulfillment_shipment` is a
 *    one-sided, nullable edge filled by matching tracking numbers, and task 55
 *    section 2.2 permits exactly one kind of consumer to read it: support
 *    convenience. An evidence pack is that, and only that. It is null for
 *    almost every dispatch today, so a missing scan renders the section
 *    without one and never blocks generation.
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { readFulfillmentsForOrder } from '../accounting/sales/fulfillments/reads'
import { batchGetRelatedDisplayNames } from '../field-values/field-value-helpers'
import { fetchAttachmentsForEntities } from '../files/attachments'
import { CREDIT_MEMO_FIELDS } from '../resources/registry/resources/credit-memo-fields'
import { FULFILLMENT_FIELDS } from '../resources/registry/resources/fulfillment-fields'
import { LINE_ITEM_FIELDS } from '../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../resources/registry/resources/order-fields'
import { PARCEL_FIELDS } from '../resources/registry/resources/parcel-fields'
import { RETURN_FIELDS } from '../resources/registry/resources/return-fields'
import { RETURN_LINE_FIELDS } from '../resources/registry/resources/return-line-fields'
import { pickSystemAttributes } from '../resources/registry/system-attributes'
import { type RecordId, toRecordId } from '../resources/resource-id'
import { readSystemRecords, systemDefId, systemFields } from '../resources/system-records'
import { threadsForRecord } from '../threads'
import type { ReturnWithLines } from './reads'

/**
 * How many messages of the linked ticket the pack carries.
 *
 * A cap rather than everything, because a two-year support thread would
 * produce a document nobody reads - but a cap that is REPORTED, never silent:
 * `correspondenceTruncated` reaches the rendered page as a sentence.
 */
export const EVIDENCE_PACK_MESSAGE_LIMIT = 200

/** How much of one message body the pack prints before it says it cut. */
export const EVIDENCE_PACK_BODY_CHARS = 1500

/** The order the return was raised against, in the numbers a card network reads. */
export interface EvidencePackOrderSource {
  orderId: string
  number: string | null
  /** ISO instant, `order_placed_at`. */
  placedAt: string | null
  currency: string | null
  financialStatus: string | null
  /** Integer minor units. */
  subtotalMinor: number | null
  taxTotalMinor: number | null
  shippingTotalMinor: number | null
  totalMinor: number | null
}

/** One sold line a return line points at. */
export interface EvidencePackLineItemSource {
  lineItemId: string
  name: string | null
  qty: number | null
  /** Integer minor units. A rate carrying up to five decimals, printed as read. */
  unitPriceMinor: number | null
  lineTotalMinor: number | null
}

/** One parcel of a matched dispatch - where the delivery scan lives. */
export interface EvidencePackParcelSource {
  parcelId: string
  trackingNumber: string | null
  status: string | null
  statusDescription: string | null
  /** ISO instant. The carrier's delivery scan, and the whole reason for the hop. */
  deliveredAt: string | null
  receivedBy: string | null
}

/** One dispatch of the order, with whatever carrier evidence reached it. */
export interface EvidencePackDispatchSource {
  fulfillmentId: string
  sequence: number
  name: string | null
  status: string
  /** ISO instant, `fulfillment_shipped_at`. */
  shippedAt: string | null
  trackingNumber: string | null
  trackingCompany: string | null
  trackingUrl: string | null
  lines: Array<{ lineItemId: string; quantity: number }>
  /**
   * The matched `shipment`, or null - the ORDINARY case today. Never treat a
   * null here as "it was not delivered".
   */
  shipmentId: string | null
  /** Empty whenever `shipmentId` is null, and frequently empty when it is not. */
  parcels: EvidencePackParcelSource[]
}

/** One file hanging off a message. A recording is one of these. */
export interface EvidencePackAttachmentSource {
  attachmentId: string
  title: string | null
  mimeType: string | null
  sizeBytes: number | null
}

/** One message either way, from the linked ticket's threads. */
export interface EvidencePackMessageSource {
  messageId: string
  threadId: string
  threadSubject: string
  /** Best available instant: sent, then received, then row creation. */
  at: Date
  isInbound: boolean
  /** `EMAIL` | `SMS` | `CHAT` | `CALL` | `VOICEMAIL`. */
  messageType: string
  subject: string | null
  snippet: string | null
  /** Plain text, already truncated to {@link EVIDENCE_PACK_BODY_CHARS}. */
  body: string | null
  /** True when {@link body} was cut. */
  bodyTruncated: boolean
  /** `Message.metadata.call.durationSeconds`, the Quo call contract. */
  callDurationSeconds: number | null
  /** `Message.metadata.call.answered`. Null for anything that is not a call. */
  callAnswered: boolean | null
  attachments: EvidencePackAttachmentSource[]
}

/** One credit memo linked to the return. */
export interface EvidencePackCreditMemoSource {
  creditMemoId: string
  number: string | null
  status: string | null
  /** `channel` for a Shopify-issued refund the connector projected. */
  source: string | null
  /** ISO instant. */
  issuedAt: string | null
  /** Integer minor units. */
  totalMinor: number | null
  amountRefundedMinor: number | null
}

/** One FILE value, with when it was attached to the record. */
export interface EvidencePackPhotoSource {
  /** `asset:<id>` or `file:<id>`. */
  ref: string
  caption?: string
  /** When the value row was written - the closest thing to a capture time. */
  capturedAt: Date
}

/** Everything {@link assembleReturnEvidencePack} needs, and nothing derived. */
export interface ReturnEvidencePackSources {
  returnRecord: ReturnWithLines
  /** For `loadPdfContact`. Undefined on the dock case, which is not an error. */
  contactRecordId: RecordId | undefined
  /** `return_photos` - the label, the pallet, the carrier paperwork. */
  returnPhotos: EvidencePackPhotoSource[]
  /** `return_line_photos`, keyed by return line id. */
  photosByReturnLine: Map<string, EvidencePackPhotoSource[]>
  order: EvidencePackOrderSource | null
  /** False when the org has no `order` definition at all - we did not look. */
  ordersProvisioned: boolean
  lineItems: Map<string, EvidencePackLineItemSource>
  /** `EntityInstance.displayName` of every part a return line names. */
  partNames: Map<string, string>
  dispatches: EvidencePackDispatchSource[]
  /** False when the org predates the fulfillment definitions - we did not look. */
  dispatchesProvisioned: boolean
  correspondence: EvidencePackMessageSource[]
  /** False when no ticket is linked - there was nowhere to look. */
  correspondenceSearched: boolean
  /** True when the ticket carries more messages than the cap. */
  correspondenceTruncated: boolean
  creditMemos: EvidencePackCreditMemoSource[]
}

/**
 * Gather every source the pack draws on for one return.
 *
 * Bulk throughout: one query per class of thing, never one per row. The caller
 * has already read the return itself, because the action needs it to refuse a
 * missing id before any of this work starts.
 */
export async function readReturnEvidenceSources(
  db: Database,
  organizationId: string,
  returnRecord: ReturnWithLines
): Promise<ReturnEvidencePackSources> {
  const returnLineIds = returnRecord.lines.map((line) => line.returnLineId)
  const lineItemIds = unique(returnRecord.lines.map((line) => line.lineItemId))
  const partIds = unique(returnRecord.lines.map((line) => line.partId))

  const [
    contactRecordId,
    returnPhotos,
    photosByReturnLine,
    orderResult,
    lineItems,
    partNames,
    dispatchResult,
    correspondenceResult,
    creditMemos,
  ] = await Promise.all([
    resolveContactRecordId(db, organizationId, returnRecord.contactId),
    readPhotoValues(db, organizationId, 'return_photos', [returnRecord.returnId]).then(
      (byEntity) => byEntity.get(returnRecord.returnId) ?? []
    ),
    readPhotoValues(db, organizationId, 'return_line_photos', returnLineIds),
    readOrder(db, organizationId, returnRecord.orderId),
    readLineItems(db, organizationId, lineItemIds),
    readPartNames(db, organizationId, partIds),
    readDispatches(db, organizationId, returnRecord.orderId),
    readCorrespondence(db, organizationId, returnRecord.ticketId),
    readCreditMemos(db, organizationId, returnRecord.creditMemoIds),
  ])

  return {
    returnRecord,
    contactRecordId,
    returnPhotos,
    photosByReturnLine,
    order: orderResult.order,
    ordersProvisioned: orderResult.provisioned,
    lineItems,
    partNames,
    dispatches: dispatchResult.dispatches,
    dispatchesProvisioned: dispatchResult.provisioned,
    correspondence: correspondenceResult.messages,
    correspondenceSearched: correspondenceResult.searched,
    correspondenceTruncated: correspondenceResult.truncated,
    creditMemos,
  }
}

// ─── internals ──────────────────────────────────────────────────────

/** Distinct, non-null, in first-seen order. */
function unique(values: Array<string | null>): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (value) seen.add(value)
  }
  return [...seen]
}

/**
 * The contact as a `RecordId`, or undefined.
 *
 * Undefined is the dock case and not a failure: about 15 percent of returns are
 * an unannounced pallet and the record exists before anyone knows whose it is.
 */
async function resolveContactRecordId(
  db: Database,
  organizationId: string,
  contactId: string | null
): Promise<RecordId | undefined> {
  if (!contactId) return undefined
  const contactDefId = await systemDefId(db, organizationId, 'contact')
  if (!contactDefId) return undefined
  return toRecordId(contactDefId, contactId)
}

/** The photo attributes, and the entity each hangs off. */
const PHOTO_PICKS = {
  return_photos: {
    entityType: 'return',
    attributes: pickSystemAttributes(RETURN_FIELDS, ['return_photos'] as const),
  },
  return_line_photos: {
    entityType: 'return_line',
    attributes: pickSystemAttributes(RETURN_LINE_FIELDS, ['return_line_photos'] as const),
  },
} as const

/**
 * FILE values for one attribute over a set of records, keyed by record.
 *
 * The stored rows rather than the typed cells: `createdAt` on the value row is
 * what makes the photos "timestamped" - it is when the warehouse attached the
 * shot, which is the fact the pack asserts. The `internal: true` flag is
 * honoured exactly as the customer-facing payloads do it - an internal photo
 * stays out of a document that leaves the building.
 */
async function readPhotoValues<A extends 'return_photos' | 'return_line_photos'>(
  db: Database,
  organizationId: string,
  attribute: A,
  entityIds: string[]
): Promise<Map<string, EvidencePackPhotoSource[]>> {
  const byEntity = new Map<string, EvidencePackPhotoSource[]>()
  if (entityIds.length === 0) return byEntity

  const pick = PHOTO_PICKS[attribute]
  const ctx = await systemFields(db, organizationId, pick.entityType, pick.attributes)
  if (!ctx) return byEntity

  // The pack must still show the photos of an archived return or line.
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: entityIds,
    includeArchived: true,
  })
  for (const record of records) {
    const photos: EvidencePackPhotoSource[] = []
    for (const row of record.rows(attribute)) {
      const value = row.valueJson as { ref?: unknown; caption?: unknown; internal?: unknown } | null
      if (!value || typeof value.ref !== 'string' || value.internal === true) continue
      photos.push({
        ref: value.ref,
        ...(typeof value.caption === 'string' && value.caption ? { caption: value.caption } : {}),
        capturedAt: new Date(row.createdAt),
      })
    }
    if (photos.length > 0) byEntity.set(record.id, photos)
  }
  return byEntity
}

const ORDER_PICK = pickSystemAttributes(ORDER_FIELDS, [
  'order_number',
  'order_placed_at',
  'order_currency',
  'order_financial_status',
  'order_subtotal',
  'order_tax_total',
  'order_shipping_total',
  'order_total',
] as const)

/** The order header, or null. `provisioned` says whether there was one to read. */
async function readOrder(
  db: Database,
  organizationId: string,
  orderId: string | null
): Promise<{ order: EvidencePackOrderSource | null; provisioned: boolean }> {
  const ctx = await systemFields(db, organizationId, 'order', ORDER_PICK)
  if (!ctx) return { order: null, provisioned: false }
  if (!orderId) return { order: null, provisioned: true }

  // `includeArchived`: an archived order still placed the goods this pack is
  // arguing about, and a pack with no order header is the weaker document.
  const [record] = await readSystemRecords(db, organizationId, ctx, {
    ids: [orderId],
    includeArchived: true,
  })
  if (!record) return { order: null, provisioned: true }

  return {
    provisioned: true,
    order: {
      orderId,
      number: record.text('order_number'),
      placedAt: record.date('order_placed_at'),
      currency: record.text('order_currency'),
      financialStatus: record.option('order_financial_status'),
      subtotalMinor: record.number('order_subtotal'),
      taxTotalMinor: record.number('order_tax_total'),
      shippingTotalMinor: record.number('order_shipping_total'),
      totalMinor: record.number('order_total'),
    },
  }
}

const LINE_ITEM_PICK = pickSystemAttributes(LINE_ITEM_FIELDS, [
  'line_item_name',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
] as const)

/** Every sold line the return points at, in one read. */
async function readLineItems(
  db: Database,
  organizationId: string,
  lineItemIds: string[]
): Promise<Map<string, EvidencePackLineItemSource>> {
  const byId = new Map<string, EvidencePackLineItemSource>()
  if (lineItemIds.length === 0) return byId
  for (const lineItemId of lineItemIds) {
    byId.set(lineItemId, {
      lineItemId,
      name: null,
      qty: null,
      unitPriceMinor: null,
      lineTotalMinor: null,
    })
  }

  const ctx = await systemFields(db, organizationId, 'line_item', LINE_ITEM_PICK)
  if (!ctx) return byId

  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: lineItemIds,
    includeArchived: true,
  })
  for (const record of records) {
    byId.set(record.id, {
      lineItemId: record.id,
      name: record.text('line_item_name'),
      qty: record.number('line_item_qty'),
      unitPriceMinor: record.number('line_item_unit_price'),
      lineTotalMinor: record.number('line_item_line_total'),
    })
  }
  return byId
}

/** `EntityInstance.displayName` for a set of parts, in one read. */
async function readPartNames(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, string>> {
  const byId = new Map<string, string>()
  if (partIds.length === 0) return byId

  const partDefId = await systemDefId(db, organizationId, 'part')
  if (!partDefId) return byId

  const names = await batchGetRelatedDisplayNames(
    db,
    organizationId,
    partIds.map((partId) => toRecordId(partDefId, partId))
  )
  for (const [partId, displayName] of names) {
    if (displayName) byId.set(partId, displayName)
  }
  return byId
}

const PARCEL_PICK = pickSystemAttributes(PARCEL_FIELDS, [
  'parcel_shipment',
  'parcel_tracking_number',
  'parcel_status',
  'parcel_status_description',
  'parcel_delivered_at',
  'parcel_received_by',
] as const)

const FULFILLMENT_SHIPMENT_PICK = pickSystemAttributes(FULFILLMENT_FIELDS, [
  'fulfillment_shipment',
] as const)

/**
 * Every dispatch of the order, with the delivery scan attached where one was
 * matched.
 *
 * 🛑 The `fulfillment_shipment` hop is best-effort by design (task 55 section
 * 2.2). A dispatch with no matched shipment, or a shipment with no parcels,
 * comes back with an empty `parcels` array and nothing anywhere refuses.
 */
async function readDispatches(
  db: Database,
  organizationId: string,
  orderId: string | null
): Promise<{ dispatches: EvidencePackDispatchSource[]; provisioned: boolean }> {
  const ctx = await systemFields(db, organizationId, 'fulfillment', FULFILLMENT_SHIPMENT_PICK)
  if (!ctx) return { dispatches: [], provisioned: false }
  if (!orderId) return { dispatches: [], provisioned: true }

  const fulfillments = await readFulfillmentsForOrder(db, { organizationId, orderId })
  if (fulfillments.length === 0) return { dispatches: [], provisioned: true }

  const shipmentByFulfillment = new Map<string, string>()
  if (ctx.fields.fulfillment_shipment) {
    const records = await readSystemRecords(db, organizationId, ctx, {
      ids: fulfillments.map((fulfillment) => fulfillment.id),
      includeArchived: true,
    })
    for (const record of records) {
      const shipmentId = record.related('fulfillment_shipment')
      if (shipmentId) shipmentByFulfillment.set(record.id, shipmentId)
    }
  }

  const parcelsByShipment = await readParcels(db, organizationId, [
    ...new Set(shipmentByFulfillment.values()),
  ])

  return {
    provisioned: true,
    dispatches: fulfillments.map((fulfillment) => {
      const shipmentId = shipmentByFulfillment.get(fulfillment.id) ?? null
      return {
        fulfillmentId: fulfillment.id,
        sequence: fulfillment.sequence,
        name: fulfillment.name,
        status: fulfillment.status,
        shippedAt: fulfillment.shippedAt || null,
        trackingNumber: fulfillment.trackingNumber,
        trackingCompany: fulfillment.trackingCompany,
        trackingUrl: fulfillment.trackingUrl,
        lines: fulfillment.lines.map((line) => ({
          lineItemId: line.lineItemId,
          quantity: line.quantity,
        })),
        shipmentId,
        parcels: shipmentId ? (parcelsByShipment.get(shipmentId) ?? []) : [],
      }
    }),
  }
}

/** Every parcel of the named shipments, keyed by shipment. */
async function readParcels(
  db: Database,
  organizationId: string,
  shipmentIds: string[]
): Promise<Map<string, EvidencePackParcelSource[]>> {
  const byShipment = new Map<string, EvidencePackParcelSource[]>()
  if (shipmentIds.length === 0) return byShipment

  const ctx = await systemFields(db, organizationId, 'parcel', PARCEL_PICK)
  if (!ctx?.fields.parcel_shipment) return byShipment

  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'parcel_shipment', in: shipmentIds },
  })
  for (const record of records) {
    const shipmentId = record.related('parcel_shipment')
    if (!shipmentId) continue
    const parcel: EvidencePackParcelSource = {
      parcelId: record.id,
      trackingNumber: record.text('parcel_tracking_number'),
      status: record.option('parcel_status'),
      statusDescription: record.text('parcel_status_description'),
      deliveredAt: record.date('parcel_delivered_at'),
      receivedBy: record.text('parcel_received_by'),
    }
    const bucket = byShipment.get(shipmentId) ?? []
    bucket.push(parcel)
    byShipment.set(shipmentId, bucket)
  }
  return byShipment
}

const CREDIT_MEMO_PICK = pickSystemAttributes(CREDIT_MEMO_FIELDS, [
  'credit_memo_number',
  'credit_memo_status',
  'credit_memo_source',
  'credit_memo_issued_at',
  'credit_memo_total',
  'credit_memo_amount_refunded',
] as const)

/** Every linked memo, in one read, oldest first by issue date then id. */
async function readCreditMemos(
  db: Database,
  organizationId: string,
  creditMemoIds: string[]
): Promise<EvidencePackCreditMemoSource[]> {
  if (creditMemoIds.length === 0) return []

  const ctx = await systemFields(db, organizationId, 'credit_memo', CREDIT_MEMO_PICK)
  if (!ctx) return []

  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: creditMemoIds,
    includeArchived: true,
  })
  const byId = new Map(records.map((record) => [record.id, record]))

  const memos = creditMemoIds.map((creditMemoId) => {
    const record = byId.get(creditMemoId)
    return {
      creditMemoId,
      number: record?.text('credit_memo_number') ?? null,
      status: record?.option('credit_memo_status') ?? null,
      source: record?.option('credit_memo_source') ?? null,
      issuedAt: record?.date('credit_memo_issued_at') ?? null,
      totalMinor: record?.number('credit_memo_total') ?? null,
      amountRefundedMinor: record?.number('credit_memo_amount_refunded') ?? null,
    }
  })

  memos.sort((a, b) => (a.issuedAt ?? '').localeCompare(b.issuedAt ?? ''))
  return memos
}

/**
 * Every message either way on the linked ticket's threads, oldest first.
 *
 * 🔑 This is the section the whole feature is for. A rebuttal built from dated
 * emails, dated call recordings, dated voicemails, timestamped inspection
 * photos and a delivery scan is far stronger than what most merchants can
 * assemble, and the calls are the half nobody else has: a Quo `call.completed`
 * becomes a `Message` of type `CALL` or `VOICEMAIL`, and the audio arrives on
 * `call.recording.completed` as an `Attachment` on that same row. A PDF cannot
 * embed audio, so the attachment is LISTED - date, duration, file name and the
 * id that resolves it - and the reviewer fetches the bytes.
 *
 * `searched` is false when no ticket is linked. That distinction is the point:
 * "there were no messages" and "we did not look" read identically otherwise.
 */
async function readCorrespondence(
  db: Database,
  organizationId: string,
  ticketId: string | null
): Promise<{ messages: EvidencePackMessageSource[]; searched: boolean; truncated: boolean }> {
  if (!ticketId) return { messages: [], searched: false, truncated: false }

  const threads = await threadsForRecord(db, organizationId, ticketId)
  const subjectByThread = new Map(threads.map((thread) => [thread.id, thread.subject]))
  const threadIds = [...subjectByThread.keys()]
  if (threadIds.length === 0) return { messages: [], searched: true, truncated: false }

  // One over the cap, so "there is more" is a fact rather than a guess.
  const rows = await db
    .select({
      id: schema.Message.id,
      threadId: schema.Message.threadId,
      messageType: schema.Message.messageType,
      isInbound: schema.Message.isInbound,
      subject: schema.Message.subject,
      snippet: schema.Message.snippet,
      textPlain: schema.Message.textPlain,
      metadata: schema.Message.metadata,
      sentAt: schema.Message.sentAt,
      receivedAt: schema.Message.receivedAt,
      createdAt: schema.Message.createdAt,
    })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.organizationId, organizationId),
        inArray(schema.Message.threadId, threadIds)
      )
    )
    .orderBy(asc(schema.Message.createdAt))
    .limit(EVIDENCE_PACK_MESSAGE_LIMIT + 1)

  const truncated = rows.length > EVIDENCE_PACK_MESSAGE_LIMIT
  const kept = rows.slice(0, EVIDENCE_PACK_MESSAGE_LIMIT)
  if (kept.length === 0) return { messages: [], searched: true, truncated: false }

  const attachments = await readMessageAttachments(
    db,
    organizationId,
    kept.map((row) => row.id)
  )

  const messages = kept.map((row) => {
    const call = (
      row.metadata as { call?: { durationSeconds?: unknown; answered?: unknown } } | null
    )?.call
    const plain = row.textPlain?.trim() ?? null
    const bodyTruncated = plain !== null && plain.length > EVIDENCE_PACK_BODY_CHARS
    return {
      messageId: row.id,
      threadId: row.threadId,
      threadSubject: subjectByThread.get(row.threadId) ?? '',
      at: row.sentAt ?? row.receivedAt ?? row.createdAt,
      isInbound: row.isInbound,
      messageType: row.messageType,
      subject: row.subject,
      snippet: row.snippet,
      body: bodyTruncated ? plain.slice(0, EVIDENCE_PACK_BODY_CHARS) : plain,
      bodyTruncated,
      callDurationSeconds: typeof call?.durationSeconds === 'number' ? call.durationSeconds : null,
      callAnswered: typeof call?.answered === 'boolean' ? call.answered : null,
      attachments: attachments.get(row.id) ?? [],
    }
  })

  messages.sort((a, b) => a.at.getTime() - b.at.getTime())
  return { messages, searched: true, truncated }
}

/**
 * Every attachment on the named messages, keyed by message.
 *
 * A recording is an `Attachment` row with `entityType: 'MESSAGE'` whose title
 * the Quo webhook route writes as `recording-<n>.<ext>`; a voicemail is
 * `voicemail.<ext>`. Both point at a `MediaAsset`, which is where the mime type
 * and the size come from.
 */
async function readMessageAttachments(
  db: Database,
  organizationId: string,
  messageIds: string[]
): Promise<Map<string, EvidencePackAttachmentSource[]>> {
  const result = await fetchAttachmentsForEntities({ db, organizationId }, 'MESSAGE', messageIds)
  if (result.isErr()) throw result.error

  const byMessage = new Map<string, EvidencePackAttachmentSource[]>()
  for (const [messageId, attachments] of result.value) {
    byMessage.set(
      messageId,
      attachments.map((attachment) => ({
        attachmentId: attachment.id,
        title: attachment.title ?? attachment.name,
        mimeType: attachment.mimeType ?? null,
        sizeBytes: attachment.size ?? null,
      }))
    )
  }
  return byMessage
}
