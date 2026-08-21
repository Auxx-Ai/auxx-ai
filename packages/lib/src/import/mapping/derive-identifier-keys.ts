// packages/lib/src/import/mapping/derive-identifier-keys.ts

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { asc, eq } from 'drizzle-orm'
import type { ImportStrategyMode } from '../types/mapping'
import { isMatchRole, parseResolutionConfig } from './resolution-config'
import { toImportStrategyMode } from './strategy-mode'

/**
 * Either handle. Both functions here are called from inside a caller's
 * transaction (every mapping write wraps them), and a handle that fell back to
 * the pooled `Database` would run this read-modify-write on its own connection,
 * outside the caller's lock. Widening the parameter is what keeps that
 * unrepresentable rather than merely discouraged.
 */
type DbOrTx = Database | Transaction

/**
 * **The ONE derivation of the match key.** Nothing else computes this set.
 *
 * The source of truth is per-COLUMN: `ImportMappingProperty.resolutionConfig`
 * carries `identityRole: { kind: 'match' }` on each column the user flagged as an identifier.
 * `ImportMapping.identifierFieldKeys` is the per-JOB read shape the planner
 * consumes. Nothing keeps the two levels in sync on its own, which is why every
 * mapping write path calls this, see {@link syncMappingIdentity}.
 *
 * A column contributes only when it is flagged `match` AND actually mapped
 * (`targetFieldKey` set, `targetType !== 'skip'`). A flagged-but-unmapped column
 * contributing a key is the original defect with extra steps: `analyzeRow` finds
 * no identifier value for it and the import silently reverts to create-only
 * behind a wizard that says update is on.
 *
 * More than one key is a COMPOSITE key, ANDed, ordered by source column index,
 * `assertNoDuplicateTargetMapping` already guarantees one column per field, so
 * two `match` columns are always two different fields.
 *
 * @param db - Database or transaction handle
 * @param importMappingId - Mapping whose columns to read
 * @returns Ordered match-key field keys; empty when no column is flagged
 */
export async function deriveIdentifierFieldKeys(
  db: DbOrTx,
  importMappingId: string
): Promise<string[]> {
  const columns = await db
    .select({
      sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
      targetType: schema.ImportMappingProperty.targetType,
      targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
      resolutionConfig: schema.ImportMappingProperty.resolutionConfig,
    })
    .from(schema.ImportMappingProperty)
    .where(eq(schema.ImportMappingProperty.importMappingId, importMappingId))
    .orderBy(asc(schema.ImportMappingProperty.sourceColumnIndex))

  const keys: string[] = []
  const seen = new Set<string>()

  for (const column of columns) {
    if (!column.targetFieldKey) continue
    if (column.targetType === 'skip') continue
    if (!isMatchRole(parseResolutionConfig(column.resolutionConfig).identityRole)) continue
    if (seen.has(column.targetFieldKey)) continue
    seen.add(column.targetFieldKey)
    keys.push(column.targetFieldKey)
  }

  return keys
}

/** What {@link syncMappingIdentity} wrote. */
export interface MappingIdentityState {
  identifierFieldKeys: string[]
  defaultStrategy: ImportStrategyMode
}

/**
 * Recompute `ImportMapping.identifierFieldKeys` from the columns and, when the
 * identifier set CROSSES between empty and non-empty, move the job's mode with
 * it. Called by every mapping write so the two levels can never drift.
 *
 * **The auto-flip is keyed on the TRANSITION, not on the state.** That is what
 * keeps it from stomping an explicit user choice, with no extra column to store
 * "the user touched this":
 *
 * - `[] → [something]` while the mode is still the untouched default `'create'`
 *   ⇒ flip to `'create-or-update'`. Any other stored mode is a deliberate
 *   choice and is left alone.
 * - `[something] → []` ⇒ back to `'create'`, whatever the mode was. `update` or
 *   `create-or-update` without a match key cannot match anything; leaving it
 *   would show a wizard promising updates that can never happen.
 * - identifier set non-empty **before and after** ⇒ never touched. This is the
 *   case that would otherwise re-flip a mode the user deliberately set back to
 *   `'create'` the next time they edited any unrelated column.
 *
 * @param db - Database or transaction handle
 * @param importMappingId - Mapping to sync
 * @returns The state now stored on the mapping row
 */
export async function syncMappingIdentity(
  db: DbOrTx,
  importMappingId: string
): Promise<MappingIdentityState> {
  const [mapping] = await db
    .select({
      identifierFieldKeys: schema.ImportMapping.identifierFieldKeys,
      defaultStrategy: schema.ImportMapping.defaultStrategy,
    })
    .from(schema.ImportMapping)
    .where(eq(schema.ImportMapping.id, importMappingId))
    .limit(1)

  const identifierFieldKeys = await deriveIdentifierFieldKeys(db, importMappingId)

  const previousKeys = mapping?.identifierFieldKeys ?? []
  const storedMode = toImportStrategyMode(mapping?.defaultStrategy)

  let defaultStrategy = storedMode
  if (previousKeys.length === 0 && identifierFieldKeys.length > 0 && storedMode === 'create') {
    defaultStrategy = 'create-or-update'
  } else if (previousKeys.length > 0 && identifierFieldKeys.length === 0) {
    defaultStrategy = 'create'
  }

  await db
    .update(schema.ImportMapping)
    .set({ identifierFieldKeys, defaultStrategy, updatedAt: new Date() })
    .where(eq(schema.ImportMapping.id, importMappingId))

  return { identifierFieldKeys, defaultStrategy }
}
