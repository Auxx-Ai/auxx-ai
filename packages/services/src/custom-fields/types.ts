// packages/services/src/custom-fields/types.ts

import type {
  ActorOptions,
  AiOptions,
  CalcOptions,
  DisplayOptions,
  FileOptions,
  SelectOption,
} from '@auxx/types/custom-field'

/**
 * The `options` payload a create/update accepts, in one place.
 *
 * Create and update each used to spell this union out, and they had drifted:
 * update omitted `{ actor }` even though `updateCustomField` merges actor options,
 * so the tRPC router's `fieldOptionsUnionSchema` input did not typecheck against it.
 */
export type CustomFieldOptionsInput =
  | SelectOption[]
  | { file: FileOptions }
  | { actor: ActorOptions }
  | { calc: CalcOptions }
  | { options: SelectOption[]; ai?: AiOptions }
  | (DisplayOptions & { ai?: AiOptions })

// Re-export all types from @auxx/types/custom-field (single source of truth)
export {
  type ActorOptions,
  // Actor options
  actorOptionsSchema,
  canFieldBeUnique,
  DEFAULT_SELECT_OPTION_COLOR,
  type DisplayOptions,
  // Display options (flat structure for NUMBER, CURRENCY, DATE, CHECKBOX, etc.)
  displayOptionsSchema,
  FIELD_TYPE_DISPLAY_OPTIONS,
  type FileOptions,
  // Field options union
  fieldOptionsUnionSchema,
  // File options
  fileOptionsSchema,
  getDisplayOptionKeys,
  getInverseFieldId,
  getRelatedEntityDefinitionId,
  isDisplayOptions,
  type ModelType,
  ModelTypeMeta,
  // Model types
  ModelTypes,
  ModelTypeValues,
  mergeDisplayOptions,
  type RelationshipConfig,
  type RelationshipOptions,
  // Relationship types
  type RelationshipType,
  // Select option colors
  SELECT_OPTION_COLORS,
  type SelectOption,
  type SelectOptionColor,
  // Select option
  selectOptionSchema,
  supportsDisplayOptions,
  type TargetTimeInStatus,
  // Target time in status
  targetTimeInStatusSchema,
  // Uniqueness
  UNIQUEABLE_FIELD_TYPES,
} from '@auxx/types/custom-field'
