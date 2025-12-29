// packages/database/src/index.ts
// Public exports for the database package: schema and (future) client

export * as schema from './db/schema'
// Also export tables directly for named imports (preferable to schema namespace)
export * from './db/schema'
export { database } from './db/client'
export type { Database, Transaction } from './db/client'
// Re-export select models used by apps (keep minimal, add as needed)
export { SubscriptionModel, type SubscriptionListItem } from './db/models/subscription'
export { SyncJobModel, type SyncJobListItem } from './db/models/sync-job'
export { type UserEntity } from './db/models/user'
// Export database error utilities
export { getDbErrorMessage, PostgresErrorCodes, type DbErrorMessage } from './db/utils/errors'

// Export unified model types (single source of truth)
export { ModelTypeValues, ModelTypes, ModelTypeMeta, type ModelType } from './enums'
