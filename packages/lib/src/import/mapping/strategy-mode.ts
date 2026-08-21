// packages/lib/src/import/mapping/strategy-mode.ts

import type { ImportStrategyMode } from '../types/mapping'

/**
 * The three job-level import modes, in the order the wizard offers them.
 * `ImportMapping.defaultStrategy` is plain `text()` with no enum constraint, so
 * this list, not the database, is what makes the value total.
 */
export const IMPORT_STRATEGY_MODES = ['create', 'update', 'create-or-update'] as const

/** True when `value` is one of the three live import modes. */
export function isImportStrategyMode(value: unknown): value is ImportStrategyMode {
  return typeof value === 'string' && (IMPORT_STRATEGY_MODES as readonly string[]).includes(value)
}

/**
 * Read a stored `defaultStrategy` as a mode, tolerating anything else.
 *
 * The retired `'skip'` member is the only value this is expected to meet, and
 * no row in any org carries it (`defaultStrategy` has only ever been written as
 * the literal `'create'` at INSERT). Being total here costs one comparison and
 * removes a crash-on-legacy-data class entirely.
 *
 * @param value - Raw column value
 * @returns The mode, defaulting to `'create'`
 */
export function toImportStrategyMode(value: unknown): ImportStrategyMode {
  return isImportStrategyMode(value) ? value : 'create'
}
