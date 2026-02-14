// packages/database/src/index.ts
// Public exports for the database package: schema and (future) client

export type { Database, Transaction } from './db/client'
export { database } from './db/client'
// Re-export select models used by apps (keep minimal, add as needed)
export { type SubscriptionListItem, SubscriptionModel } from './db/models/subscription'
export { type SyncJobListItem, SyncJobModel } from './db/models/sync-job'
export type { UserEntity } from './db/models/user'
export * as schema from './db/schema'
// Also export tables directly for named imports (preferable to schema namespace)
export * from './db/schema'
// Export database error utilities
export { type DbErrorMessage, getDbErrorMessage, PostgresErrorCodes } from './db/utils/errors'

// Export unified model types (single source of truth)
export { type ModelType, ModelTypeMeta, ModelTypes, ModelTypeValues } from './enums'
