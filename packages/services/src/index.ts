// packages/services/src/index.ts

// Field Values
export {
  getFieldWithDefinition,
  getExistingFieldValue,
  insertFieldValue,
  batchInsertFieldValues,
  updateFieldValue,
  deleteFieldValues,
  deleteFieldValueById,
  updateEntityDisplayName,
} from './field-values'

export type {
  FieldNotFoundError,
  FieldValueNotFoundError,
  EntityNotFoundError as FieldValueEntityNotFoundError,
  FieldValueError,
  GetFieldWithDefinitionInput,
  FieldWithDefinition,
  GetExistingValueInput,
  ExistingFieldValueRow,
  InsertFieldValueInput,
  UpdateFieldValueInput,
  DeleteFieldValuesInput,
  UpdateDisplayNameInput,
  FieldValueRow,
} from './field-values'

// Table View
export {
  listViews,
  getView,
  createView,
  updateView,
  duplicateView,
  deleteView,
  setDefaultView,
} from './table-view'

export type {
  ListViewsInput,
  GetViewInput,
  GetViewOptions,
  CreateViewInput,
  UpdateViewInput,
  DuplicateViewInput,
  DeleteViewInput,
  SetDefaultViewInput,
  TableViewError,
  ViewNotFoundError,
  ViewAlreadyExistsError,
  CannotDeleteDefaultViewError,
} from './table-view'

// Field View
export { getOrgFieldView } from './field-view'
export type { GetOrgFieldViewInput } from './field-view'

// Shared
export { fromDatabase, fromS3, formatVersion } from './shared'
export type { ServiceError, DatabaseError, S3Error } from './shared'
