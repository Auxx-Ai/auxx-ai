// packages/lib/src/export/types.ts

import type { ExportJobEntity } from '@auxx/database'
import type { FieldReference } from '@auxx/types/field'

/** Export job lifecycle status. */
export type ExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'canceled'

/** What the export covers. */
export type ExportType = 'view' | 'all'

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
