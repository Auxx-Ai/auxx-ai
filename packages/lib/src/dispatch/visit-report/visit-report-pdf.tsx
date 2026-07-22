// packages/lib/src/dispatch/visit-report/visit-report-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react
//
// The visit-report PDF template (37d §5) — a proof-of-service document. Composes the shared
// document `parts.tsx` header/branding/footer with a QC checklist section (item, checked-by/at,
// note, captioned photos). Every QC photo renders (no internal/customer split, 37d).

import { Document, Image, Page, Text, View } from '@react-pdf/renderer'
import {
  BillingPartyBlock,
  DocumentFooter,
  DocumentHeader,
  formatDocDate,
} from '../../documents/pdf/parts'
import { createDocumentStyles, pageSizeFor } from '../../documents/pdf/theme'
import type { VisitReportChecklistItem, VisitReportPayload, VisitReportPhoto } from './payload'

/** Human label for a visit status (`WorkOrderVisit.status`). */
const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  en_route: 'En route',
  on_site: 'On site',
  done: 'Done',
  canceled: 'Canceled',
}

export function VisitReportPdf(props: {
  payload: VisitReportPayload
  logoBytes?: Buffer | null
  photoBytes?: Map<string, Buffer>
}) {
  const { payload, logoBytes, photoBytes } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const dateFormat = settings.branding.dateFormat

  const windowLine =
    payload.startTime && payload.endTime
      ? `${formatDocDate(payload.startTime, 'p')} – ${formatDocDate(payload.endTime, 'p')}`
      : payload.startTime
        ? formatDocDate(payload.startTime, 'p')
        : 'Not scheduled'

  const metaRows: Array<{ label: string; value: string }> = [
    { label: 'Status', value: STATUS_LABEL[payload.status] ?? payload.status },
    { label: 'Time', value: windowLine },
  ]
  if (payload.assigneeName) metaRows.push({ label: 'Assignee', value: payload.assigneeName })
  if (payload.serviceAddress)
    metaRows.push({ label: 'Service address', value: payload.serviceAddress })

  return (
    <Document
      title={`Visit report${payload.workOrderNumber ? ` — ${payload.workOrderNumber}` : ''}`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Visit report'
          number={payload.workOrderTitle || payload.workOrderNumber || ''}
          issuedAt={payload.visitDate ?? ''}
          dateFormat={dateFormat}
          logoBytes={logoBytes}
        />

        <BillingPartyBlock styles={styles} business={settings.business} contact={payload.contact} />

        {/* Visit meta — status/time/assignee/address as label→value rows. */}
        <View style={{ marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap' }}>
          {metaRows.map((row) => (
            <View key={row.label} style={{ width: '50%', marginBottom: 6 }}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        {payload.instructions ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={styles.label}>Instructions</Text>
            <Text style={styles.value}>{payload.instructions}</Text>
          </View>
        ) : null}

        <Text style={[styles.label, { marginBottom: 6 }]}>Quality checklist</Text>
        {payload.items.length === 0 ? (
          <Text style={styles.value}>No checklist items recorded for this visit.</Text>
        ) : (
          payload.items.map((item, i) => (
            <ChecklistRow
              key={i}
              styles={styles}
              item={item}
              dateFormat={dateFormat}
              photoBytes={photoBytes}
            />
          ))
        )}

        <DocumentFooter styles={styles} text={settings.quote.footerText} />
      </Page>
    </Document>
  )
}

type Styles = ReturnType<typeof createDocumentStyles>

function ChecklistRow(props: {
  styles: Styles
  item: VisitReportChecklistItem
  dateFormat: string
  photoBytes?: Map<string, Buffer>
}) {
  const { styles, item, dateFormat, photoBytes } = props
  const resolved = (item.photos ?? [])
    .map((p) => ({ ...p, bytes: photoBytes?.get(p.ref) }))
    .filter((p): p is VisitReportPhoto & { bytes: Buffer } => p.bytes !== undefined)

  const checkGlyph = item.checked ? '☑' : '☐' // ballot box with/without check
  const checkedLine = item.checked
    ? [item.checkedByName, item.checkedAt ? formatDocDate(item.checkedAt, dateFormat) : null]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <View style={{ marginBottom: 10 }} wrap={false}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Text style={[styles.value, { marginRight: 6 }]}>{checkGlyph}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.value, styles.bold]}>
            {item.title}
            {item.isRequired ? '  (required)' : ''}
          </Text>
          {checkedLine ? (
            <Text style={[styles.label, { textTransform: 'none', marginTop: 1 }]}>
              Checked · {checkedLine}
            </Text>
          ) : null}
          {item.note ? <Text style={[styles.value, { marginTop: 2 }]}>{item.note}</Text> : null}
          {resolved.length > 0 ? (
            <View style={styles.lineThumbRow}>
              {resolved.map((photo, j) => (
                <View key={j} style={styles.lineThumbWrap}>
                  <Image style={styles.lineThumb} src={photo.bytes} />
                  {photo.caption ? <Text style={styles.photoCaption}>{photo.caption}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}
