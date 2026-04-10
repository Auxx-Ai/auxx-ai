// packages/lib/src/seed/entity-migrations/types.ts

import type { Database } from '@auxx/database'

/**
 * An entity migration adds new EntityDefinitions, CustomFields, relationships,
 * and display fields to existing organizations.
 *
 * Migrations MUST be idempotent — they check what exists before creating anything.
 * This allows re-running all migrations safely on any org regardless of when it was created.
 */
export interface EntityMigration {
  /** Unique migration ID (e.g., '001-vendor-part-subpart'). Never change after shipping. */
  id: string
  /** Human-readable description */
  description: string
  /** Run the migration for a single organization */
  up: (db: Database, organizationId: string) => Promise<EntityMigrationResult>
}

export interface EntityMigrationResult {
  /** Number of EntityDefinitions created */
  entityDefsCreated: number
  /** Number of CustomFields created */
  fieldsCreated: number
  /** Number of relationships linked */
  relationshipsLinked: number
  /** Whether everything was already up to date (nothing created) */
  alreadyUpToDate: boolean
}

export interface MigrationRunResult {
  organizationId: string
  migrations: { id: string; result: EntityMigrationResult }[]
  error?: string
}
