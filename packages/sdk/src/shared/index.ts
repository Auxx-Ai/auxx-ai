// packages/sdk/src/shared/index.ts

// Export error classes
export {
  AuxxError,
  AuxxNoOrganizationConnectionError,
  AuxxNoUserConnectionError,
  AuxxUnexpectedTransportError,
  BlockRuntimeError,
  BlockValidationError,
  ExtensionInitError,
  ExtensionLoadError,
  MessageError,
  RenderError,
  ServerFunctionError,
  SurfaceError,
} from './errors.js'
// Export fetchable state utilities
export {
  type CompleteFetchable,
  type ErrorFetchable,
  type Fetchable,
  FetchableState,
  getFetchableData,
  isCompleteFetchable,
  isErrorFetchable,
  isPendingFetchable,
  makeCompleteFetchable,
  makeErrorFetchable,
  makePendingFetchable,
  mapFetchable,
  type PendingFetchable,
} from './fetchable.js'
// Export validation utilities
export {
  assertNever,
  assetSchema,
  environmentSchema,
  renderInstanceSchema,
  renderTreeSchema,
  safeValidate,
  surfaceMapSchema,
  surfaceSchema,
  type ValidatedAsset,
  type ValidatedEnvironment,
  type ValidatedRenderTree,
  type ValidatedSurface,
  type ValidatedSurfaceMap,
  validateAndParse,
} from './validation.js'
