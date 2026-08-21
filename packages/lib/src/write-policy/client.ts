// packages/lib/src/write-policy/client.ts
// Client-safe exports, the policy vocabulary is types + one const, no server deps.

export {
  type FieldMergeStrategy,
  type IdentityNormalize,
  type IdentityRole,
  IMPORT_MERGE_STRATEGIES,
  type ImportMergeStrategy,
  isImportMergeStrategy,
  type OnAmbiguous,
} from './types'
