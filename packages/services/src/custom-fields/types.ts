// packages/services/src/custom-fields/types.ts

// Re-export all types from @auxx/types/custom-field (single source of truth)
export {
  type ActorOptions,
  // Actor options
  actorOptionsSchema,
  type CurrencyDisplayType,
  type CurrencyGroups,
  type CurrencyOptions,
  canFieldBeUnique,
  currencyDisplayTypeValues,
  currencyGroupsValues,
  // Currency options
  currencyOptionsSchema,
  DEFAULT_SELECT_OPTION_COLOR,
  type DecimalPlaces,
  type DisplayOptions,
  decimalPlacesValues,
  // Display options (flat structure for NUMBER, DATE, CHECKBOX, etc.)
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
