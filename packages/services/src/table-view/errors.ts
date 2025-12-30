// packages/services/src/table-view/errors.ts

/**
 * View not found error
 */
export type ViewNotFoundError = {
  code: 'VIEW_NOT_FOUND'
  message: string
  viewId?: string
}

/**
 * View already exists error (duplicate name)
 */
export type ViewAlreadyExistsError = {
  code: 'VIEW_ALREADY_EXISTS'
  message: string
  name: string
}

/**
 * Cannot delete default view error
 */
export type CannotDeleteDefaultViewError = {
  code: 'CANNOT_DELETE_DEFAULT_VIEW'
  message: string
  viewId: string
}

/**
 * All table-view-specific errors
 */
export type TableViewError =
  | ViewNotFoundError
  | ViewAlreadyExistsError
  | CannotDeleteDefaultViewError
