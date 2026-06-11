// packages/lib/src/data-migrations/plan.ts

import type { DataMigrationDef, DataMigrationStatus } from './types'

/**
 * Throw if any two migrations share an id. Ids are ledger keys — they must be unique
 * and never reused. Called at registry build (module load) to fail loud on a mistake.
 */
export function assertUniqueMigrationIds(migrations: { id: string }[]): void {
  const seen = new Set<string>()
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate data migration id: ${migration.id}`)
    }
    seen.add(migration.id)
  }
}

/** Minimal shape of a ledger row needed to compute the plan/status. */
export interface LedgerRow {
  id: string
  status: string
  error?: string | null
  durationMs?: number | null
  appliedAt?: Date | null
}

/**
 * Compute what a runner pass should do, given the registry and the current ledger.
 *
 * Walks the registry in id order:
 * - `applied` row → skip.
 * - `failed` row → fail-stop. The migration blocks itself AND everything after it
 *   until a deliberate re-run deletes the row; `haltedBy` names it and the walk stops.
 * - no row → pending; attempt it.
 *
 * Because migrations run in order and stop at the first failure, the realistic ledger
 * is `[applied…, at most one failed, pending…]`, so `toAttempt` is usually either the
 * pending tail (no failures) or empty (halted).
 */
export function planDataMigrations(
  registry: DataMigrationDef[],
  ledger: LedgerRow[]
): { toAttempt: DataMigrationDef[]; skipped: string[]; haltedBy?: string } {
  const byId = new Map(ledger.map((r) => [r.id, r.status]))
  const toAttempt: DataMigrationDef[] = []
  const skipped: string[] = []

  for (const migration of registry) {
    const status = byId.get(migration.id)
    if (status === 'applied') {
      skipped.push(migration.id)
      continue
    }
    if (status === 'failed') {
      return { toAttempt, skipped, haltedBy: migration.id }
    }
    toAttempt.push(migration)
  }

  return { toAttempt, skipped }
}

/**
 * Join the registry with the ledger into the per-row status the admin panel renders.
 * The `blocked` state (pending rows after the first failure) is derived client-side;
 * here a row is simply `applied` / `failed` / `pending`.
 */
export function deriveDataMigrationStatuses(
  registry: DataMigrationDef[],
  ledger: LedgerRow[]
): DataMigrationStatus[] {
  const byId = new Map(ledger.map((r) => [r.id, r]))

  return registry.map((migration) => {
    const row = byId.get(migration.id)
    const status: DataMigrationStatus['status'] =
      row?.status === 'applied' ? 'applied' : row?.status === 'failed' ? 'failed' : 'pending'

    return {
      id: migration.id,
      description: migration.description,
      status,
      error: row?.error ?? null,
      durationMs: row?.durationMs ?? null,
      appliedAt: row?.appliedAt ?? null,
    }
  })
}
