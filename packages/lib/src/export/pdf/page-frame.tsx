// packages/lib/src/export/pdf/page-frame.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import { DEFAULT_PRINT_FOOTER, DEFAULT_PRINT_HEADER, type PrintConfig } from '../types'

/**
 * Values a header/footer template's `{token}` slots resolve to (plans/printing/
 * 01-unified-print.md §B "Header/footer tokens"). `{page}`/`{pages}` are NOT here — they
 * only exist inside react-pdf's per-page `render` callback (`pageNumber`/`totalPages`),
 * substituted alongside these at render time in {@link fillTemplate}.
 */
export interface PrintFrameTokens {
  /** Run date, already formatted with the org's `documents.dateFormat`. */
  date: string
  orgName: string
  /** Saved-view name, or the entity's display label when no view name resolves. */
  viewName: string
  /** Total record count for the run. */
  count: number
}

const frameStyles = StyleSheet.create({
  headerBand: { marginBottom: 16 },
  logoRow: { alignItems: 'center', marginBottom: 6 },
  logo: { width: 100, maxHeight: 40, objectFit: 'contain' },
  headerSlotRow: { flexDirection: 'row', alignItems: 'center' },
  headerSlot: { flex: 1, fontSize: 8, color: '#6b7280' },
  headerSlotCenter: {
    flex: 1,
    fontSize: 10,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  footerBand: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    borderTop: '1 solid #e5e7eb',
    paddingTop: 6,
  },
  footerSlotRow: { flexDirection: 'row', alignItems: 'center' },
  footerSlot: { flex: 1, fontSize: 8, color: '#9ca3af' },
})

/**
 * Fill a header/footer slot template's tokens. `{page}`/`{pages}` come from react-pdf's
 * `fixed` + `render={({ pageNumber, totalPages }) => ...}` callback (called once per printed
 * page), the rest are resolved once up front and passed in via {@link PrintFrameTokens}.
 */
function fillTemplate(
  template: string | undefined,
  tokens: PrintFrameTokens,
  pageNumber: number,
  totalPages: number
): string {
  if (!template) return ''
  return template
    .replaceAll('{page}', String(pageNumber))
    .replaceAll('{pages}', String(totalPages))
    .replaceAll('{date}', tokens.date)
    .replaceAll('{orgName}', tokens.orgName)
    .replaceAll('{viewName}', tokens.viewName)
    .replaceAll('{count}', String(tokens.count))
}

/**
 * Print-run header band: an optional logo row, then a left/center/right token-substituted
 * text row. `header` slots absent on the stored `PrintConfig` fall back to
 * {@link DEFAULT_PRINT_HEADER} (center = `{viewName}`, `showLogo: true`) — the wizard seeds
 * the same defaults, but the renderer re-applies them so older/partial configs still render
 * sensibly. Rendered `fixed` — repeats on every page.
 */
export function PrintHeader(props: {
  header: PrintConfig['header']
  tokens: PrintFrameTokens
  logoBytes?: Buffer | null
}) {
  const header = { ...DEFAULT_PRINT_HEADER, ...props.header }
  const { tokens, logoBytes } = props
  const hasText = Boolean(header.left || header.center || header.right)

  return (
    <View style={frameStyles.headerBand} fixed>
      {header.showLogo && logoBytes ? (
        <View style={frameStyles.logoRow}>
          <Image style={frameStyles.logo} src={logoBytes} />
        </View>
      ) : null}
      {hasText ? (
        <View style={frameStyles.headerSlotRow}>
          <Text
            style={frameStyles.headerSlot}
            render={({ pageNumber, totalPages }) =>
              fillTemplate(header.left, tokens, pageNumber, totalPages)
            }
          />
          <Text
            style={frameStyles.headerSlotCenter}
            render={({ pageNumber, totalPages }) =>
              fillTemplate(header.center, tokens, pageNumber, totalPages)
            }
          />
          <Text
            style={[frameStyles.headerSlot, { textAlign: 'right' }]}
            render={({ pageNumber, totalPages }) =>
              fillTemplate(header.right, tokens, pageNumber, totalPages)
            }
          />
        </View>
      ) : null}
    </View>
  )
}

/**
 * Print-run footer band — same left/center/right token substitution as {@link PrintHeader},
 * defaulting to {@link DEFAULT_PRINT_FOOTER} (left = `{date}`, right = `Page {page} of
 * {pages}`). Renders nothing when every slot ends up blank. `fixed` + absolutely
 * positioned — pinned to the bottom of every page, matching `documents/pdf/parts.tsx`'s
 * `DocumentFooter`.
 */
export function PrintFooter(props: { footer: PrintConfig['footer']; tokens: PrintFrameTokens }) {
  const footer = { ...DEFAULT_PRINT_FOOTER, ...props.footer }
  const { tokens } = props
  if (!(footer.left || footer.center || footer.right)) return null

  return (
    <View style={frameStyles.footerBand} fixed>
      <View style={frameStyles.footerSlotRow}>
        <Text
          style={frameStyles.footerSlot}
          render={({ pageNumber, totalPages }) =>
            fillTemplate(footer.left, tokens, pageNumber, totalPages)
          }
        />
        <Text
          style={[frameStyles.footerSlot, { textAlign: 'center' }]}
          render={({ pageNumber, totalPages }) =>
            fillTemplate(footer.center, tokens, pageNumber, totalPages)
          }
        />
        <Text
          style={[frameStyles.footerSlot, { textAlign: 'right' }]}
          render={({ pageNumber, totalPages }) =>
            fillTemplate(footer.right, tokens, pageNumber, totalPages)
          }
        />
      </View>
    </View>
  )
}
