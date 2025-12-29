// apps/web/src/components/data-import/index.ts

// Main components
export { ImportPage } from './import-page'
export { ImportStepCards } from './import-step-cards'
export { ImportActions } from './import-actions'

// Types
export type {
  ImportStep,
  StepStatus,
  ImportStepCardData,
  ParsedCSVData,
  ColumnHeader,
  ColumnMappingUI,
  UniqueValueSummary,
  ImportableField,
  UploadProgress as UploadProgressState,
  ResolutionProgress as ResolutionProgressState,
  ExecutionProgress as ExecutionProgressState,
  PlanEstimates,
  ImportPlan,
  StepData,
  MappedColumn,
} from './types'

// Constants
export {
  MAX_FILE_SIZE_BYTES,
  UPLOAD_CHUNK_SIZE,
  IMPORT_STEP_CONFIG,
  IMPORT_STEPS,
} from './constants'

// Hooks
export { useImportWizard } from './hooks/use-import-wizard'
export { useChunkedUpload } from './hooks/use-chunked-upload'
export { useImportSSE } from './hooks/use-import-sse'
export { useUniqueValues } from './hooks/use-unique-values'

// Utils
export { parseCSV, type ParseCSVError } from './utils/parse-csv'
export { chunkRows, type RowChunk } from './utils/chunk-rows'

// Steps
export { StepUpload } from './steps/step-upload'
export { StepMapColumns } from './steps/step-map-columns'
export { StepReviewValues } from './steps/step-review-values'
export { StepConfirmImport } from './steps/step-confirm-import'

// Column mapping
export { ColumnMappingTable } from './column-mapping/column-mapping-table'
export { ColumnMappingRow } from './column-mapping/column-mapping-row'
export { SampleValuesPanel } from './column-mapping/sample-values-panel'
export { FieldSelector } from './column-mapping/field-selector'

// Value review
export { ValueStatusGroup } from './value-review/value-status-group'
export { ValueRow } from './value-review/value-row'

// Plan preview
export { ImportPlanSummary } from './plan-preview/import-plan-summary'
export { ErrorSummary } from './plan-preview/error-summary'

// Progress
export { UploadProgress } from './progress/upload-progress'
export { ResolutionProgress } from './progress/resolution-progress'
export { ExecutionProgress } from './progress/execution-progress'
