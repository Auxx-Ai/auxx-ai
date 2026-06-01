// packages/database/src/index.ts
// Public exports for the database package: schema and (future) client

// Audit-log row builder + types (shared across all write paths)
export {
  type AuditContext,
  type AuditRow,
  type AuditRowInput,
  toAuditRow,
} from './db/audit/to-audit-row'
export type { Database, Transaction } from './db/client'
export { closePools, database } from './db/client'
export * as schema from './db/schema'
// Also export tables directly for named imports (preferable to schema namespace)
export * from './db/schema'
// Export database error utilities
export { type DbErrorMessage, getDbErrorMessage, PostgresErrorCodes } from './db/utils/errors'

// Export unified model types (single source of truth)
export { type ModelType, ModelTypeMeta, ModelTypes, ModelTypeValues } from './enums'
