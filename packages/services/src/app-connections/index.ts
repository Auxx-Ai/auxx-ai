// packages/services/src/app-connections/index.ts
//
// CRUD/admin surface for app connections. The runtime-execution functions
// (resolve/save/delete/mark) moved to `@auxx/lib/apps` — see
// plans/apps/oauth/app-connection-lazy-refresh-plan.md §2.

// Export types
export type { DecryptedConnectionData } from '@auxx/credentials/connections'
// Re-exported for compatibility — `getAppConnection` and the interpolation helpers now live in
// `@auxx/credentials/connections`, alongside the store/crypto primitives they are built from.
// Prefer importing them from there directly.
export {
  extractPlaceholders,
  getAppConnection,
  interpolateConnectionFields,
  mergeConnectionVariables,
} from '@auxx/credentials/connections'
// Export service functions
export { getAppConnectionDefinition } from './get-app-connection-definition'
export {
  type ConnectionMethod,
  getConnectionDefinitionById,
  listAppConnectionDefinitions,
} from './list-app-connection-definitions'
export { listAppConnections, parseGrantedScopes } from './list-app-connections'
export { renameAppConnection } from './rename-app-connection'
export type { AppConnection, ConnectionDefinitionSummary } from './types'
// Export utility functions
export { logger, safeSerializeMetadata } from './utils'
