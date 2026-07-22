// packages/lib/src/export/pdf/theme.ts

import type { PrintConfig } from '../types'

// Re-exported as-is (plans/printing/01-unified-print.md §C) — generic prints share the exact
// same font registration, accent-color styling and paper-size mapping as quote/invoice PDFs;
// no forked theme.
export { createDocumentStyles, pageSizeFor } from '../../documents/pdf/theme'

/**
 * Column count above which `orientation: 'auto'` resolves to landscape (§C). A4/Letter
 * portrait comfortably fits ~6 proportionally-shared columns at the list renderer's base
 * 9pt before cells get too narrow to read; beyond that landscape's extra ~2.5in of width
 * earns its keep. Tune here if real-world print runs disagree — this is the ONE place the
 * threshold lives.
 */
const AUTO_LANDSCAPE_COLUMN_THRESHOLD = 6

/**
 * Resolve a `PrintConfig.orientation` to a concrete react-pdf `<Page orientation>` value.
 * `'portrait'`/`'landscape'` pass through unchanged; `'auto'` picks landscape once the
 * column count passes {@link AUTO_LANDSCAPE_COLUMN_THRESHOLD}. The stored config itself
 * always stays `'auto'` — this resolves fresh at render time so it keeps tracking whatever
 * columns the run actually has.
 */
export function resolveOrientation(
  orientation: PrintConfig['orientation'],
  columnCount: number
): 'portrait' | 'landscape' {
  if (orientation === 'portrait' || orientation === 'landscape') return orientation
  return columnCount > AUTO_LANDSCAPE_COLUMN_THRESHOLD ? 'landscape' : 'portrait'
}

/**
 * Resolve a `PrintConfig.orientation` for the `detail` print style. Unlike the list style,
 * `'auto'` always resolves to portrait here: a detail sheet is a label/value grid (one narrow
 * column of labels, one of values) that grows *taller* as more fields are chosen, never wider
 * — there's no column-count signal analogous to {@link resolveOrientation}'s threshold to
 * react to. `'portrait'`/`'landscape'` still pass through as explicit user choices.
 */
export function resolveDetailOrientation(
  orientation: PrintConfig['orientation']
): 'portrait' | 'landscape' {
  return orientation === 'landscape' ? 'landscape' : 'portrait'
}
