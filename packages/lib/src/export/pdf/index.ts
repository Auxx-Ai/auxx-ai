// packages/lib/src/export/pdf/index.ts
//
// Generic PDF (print) renderers (plans/printing/01-unified-print.md §C) — server-only
// (`@react-pdf/renderer`). Sibling of `export/csv/`; NOT re-exported via `export/client.ts`.

export {
  type DetailSheetField,
  DetailSheetPdf,
  type DetailSheetRecord,
} from './detail-sheet-pdf'
export { PrintFooter, type PrintFrameTokens, PrintHeader } from './page-frame'
export { type RecordsTableColumn, RecordsTablePdf } from './records-table-pdf'
export {
  createDocumentStyles,
  pageSizeFor,
  resolveDetailOrientation,
  resolveOrientation,
} from './theme'
