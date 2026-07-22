// packages/lib/src/export/types.ts

import type { ExportJobEntity, PrintHeaderFooter } from '@auxx/database'
import type { FieldReference } from '@auxx/types/field'

// PrintConfig family lives in `@auxx/database` (export-job.ts) — the schema owns it because
// `@auxx/database` can never import from `@auxx/lib`. Re-exported here so server code reads
// it from the export module like everything else in this file.
export type {
  ExportJobFormat,
  PrintConfig,
  PrintHeaderFooter,
  PrintStyle,
} from '@auxx/database'

/**
 * Default header/footer slots applied whenever a `PrintConfig.header`/`.footer` slot is
 * absent (plans/printing/01-unified-print.md §B "Header/footer tokens"). Shared by the
 * render side (`export/pdf/page-frame.tsx` merges these in at render time) and the wizard
 * (imported via `export/client.ts` to seed/hydrate the header/footer step) so both sides
 * agree on what "no config" looks like without duplicating the literal strings.
 */
export const DEFAULT_PRINT_HEADER: PrintHeaderFooter & { showLogo: boolean } = {
  center: '{viewName}',
  showLogo: true,
}

/** @see {@link DEFAULT_PRINT_HEADER} */
export const DEFAULT_PRINT_FOOTER: PrintHeaderFooter = {
  left: '{date}',
  right: 'Page {page} of {pages}',
}

/** Export job lifecycle status. */
export type ExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'canceled'

/** What the export covers. */
export type ExportType = 'view' | 'all' | 'selection'

/**
 * One column in the export snapshot. `fieldRef` is a `FieldReference` —
 * a `ResourceFieldId` string for direct fields, or a `FieldPath` string array
 * for relationship traversal. Passed verbatim into `batchGetValues`.
 */
export interface ExportColumn {
  label: string
  fieldRef: FieldReference
}

/** Selected ExportJob row, narrowed to the typed snapshot shapes. */
export type ExportJob = ExportJobEntity
