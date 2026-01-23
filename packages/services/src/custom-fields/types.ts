// packages/services/src/custom-fields/types.ts

// Re-export all types from @auxx/types/custom-field (single source of truth)
export {
  // Model types
  ModelTypes,
  ModelTypeMeta,
  ModelTypeValues,
  type ModelType,
  // Select option colors
  SELECT_OPTION_COLORS,
  DEFAULT_SELECT_OPTION_COLOR,
  type SelectOptionColor,
  // Target time in status
  targetTimeInStatusSchema,
  type TargetTimeInStatus,
  // Select option
  selectOptionSchema,
  type SelectOption,
  // Currency options
  currencyOptionsSchema,
  decimalPlacesValues,
  currencyDisplayTypeValues,
  currencyGroupsValues,
  type CurrencyOptions,
  type DecimalPlaces,
  type CurrencyDisplayType,
  type CurrencyGroups,
  // File options
  fileOptionsSchema,
  type FileOptions,
  // Actor options
  actorOptionsSchema,
  type ActorOptions,
  // Display options (flat structure for NUMBER, DATE, CHECKBOX, etc.)
  displayOptionsSchema,
  type DisplayOptions,
  FIELD_TYPE_DISPLAY_OPTIONS,
  supportsDisplayOptions,
  getDisplayOptionKeys,
  isDisplayOptions,
  mergeDisplayOptions,
  // Field options union
  fieldOptionsUnionSchema,
  // Relationship types
  type RelationshipType,
  type RelationshipConfig,
  type RelationshipOptions,
  getRelatedEntityDefinitionId,
  getInverseFieldId,
  // Uniqueness
  UNIQUEABLE_FIELD_TYPES,
  canFieldBeUnique,
} from '@auxx/types/custom-field'
