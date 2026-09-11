// packages/lib/src/data-migrations/index.ts

export { DATA_MIGRATION_LOCK_KEY, withAdvisoryLock } from './advisory-lock'
export {
  describeMigrationError,
  type MigrationErrorDetails,
  type PgErrorFields,
} from './describe-migration-error'
export { listDataMigrationStatuses } from './list-data-migrations'
export {
  type PerOrgMigration,
  type PerOrgMigrationResult,
  perOrgMigration,
} from './per-org'
export {
  assertUniqueMigrationIds,
  deriveDataMigrationStatuses,
  type LedgerRow,
  planDataMigrations,
} from './plan'
export { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from './registry'
export { rerunDataMigration } from './rerun-data-migration'
export { runPendingDataMigrations } from './run-pending-data-migrations'
export type { DataMigrationDef, DataMigrationStatus, RunSummary } from './types'
