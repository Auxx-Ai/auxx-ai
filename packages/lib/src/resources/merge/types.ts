// packages/lib/src/resources/merge/types.ts

import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'

/** Input for merging a single field's values */
export interface MergeFieldInput {
  targetValue: unknown
  sourceValues: unknown[]
  fieldType: FieldType
  fieldOptions?: Record<string, unknown>
}

/** Result of merging a single field */
export interface MergeFieldResult {
  value: unknown
  wasModified: boolean
}

/** Input for backend merge operation */
export interface MergeEntitiesInput {
  targetRecordId: RecordId
  sourceRecordIds: RecordId[]
}

/** Result of backend merge operation */
export interface MergeEntitiesResult {
  mergedRecordId: RecordId
  mergedCount: number
  fieldsMerged: number
  taskReferencesTransferred: number
  relationshipsRedirected: number
}
