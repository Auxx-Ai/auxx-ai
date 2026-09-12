// packages/lib/src/returns/evidence-pack-payload.ts

/**
 * The chargeback evidence pack's payload, and the pure function that assembles
 * it (plans/money/tasks/54-returns.md section 7).
 *
 * Six sections, in the order a card network reads them:
 *
 * 1. The order - what was agreed and what was paid.
 * 2. Proof it shipped and was delivered undamaged - the dispatch, the tracking,
 *    the carrier status, the delivery scan.
 * 3. What the customer asked for and why, IN THEIR WORDS.
 * 4. What we found - the inspection, the condition grade, the liability verdict
 *    and the timestamped photos.
 * 5. Every message either way, INCLUDING call recordings and voicemails.
 * 6. What we credited and what we withheld.
 *
 * 🛑 **The pack must not fabricate certainty.** A return with no order, no
 * contact and no ticket is the 15 percent dock case (section 3.2) and still
 * produces a pack - one that says what is known and what is not. Every section
 * therefore carries a `note`: null when the section has data, and otherwise a
 * sentence that distinguishes "there was nothing" from "we did not look",
 * because those read identically to a reviewer otherwise. A section never
 * silently vanishes.
 *
 * The assembly below is PURE - no database, no clock, no randomness - so the
 * sentences the pack asserts are testable without a fixture org, which is why
 * every import in this file is TYPE-ONLY. The reads live in
 * `evidence-pack-reads.ts`, the registry entry point in
 * `evidence-pack-build.ts`, and the action that renders and stores the PDF in
 * `evidence-pack.ts`.
 */

import type { PdfPhotoRef, QuotePdfContact } from '../documents/payload'
import type { ResolvedDocumentSettings } from '../documents/resolve-settings'
import type { EvidencePackAttachmentSource, ReturnEvidencePackSources } from './evidence-pack-reads'

/**
 * Where a reviewer fetches an attachment's bytes.
 *
 * A PDF cannot embed audio, so a call recording is listed with its date, its
 * duration and this path. The route is authenticated - the pack names the
 * evidence, it does not publish it.
 */
export const EVIDENCE_ATTACHMENT_PATH = '/api/attachments'

/** The resolvable reference the pack prints next to a recording. */
export function evidenceAttachmentHref(attachmentId: string): string {
  return `${EVIDENCE_ATTACHMENT_PATH}/${attachmentId}/download`
}

/** One sold line, as section 1 prints it. */
export interface EvidencePackOrderLine {
  lineItemId: string
  name: string
  /** Units SOLD on that line, not units returned. */
  qty: number | null
  /** Integer minor units. */
  unitPriceMinor: number | null
  lineTotalMinor: number | null
}

/** Section 1: what was agreed and what was paid. */
export interface EvidencePackOrderSection {
  number: string | null
  placedAt: string | null
  financialStatus: string | null
  /** Integer minor units. */
  subtotalMinor: number | null
  taxTotalMinor: number | null
  shippingTotalMinor: number | null
  totalMinor: number | null
  lines: EvidencePackOrderLine[]
}

/** One parcel's carrier evidence, as section 2 prints it. */
export interface EvidencePackParcel {
  trackingNumber: string | null
  status: string | null
  statusDescription: string | null
  /** ISO instant of the carrier's delivery scan. Null is the ordinary case. */
  deliveredAt: string | null
  receivedBy: string | null
}

/** One dispatch, as section 2 prints it. */
export interface EvidencePackDispatch {
  label: string
  status: string
  shippedAt: string | null
  trackingNumber: string | null
  trackingCompany: string | null
  trackingUrl: string | null
  /** Per-line shipped quantities, named. */
  lines: Array<{ name: string; quantity: number }>
  parcels: EvidencePackParcel[]
  /**
   * Why there is no delivery scan under this dispatch, or null when there is
   * one. Never blank: a reviewer must not read "no scan" as "not delivered".
   */
  deliveryNote: string | null
}

/** One attachment on a message. Audio is the reason this type exists. */
export interface EvidencePackAttachment {
  attachmentId: string
  name: string
  mimeType: string | null
  sizeBytes: number | null
  /** True for an audio file - a call recording or a voicemail. */
  audio: boolean
  /** The authenticated path that resolves the bytes. */
  href: string
}

/** One message either way, as section 5 prints it. */
export interface EvidencePackMessage {
  /** `Message.id` - the id a reviewer quotes when asking for the original. */
  messageId: string
  /** ISO instant. */
  at: string
  direction: 'Inbound' | 'Outbound'
  /** `Email`, `SMS`, `Chat`, `Call`, `Voicemail`. */
  kind: string
  threadSubject: string
  subject: string | null
  /** Plain text excerpt, already truncated by the reader. */
  body: string | null
  bodyTruncated: boolean
  /** `2:05`, or null when the message is not a call. */
  duration: string | null
  /** `Answered` / `Missed`, or null when the message is not a call. */
  callOutcome: string | null
  attachments: EvidencePackAttachment[]
}

/** One linked credit memo, as section 6 prints it. */
export interface EvidencePackCreditMemo {
  number: string | null
  status: string | null
  source: string | null
  issuedAt: string | null
  /** Integer minor units. */
  totalMinor: number | null
  amountRefundedMinor: number | null
}

/**
 * One returned line - section 4, our findings.
 *
 * The customer's own words moved to the return header (plan 56 §5: one email
 * or call covers the whole return, not one line of it), so this carries only
 * the inspector's verdict.
 *
 * Named `lines` on the payload because `documents/render.ts` resolves photo
 * refs off `payload.lines[].photos` for every document type; this is that
 * contract, not a coincidence.
 */
export interface EvidencePackLine {
  returnLineId: string
  /** The part, or the sold line's name, or a plain statement that neither is recorded. */
  name: string
  /** Units returned. */
  quantity: number | null
  /** Section 4. */
  conditionGrade: string | null
  liability: string | null
  inspectionNotes: string | null
  /** ISO instant. */
  inspectedAt: string | null
  /** Why section 4 is empty on this line, or null when it has been inspected. */
  inspectionNote: string | null
  /** Photo capture timestamps, ISO, aligned index-for-index with `photos`. */
  photoCapturedAt: string[]
  photos?: PdfPhotoRef[]
}

/**
 * Everything `<ReturnEvidencePackPdf>` renders.
 *
 * `number`, `lines`, `photos` and `settings` are the shared document-payload
 * contract (`documents/render.ts` reads all four); the rest is this document's
 * own.
 */
export interface ReturnEvidencePackPdfPayload {
  documentType: 'return_evidence_pack'
  /** Needed by `render.ts` to load the logo bytes server-side. */
  organizationId: string
  /** `RMA-0001`, falling back to the instance id when unnumbered. */
  number: string
  /** ISO instant. The return's creation, never `new Date()` - that would defeat
   * the content-hash cache and re-render the pack on every call. */
  issuedAt: string
  currency: string
  status: string | null
  origin: string | null
  reasons: string[]
  /** Section 3, verbatim - the customer's own words, once for the whole return. */
  customerNote: string | null
  /** Why section 3 is empty, or null when the customer said something. */
  customerWordsNote: string | null
  contact: QuotePdfContact
  /** 🛑 Derived from `contact IS NULL`, never from a status value (section 3.2). */
  identified: boolean
  senderNameRaw: string | null
  senderAddressRaw: string | null
  inboundCarrier: string | null
  inboundTracking: string | null
  order: EvidencePackOrderSection | null
  orderNote: string | null
  dispatches: EvidencePackDispatch[]
  dispatchNote: string | null
  lines: EvidencePackLine[]
  linesNote: string | null
  correspondence: EvidencePackMessage[]
  correspondenceNote: string | null
  /** True when the ticket carries more messages than the pack prints. */
  correspondenceTruncated: boolean
  creditMemos: EvidencePackCreditMemo[]
  /** Integer minor units, transcribed. */
  goodsValueMinor: number | null
  creditedAmountMinor: number | null
  withheldAmountMinor: number | null
  withheldReason: string | null
  moneyNote: string | null
  settings: ResolvedDocumentSettings
  /** `return_photos` - the shipping label, the pallet, the carrier paperwork. */
  photos?: PdfPhotoRef[]
  /** Capture timestamps aligned index-for-index with `photos`. */
  photoCapturedAt: string[]
}

/**
 * Turn the gathered sources into the rendered payload. Pure.
 *
 * Every branch that produces an empty section also produces the sentence that
 * says why, which is the only thing standing between this document and the
 * quiet implication that we looked and found nothing.
 */
export function assembleReturnEvidencePack(input: {
  organizationId: string
  sources: ReturnEvidencePackSources
  contact: QuotePdfContact
  settings: ResolvedDocumentSettings
}): ReturnEvidencePackPdfPayload {
  const { organizationId, sources, contact, settings } = input
  const record = sources.returnRecord

  const order = buildOrderSection(sources)
  const dispatches = buildDispatchSections(sources)
  const lines = buildLineSections(sources)
  const correspondence = buildCorrespondence(sources)
  const creditMemos = sources.creditMemos.map(
    (memo): EvidencePackCreditMemo => ({
      number: memo.number,
      status: humanize(memo.status),
      source: humanize(memo.source),
      issuedAt: memo.issuedAt,
      totalMinor: memo.totalMinor,
      amountRefundedMinor: memo.amountRefundedMinor,
    })
  )

  return {
    documentType: 'return_evidence_pack',
    organizationId,
    number: record.number || record.returnId,
    issuedAt: record.createdAt.toISOString(),
    currency: sources.order?.currency || settings.currency,
    status: humanize(record.status),
    origin: humanize(record.origin),
    reasons: record.reasons.map((reason) => humanize(reason) ?? reason),
    customerNote: record.customerNote,
    customerWordsNote:
      record.reasons.length === 0 && record.customerNote === null ? NO_CUSTOMER_WORDS : null,
    contact,
    identified: !record.unidentified,
    senderNameRaw: record.senderNameRaw,
    senderAddressRaw: record.senderAddressRaw,
    inboundCarrier: record.inboundCarrier,
    inboundTracking: record.inboundTracking,
    order,
    orderNote: orderNote(sources),
    dispatches,
    dispatchNote: dispatchNote(sources),
    lines,
    linesNote: lines.length > 0 ? null : NO_LINES,
    correspondence,
    correspondenceNote: correspondenceNote(sources),
    correspondenceTruncated: sources.correspondenceTruncated,
    creditMemos,
    goodsValueMinor: record.goodsValue,
    creditedAmountMinor: record.creditedAmount,
    withheldAmountMinor: record.withheldAmount,
    withheldReason: record.withheldReason,
    moneyNote: moneyNote(sources),
    settings,
    photos: sources.returnPhotos.map(toPhotoRef),
    photoCapturedAt: sources.returnPhotos.map((photo) => photo.capturedAt.toISOString()),
  }
}

// ─── the sentences, and the sections they belong to ─────────────────

const NO_ORDER_DEF =
  'This organization records no orders, so the sale behind this return could not be attached.'
const NO_ORDER_LINKED =
  'No order is linked to this return. The goods arrived without one being identified; ' +
  'nothing below asserts what was sold or paid.'
const NO_DISPATCH_DEF =
  'This organization records no dispatches, so no shipping or delivery evidence could be ' +
  'attached.'
const NO_DISPATCH_ORDER =
  'No order is linked to this return, so there is no dispatch to trace. This is not a ' +
  'statement that nothing shipped.'
const NO_DISPATCH_RECORDS =
  'The linked order carries no dispatch records. This is not a statement that nothing ' +
  'shipped, only that no dispatch was recorded here.'
const NO_DELIVERY_SCAN =
  'No carrier delivery scan is on file for this dispatch. The scan is matched to a dispatch ' +
  'opportunistically by tracking number and is absent for most dispatches, so its absence is ' +
  'not evidence that delivery failed.'
const NO_TICKET =
  'No support ticket is linked to this return, so no correspondence was collected. This is ' +
  'not a statement that none exists.'
const NO_MESSAGES = 'The linked ticket carries no messages.'
const NO_LINES =
  'No returned lines have been recorded against this return, so no condition, liability or ' +
  'inspection finding is asserted here.'
// Return-level, rendered once (plan 56 §5): the customer's words are no
// longer per-line, so their absence is no longer a per-line statement either.
const NO_CUSTOMER_WORDS = 'The customer gave no reason or note that was recorded.'
const NO_INSPECTION = 'This line has not been inspected. No condition or liability is asserted.'
const NO_MONEY =
  'No credit memo is linked to this return and no goods value was transcribed, so nothing ' +
  'below asserts what was credited or withheld.'

function orderNote(sources: ReturnEvidencePackSources): string | null {
  if (!sources.ordersProvisioned) return NO_ORDER_DEF
  if (!sources.order) return NO_ORDER_LINKED
  return null
}

function dispatchNote(sources: ReturnEvidencePackSources): string | null {
  if (!sources.dispatchesProvisioned) return NO_DISPATCH_DEF
  if (!sources.order) return NO_DISPATCH_ORDER
  if (sources.dispatches.length === 0) return NO_DISPATCH_RECORDS
  return null
}

function correspondenceNote(sources: ReturnEvidencePackSources): string | null {
  if (!sources.correspondenceSearched) return NO_TICKET
  if (sources.correspondence.length === 0) return NO_MESSAGES
  return null
}

function moneyNote(sources: ReturnEvidencePackSources): string | null {
  const record = sources.returnRecord
  if (sources.creditMemos.length === 0 && record.goodsValue === null) return NO_MONEY
  return null
}

function buildOrderSection(sources: ReturnEvidencePackSources): EvidencePackOrderSection | null {
  const order = sources.order
  if (!order) return null

  // Only the sold lines this return actually names. A card network is reading
  // about the returned goods, not the whole basket.
  const lines: EvidencePackOrderLine[] = []
  const seen = new Set<string>()
  for (const line of sources.returnRecord.lines) {
    if (!line.lineItemId || seen.has(line.lineItemId)) continue
    seen.add(line.lineItemId)
    const sold = sources.lineItems.get(line.lineItemId)
    lines.push({
      lineItemId: line.lineItemId,
      name: sold?.name || fallbackLineName(sources, line.partId),
      qty: sold?.qty ?? null,
      unitPriceMinor: sold?.unitPriceMinor ?? null,
      lineTotalMinor: sold?.lineTotalMinor ?? null,
    })
  }

  return {
    number: order.number,
    placedAt: order.placedAt,
    financialStatus: humanize(order.financialStatus),
    subtotalMinor: order.subtotalMinor,
    taxTotalMinor: order.taxTotalMinor,
    shippingTotalMinor: order.shippingTotalMinor,
    totalMinor: order.totalMinor,
    lines,
  }
}

function buildDispatchSections(sources: ReturnEvidencePackSources): EvidencePackDispatch[] {
  return sources.dispatches.map((dispatch) => {
    const parcels = dispatch.parcels.map(
      (parcel): EvidencePackParcel => ({
        trackingNumber: parcel.trackingNumber,
        status: humanize(parcel.status),
        statusDescription: parcel.statusDescription,
        deliveredAt: parcel.deliveredAt,
        receivedBy: parcel.receivedBy,
      })
    )
    const scanned = parcels.some((parcel) => parcel.deliveredAt !== null)
    return {
      label: dispatch.name || `Dispatch ${dispatch.sequence}`,
      status: humanize(dispatch.status) ?? dispatch.status,
      shippedAt: dispatch.shippedAt,
      trackingNumber: dispatch.trackingNumber,
      trackingCompany: dispatch.trackingCompany,
      trackingUrl: dispatch.trackingUrl,
      lines: dispatch.lines.map((line) => ({
        name: sources.lineItems.get(line.lineItemId)?.name || `Line item ${short(line.lineItemId)}`,
        quantity: line.quantity,
      })),
      parcels,
      deliveryNote: scanned ? null : NO_DELIVERY_SCAN,
    }
  })
}

function buildLineSections(sources: ReturnEvidencePackSources): EvidencePackLine[] {
  return sources.returnRecord.lines.map((line) => {
    const photos = sources.photosByReturnLine.get(line.returnLineId) ?? []
    const inspected =
      line.conditionGrade !== null || line.liability !== null || line.inspectionNotes !== null
    return {
      returnLineId: line.returnLineId,
      name: lineName(sources, line.partId, line.lineItemId),
      quantity: line.quantity,
      conditionGrade: humanize(line.conditionGrade),
      liability: humanize(line.liability),
      inspectionNotes: line.inspectionNotes,
      inspectedAt: line.inspectedAt ? line.inspectedAt.toISOString() : null,
      inspectionNote: inspected ? null : NO_INSPECTION,
      photoCapturedAt: photos.map((photo) => photo.capturedAt.toISOString()),
      photos: photos.map(toPhotoRef),
    }
  })
}

/** `Email` / `SMS` / `Chat` / `Call` / `Voicemail`. */
const MESSAGE_KIND_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  CHAT: 'Chat',
  CALL: 'Call',
  VOICEMAIL: 'Voicemail',
}

/** An attachment whose mime type or name says audio - the recording, in other words. */
function isAudio(attachment: EvidencePackAttachmentSource): boolean {
  if (attachment.mimeType?.startsWith('audio/')) return true
  const name = attachment.title ?? ''
  return name.startsWith('recording-') || name.startsWith('voicemail.')
}

function buildCorrespondence(sources: ReturnEvidencePackSources): EvidencePackMessage[] {
  return sources.correspondence.map((message) => ({
    messageId: message.messageId,
    at: message.at.toISOString(),
    direction: message.isInbound ? ('Inbound' as const) : ('Outbound' as const),
    kind: MESSAGE_KIND_LABELS[message.messageType] ?? message.messageType,
    threadSubject: message.threadSubject,
    subject: message.subject,
    body: message.body || message.snippet,
    bodyTruncated: message.bodyTruncated,
    duration: formatDuration(message.callDurationSeconds),
    callOutcome:
      message.callAnswered === null ? null : message.callAnswered ? 'Answered' : 'Not answered',
    attachments: message.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      name: attachment.title || attachment.attachmentId,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      audio: isAudio(attachment),
      href: evidenceAttachmentHref(attachment.attachmentId),
    })),
  }))
}

/** `125` seconds becomes `2:05`. Null stays null - a text message has no duration. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  const clamped = Math.max(0, Math.round(seconds))
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`
}

/**
 * `damaged_by_customer` becomes `Damaged by customer`.
 *
 * Derived rather than a label map copied out of the resource registry: the
 * registry's labels are per-org and editable, and a stale duplicate of them
 * inside a legal document is worse than a mechanical rendering of the stored
 * value. Null passes through, because "not recorded" is a fact the pack states.
 */
export function humanize(value: string | null): string | null {
  if (!value) return null
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function toPhotoRef(photo: { ref: string; caption?: string }): PdfPhotoRef {
  return photo.caption ? { ref: photo.ref, caption: photo.caption } : { ref: photo.ref }
}

/** The last six characters of an id, for a label that has nothing better. */
function short(id: string): string {
  return id.slice(-6)
}

function fallbackLineName(sources: ReturnEvidencePackSources, partId: string | null): string {
  if (partId) {
    const name = sources.partNames.get(partId)
    if (name) return name
  }
  return 'Unnamed item'
}

function lineName(
  sources: ReturnEvidencePackSources,
  partId: string | null,
  lineItemId: string | null
): string {
  if (partId) {
    const name = sources.partNames.get(partId)
    if (name) return name
  }
  if (lineItemId) {
    const sold = sources.lineItems.get(lineItemId)
    if (sold?.name) return sold.name
  }
  return 'Unnamed item'
}
