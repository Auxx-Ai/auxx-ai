// packages/lib/src/documents/pdf/theme.ts

import { Font, StyleSheet } from '@react-pdf/renderer'
import { INTER_BOLD_BASE64, INTER_REGULAR_BASE64 } from '../fonts/inter'
import type { ResolvedDocumentSettings } from '../resolve-settings'

/**
 * Registered once at module load — every `<QuotePdf>`/future invoice-pdf render shares it.
 * `@react-pdf/font`'s `FontSource` only accepts a standard-font name, a URL, a local path,
 * or a data URL string for `src` (raw `Buffer` is NOT one of the supported shapes, despite
 * `Font.register`'s docs suggesting otherwise) — a `data:font/ttf;base64,...` string is the
 * base64-embedded, no-external-reference equivalent.
 */
Font.register({
  family: 'Inter',
  fonts: [
    { src: `data:font/ttf;base64,${INTER_REGULAR_BASE64}`, fontWeight: 'normal' },
    { src: `data:font/ttf;base64,${INTER_BOLD_BASE64}`, fontWeight: 'bold' },
  ],
})

/** Fallback accent color when `documents.accentColor` is unset. */
const DEFAULT_ACCENT_COLOR = '#111827'

/** react-pdf `<Page size>` for the two supported paper sizes (money MQ2 build spec §A.2). */
export function pageSizeFor(paperSize: ResolvedDocumentSettings['branding']['paperSize']) {
  return paperSize === 'letter' ? 'LETTER' : 'A4'
}

/** Shared style sheet, parameterized by the resolved branding's accent color. */
export function createDocumentStyles(settings: ResolvedDocumentSettings) {
  const accent = settings.branding.accentColor || DEFAULT_ACCENT_COLOR

  return StyleSheet.create({
    page: {
      fontFamily: 'Inter',
      fontSize: 9,
      color: '#111827',
      padding: 36,
    },
    accentText: { color: accent },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 24,
    },
    logo: { width: 120, maxHeight: 60, objectFit: 'contain' },
    h1: { fontSize: 18, fontWeight: 'bold', color: accent, marginBottom: 2 },
    label: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
    value: { fontSize: 9, color: '#111827' },
    bold: { fontWeight: 'bold' },
    sectionSpacer: { marginTop: 16 },
    partiesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
    partyBlock: { maxWidth: '48%' },
    table: { marginTop: 8, borderTop: '1 solid #e5e7eb' },
    tableHeaderRow: {
      flexDirection: 'row',
      borderBottom: '1 solid #e5e7eb',
      paddingVertical: 6,
      backgroundColor: '#f9fafb',
    },
    tableRow: {
      flexDirection: 'row',
      borderBottom: '1 solid #f3f4f6',
      paddingVertical: 6,
    },
    colDescription: { flex: 3, paddingHorizontal: 4 },
    colQty: { flex: 1, paddingHorizontal: 4, textAlign: 'right' },
    colUnitPrice: { flex: 1, paddingHorizontal: 4, textAlign: 'right' },
    colAmount: { flex: 1, paddingHorizontal: 4, textAlign: 'right' },
    lineName: { fontSize: 9 },
    lineDescription: { fontSize: 8, color: '#6b7280', marginTop: 2 },
    totalsBlock: { marginTop: 16, alignSelf: 'flex-end', width: 220 },
    totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    totalsRowFinal: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
      marginTop: 4,
      borderTop: `1 solid ${accent}`,
    },
    footer: {
      position: 'absolute',
      bottom: 24,
      left: 36,
      right: 36,
      fontSize: 8,
      color: '#9ca3af',
      textAlign: 'center',
      borderTop: '1 solid #e5e7eb',
      paddingTop: 8,
    },
    terms: { marginTop: 20, fontSize: 8, color: '#6b7280' },
  })
}
