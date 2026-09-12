// packages/lib/src/documents/pdf/return-evidence-pack-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { formatCurrency } from '@auxx/utils/currency'
import { Document, Image, Page, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import type {
  EvidencePackDispatch,
  EvidencePackLine,
  EvidencePackMessage,
  ReturnEvidencePackPdfPayload,
} from '../../returns/evidence-pack-payload'
import type { PdfPhotoRef } from '../payload'
import { DocumentFooter, DocumentHeader, formatDocDate } from './parts'
import { createDocumentStyles, pageSizeFor } from './theme'

type Styles = ReturnType<typeof createDocumentStyles>

/**
 * What the pack prints where a value was never recorded.
 *
 * 🛑 Never a blank cell. A card network reading a gap cannot tell "we looked
 * and there was nothing" from "we never looked", and the second reading is the
 * one that loses the dispute.
 */
const NOT_RECORDED = 'Not recorded'

function text(value: string | null | undefined): string {
  return value && value.length > 0 ? value : NOT_RECORDED
}

/** A section heading, numbered so a reviewer can cite it. */
function SectionHeading(props: { styles: Styles; index: number; title: string }) {
  const { styles, index, title } = props
  return (
    <View style={{ marginTop: 18, marginBottom: 6 }}>
      <Text style={[styles.value, styles.bold, styles.accentText]}>
        {index}. {title}
      </Text>
    </View>
  )
}

/**
 * The sentence a section prints instead of data.
 *
 * Rendered in the body, not as a muted aside: it is part of what the document
 * asserts.
 */
function SectionNote(props: { styles: Styles; note: string | null | undefined }) {
  const { styles, note } = props
  if (!note) return null
  return <Text style={[styles.value, { marginTop: 2, marginBottom: 4 }]}>{note}</Text>
}

/** A label above a value, the shape the rest of the document family uses. */
function Field(props: { styles: Styles; label: string; value: string | null; width?: string }) {
  const { styles, label, value, width } = props
  return (
    <View style={width ? { width } : { flexGrow: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{text(value)}</Text>
    </View>
  )
}

/** A wrapping row of `Field`s. */
function FieldRow(props: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
      {props.children}
    </View>
  )
}

/** A paragraph of the customer's or the inspector's own words. */
function Quoted(props: { styles: Styles; label: string; body: string | null }) {
  const { styles, label, body } = props
  if (!body) return null
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{body}</Text>
    </View>
  )
}

/**
 * Timestamped photo grid.
 *
 * Not `PhotoGrid` from `parts.tsx`: the timestamp under each frame is the whole
 * point here, and that component prints a caption only. A ref with no resolved
 * bytes is skipped silently, the same contract every other photo component
 * honours.
 */
function TimestampedPhotos(props: {
  styles: Styles
  title: string
  photos: PdfPhotoRef[] | undefined
  capturedAt: string[]
  photoBytes: Map<string, Buffer> | undefined
  dateFormat: string
  emptyNote: string
}) {
  const { styles, title, photos, capturedAt, photoBytes, dateFormat, emptyNote } = props
  const resolved = (photos ?? [])
    .map((photo, index) => ({
      ...photo,
      bytes: photoBytes?.get(photo.ref),
      at: capturedAt[index] ?? null,
    }))
    .filter((photo): photo is PdfPhotoRef & { bytes: Buffer; at: string | null } =>
      Boolean(photo.bytes)
    )

  if (resolved.length === 0) {
    return (
      <View style={{ marginTop: 6 }}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.value}>{emptyNote}</Text>
      </View>
    )
  }

  return (
    <View style={styles.photoSection}>
      <Text style={[styles.label, { marginBottom: 6 }]}>{title}</Text>
      <View style={styles.photoGridRow}>
        {resolved.map((photo, index) => (
          <View key={index} style={styles.photoGridCell}>
            <Image style={styles.photoGridImage} src={photo.bytes} />
            <Text style={styles.photoCaption}>
              {photo.at ? formatDocDate(photo.at, dateFormat) : NOT_RECORDED}
              {photo.caption ? ` - ${photo.caption}` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/** Section 2 body for one dispatch, delivery scan included when there is one. */
function DispatchBlock(props: {
  styles: Styles
  dispatch: EvidencePackDispatch
  dateFormat: string
}) {
  const { styles, dispatch, dateFormat } = props
  return (
    <View style={{ marginTop: 8, borderTop: '1 solid #e5e7eb', paddingTop: 6 }} wrap={false}>
      <Text style={[styles.value, styles.bold]}>{dispatch.label}</Text>
      <FieldRow>
        <Field styles={styles} label='Status' value={dispatch.status} width='22%' />
        <Field
          styles={styles}
          label='Shipped'
          value={dispatch.shippedAt ? formatDocDate(dispatch.shippedAt, dateFormat) : null}
          width='22%'
        />
        <Field styles={styles} label='Carrier' value={dispatch.trackingCompany} width='22%' />
        <Field styles={styles} label='Tracking' value={dispatch.trackingNumber} width='28%' />
      </FieldRow>
      {dispatch.trackingUrl ? (
        <Text style={[styles.value, { marginTop: 2 }]}>{dispatch.trackingUrl}</Text>
      ) : null}

      {dispatch.lines.length > 0 ? (
        <View style={{ marginTop: 4 }}>
          {dispatch.lines.map((line, index) => (
            <Text key={index} style={styles.value}>
              {line.quantity} x {line.name}
            </Text>
          ))}
        </View>
      ) : null}

      {dispatch.parcels.map((parcel, index) => (
        <FieldRow key={index}>
          <Field
            styles={styles}
            label='Parcel tracking'
            value={parcel.trackingNumber}
            width='24%'
          />
          <Field
            styles={styles}
            label='Carrier status'
            value={parcel.statusDescription || parcel.status}
            width='24%'
          />
          <Field
            styles={styles}
            label='Delivery scan'
            value={parcel.deliveredAt ? formatDocDate(parcel.deliveredAt, dateFormat) : null}
            width='24%'
          />
          <Field styles={styles} label='Received by' value={parcel.receivedBy} width='24%' />
        </FieldRow>
      ))}

      <SectionNote styles={styles} note={dispatch.deliveryNote} />
    </View>
  )
}

/** Section 4 for one returned line: the inspector's verdict. */
function ReturnLineBlock(props: {
  styles: Styles
  line: EvidencePackLine
  photoBytes: Map<string, Buffer> | undefined
  dateFormat: string
}) {
  const { styles, line, photoBytes, dateFormat } = props
  return (
    <View style={{ marginTop: 10, borderTop: '1 solid #e5e7eb', paddingTop: 6 }}>
      <Text style={[styles.value, styles.bold]}>
        {line.name}
        {line.quantity === null ? '' : ` - ${line.quantity} returned`}
      </Text>

      <FieldRow>
        <Field styles={styles} label='Condition' value={line.conditionGrade} width='30%' />
        <Field styles={styles} label='Liability' value={line.liability} width='30%' />
        <Field
          styles={styles}
          label='Inspected'
          value={line.inspectedAt ? formatDocDate(line.inspectedAt, dateFormat) : null}
          width='30%'
        />
      </FieldRow>
      <Quoted styles={styles} label='Inspection notes' body={line.inspectionNotes} />
      <SectionNote styles={styles} note={line.inspectionNote} />

      <TimestampedPhotos
        styles={styles}
        title='Inspection photos'
        photos={line.photos}
        capturedAt={line.photoCapturedAt}
        photoBytes={photoBytes}
        dateFormat={dateFormat}
        emptyNote='No photographs were taken of this line.'
      />
    </View>
  )
}

/**
 * One message.
 *
 * 🔑 A recording cannot be embedded in a PDF, so audio is LISTED: the date, the
 * duration, the file name and the attachment id, plus the authenticated path
 * that resolves the bytes. That is the difference between a rebuttal that
 * asserts a call happened and one a reviewer can verify.
 */
function MessageBlock(props: { styles: Styles; message: EvidencePackMessage; dateFormat: string }) {
  const { styles, message, dateFormat } = props
  return (
    <View style={{ marginTop: 6, borderTop: '1 solid #f3f4f6', paddingTop: 4 }} wrap={false}>
      <Text style={[styles.value, styles.bold]}>
        {formatDocDate(message.at, dateFormat)} - {message.kind} - {message.direction}
        {message.duration ? ` - ${message.duration}` : ''}
        {message.callOutcome ? ` - ${message.callOutcome}` : ''}
      </Text>
      <Text style={styles.lineDescription}>{text(message.subject || message.threadSubject)}</Text>
      {message.body ? (
        <Text style={styles.value}>
          {message.body}
          {message.bodyTruncated ? ' [...]' : ''}
        </Text>
      ) : null}
      {message.attachments.map((attachment) => (
        <Text key={attachment.attachmentId} style={styles.lineDescription}>
          {attachment.audio ? 'Audio: ' : 'File: '}
          {attachment.name} - {attachment.href}
        </Text>
      ))}
    </View>
  )
}

/**
 * The chargeback evidence pack (plans/money/tasks/54-returns.md section 7).
 *
 * Not a customer-facing document: it is assembled for a card network, a
 * processor or a lawyer, and it is the reason the rest of the returns feature
 * exists. Its contents are fixed in the order a reviewer reads them, and every
 * section prints even when it is empty, because an absent section reads as
 * "they did not look".
 */
export function ReturnEvidencePackPdf(props: {
  payload: ReturnEvidencePackPdfPayload
  logoBytes?: Buffer | null
  photoBytes?: Map<string, Buffer>
  copyLabel?: string
}) {
  const { payload, logoBytes, photoBytes, copyLabel } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const dateFormat = settings.branding.dateFormat
  const currencyCode = payload.currency
  const money = (minor: number | null): string | null =>
    minor === null ? null : formatCurrency(minor, { currencyCode })

  return (
    <Document title={`${payload.number} - Return Evidence Pack`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Return Evidence Pack'
          number={payload.number}
          issuedAt={payload.issuedAt}
          dateFormat={dateFormat}
          logoBytes={logoBytes}
          copyLabel={copyLabel}
        />

        {/* ── The return itself ──────────────────────────────────────── */}
        <FieldRow>
          <Field styles={styles} label='Status' value={payload.status} width='22%' />
          <Field styles={styles} label='Origin' value={payload.origin} width='22%' />
          <Field
            styles={styles}
            label='Reason'
            value={payload.reasons.length > 0 ? payload.reasons.join(', ') : null}
            width='30%'
          />
          <Field
            styles={styles}
            label='Customer'
            value={payload.identified ? payload.contact.name : null}
            width='22%'
          />
        </FieldRow>
        {payload.identified ? null : (
          <SectionNote
            styles={styles}
            note={
              'This return arrived without an identified sender. The transcribed shipping label ' +
              'is below and the photographs of it are in section 4.'
            }
          />
        )}
        <FieldRow>
          <Field
            styles={styles}
            label='Sender on label'
            value={payload.senderNameRaw}
            width='30%'
          />
          <Field
            styles={styles}
            label='Address on label'
            value={payload.senderAddressRaw}
            width='38%'
          />
          <Field
            styles={styles}
            label='Inbound carrier'
            value={payload.inboundCarrier}
            width='14%'
          />
          <Field
            styles={styles}
            label='Inbound tracking'
            value={payload.inboundTracking}
            width='14%'
          />
        </FieldRow>

        {/* ── 1. The order ───────────────────────────────────────────── */}
        <SectionHeading styles={styles} index={1} title='The order' />
        <SectionNote styles={styles} note={payload.orderNote} />
        {payload.order ? (
          <View>
            <FieldRow>
              <Field styles={styles} label='Order' value={payload.order.number} width='22%' />
              <Field
                styles={styles}
                label='Placed'
                value={
                  payload.order.placedAt ? formatDocDate(payload.order.placedAt, dateFormat) : null
                }
                width='22%'
              />
              <Field
                styles={styles}
                label='Payment status'
                value={payload.order.financialStatus}
                width='22%'
              />
              <Field
                styles={styles}
                label='Order total'
                value={money(payload.order.totalMinor)}
                width='22%'
              />
            </FieldRow>
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.colDescription, styles.label]}>Item sold</Text>
                <Text style={[styles.colQty, styles.label]}>Qty</Text>
                <Text style={[styles.colUnitPrice, styles.label]}>Unit price</Text>
                <Text style={[styles.colAmount, styles.label]}>Line total</Text>
              </View>
              {payload.order.lines.map((line) => (
                <View key={line.lineItemId} style={styles.tableRow}>
                  <View style={styles.colDescription}>
                    <Text style={styles.lineName}>{line.name}</Text>
                  </View>
                  <Text style={styles.colQty}>{line.qty === null ? NOT_RECORDED : line.qty}</Text>
                  <Text style={styles.colUnitPrice}>{text(money(line.unitPriceMinor))}</Text>
                  <Text style={styles.colAmount}>{text(money(line.lineTotalMinor))}</Text>
                </View>
              ))}
            </View>
            {payload.order.lines.length === 0 ? (
              <SectionNote
                styles={styles}
                note='No sold line is named by any returned line on this return.'
              />
            ) : null}
          </View>
        ) : null}

        {/* ── 2. Shipping and delivery ───────────────────────────────── */}
        <SectionHeading styles={styles} index={2} title='Shipped and delivered' />
        <SectionNote styles={styles} note={payload.dispatchNote} />
        {payload.dispatches.map((dispatch) => (
          <DispatchBlock
            key={dispatch.label}
            styles={styles}
            dispatch={dispatch}
            dateFormat={dateFormat}
          />
        ))}

        {/* ── 3 + 4. What was asked for, and what we found ───────────── */}
        <SectionHeading
          styles={styles}
          index={3}
          title='What the customer asked for, and what we found'
        />
        <SectionNote styles={styles} note={payload.linesNote} />
        <Quoted styles={styles} label='Customer note' body={payload.customerNote} />
        <SectionNote styles={styles} note={payload.customerWordsNote} />
        {payload.lines.map((line) => (
          <ReturnLineBlock
            key={line.returnLineId}
            styles={styles}
            line={line}
            photoBytes={photoBytes}
            dateFormat={dateFormat}
          />
        ))}

        <SectionHeading styles={styles} index={4} title='The consignment as it arrived' />
        <TimestampedPhotos
          styles={styles}
          title='Label, pallet and packaging'
          photos={payload.photos}
          capturedAt={payload.photoCapturedAt}
          photoBytes={photoBytes}
          dateFormat={dateFormat}
          emptyNote='No photographs of the arriving consignment were taken.'
        />

        {/* ── 5. Correspondence ──────────────────────────────────────── */}
        <SectionHeading styles={styles} index={5} title='Correspondence, calls and voicemails' />
        <SectionNote styles={styles} note={payload.correspondenceNote} />
        {payload.correspondence.length > 0 ? (
          <Text style={styles.lineDescription}>
            Audio is listed rather than embedded. Each recording is reachable at the path printed
            beside it, which resolves the stored file for a signed-in reviewer.
          </Text>
        ) : null}
        {payload.correspondence.map((message) => (
          <MessageBlock
            key={message.messageId}
            styles={styles}
            message={message}
            dateFormat={dateFormat}
          />
        ))}
        {payload.correspondenceTruncated ? (
          <SectionNote
            styles={styles}
            note={
              'The linked ticket carries more messages than this pack prints. The remainder is ' +
              'in the ticket and was not omitted deliberately.'
            }
          />
        ) : null}

        {/* ── 6. Credited and withheld ───────────────────────────────── */}
        <SectionHeading
          styles={styles}
          index={6}
          title='What was credited, and what was withheld'
        />
        <SectionNote styles={styles} note={payload.moneyNote} />
        <FieldRow>
          <Field
            styles={styles}
            label='Goods value'
            value={money(payload.goodsValueMinor)}
            width='30%'
          />
          <Field
            styles={styles}
            label='Credited'
            value={money(payload.creditedAmountMinor)}
            width='30%'
          />
          <Field
            styles={styles}
            label='Withheld'
            value={money(payload.withheldAmountMinor)}
            width='30%'
          />
        </FieldRow>
        <Quoted styles={styles} label='Why it was withheld' body={payload.withheldReason} />
        {payload.creditMemos.length > 0 ? (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.colDescription, styles.label]}>Credit memo</Text>
              <Text style={[styles.colQty, styles.label]}>Issued</Text>
              <Text style={[styles.colUnitPrice, styles.label]}>Source</Text>
              <Text style={[styles.colAmount, styles.label]}>Total</Text>
            </View>
            {payload.creditMemos.map((memo, index) => (
              <View key={memo.number ?? index} style={styles.tableRow}>
                <View style={styles.colDescription}>
                  <Text style={styles.lineName}>{text(memo.number)}</Text>
                  <Text style={styles.lineDescription}>{text(memo.status)}</Text>
                </View>
                <Text style={styles.colQty}>
                  {memo.issuedAt ? formatDocDate(memo.issuedAt, dateFormat) : NOT_RECORDED}
                </Text>
                <Text style={styles.colUnitPrice}>{text(memo.source)}</Text>
                <Text style={styles.colAmount}>{text(money(memo.totalMinor))}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <DocumentFooter styles={styles} text={settings.invoice.footerText} />
      </Page>
    </Document>
  )
}
