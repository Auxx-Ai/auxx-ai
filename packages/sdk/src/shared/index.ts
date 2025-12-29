// packages/sdk/src/shared/index.ts

// Export fetchable state utilities
export {
  FetchableState,
  makePendingFetchable,
  makeCompleteFetchable,
  makeErrorFetchable,
  isPendingFetchable,
  isCompleteFetchable,
  isErrorFetchable,
  mapFetchable,
  getFetchableData,
  type Fetchable,
  type PendingFetchable,
  type CompleteFetchable,
  type ErrorFetchable,
} from './fetchable.js'

// Export validation utilities
export {
  surfaceSchema,
  surfaceMapSchema,
  assetSchema,
  renderInstanceSchema,
  renderTreeSchema,
  environmentSchema,
  validateAndParse,
  safeValidate,
  assertNever,
  type ValidatedSurface,
  type ValidatedSurfaceMap,
  type ValidatedAsset,
  type ValidatedRenderTree,
  type ValidatedEnvironment,
} from './validation.js'

// Export error classes
export {
  AuxxError,
  ExtensionLoadError,
  ExtensionInitError,
  RenderError,
  MessageError,
  SurfaceError,
  ServerFunctionError,
  AuxxNoUserConnectionError,
  AuxxNoOrganizationConnectionError,
  AuxxUnexpectedTransportError,
} from './errors.js'
