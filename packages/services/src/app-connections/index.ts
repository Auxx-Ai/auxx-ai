// packages/services/src/app-connections/index.ts
//
// CRUD/admin surface for app connections. The runtime-execution functions
// (resolve/save/delete/mark) moved to `@auxx/lib/apps` — see
// plans/apps/oauth/app-connection-lazy-refresh-plan.md §2.

export { getAppConnection } from './get-app-connection'

// Export service functions
export { getAppConnectionDefinition } from './get-app-connection-definition'
// Export interpolation utilities
export { extractPlaceholders, interpolateConnectionFields } from './interpolate-connection'
export { listAppConnections } from './list-app-connections'
export { renameAppConnection } from './rename-app-connection'
// Export types
export type {
  AppConnection,
  ConnectionDefinitionSummary,
  DecryptedConnectionData,
} from './types'
// Export utility functions
export { logger, safeSerializeMetadata } from './utils'
