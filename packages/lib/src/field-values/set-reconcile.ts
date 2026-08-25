// packages/lib/src/field-values/set-reconcile.ts
//
// Pure diff for the set-shaped field-value write (plans/field-values/
// delete-insert-replace.md §5B): given the stored rows for one
// (entityId, fieldId) pair and the target rows the write wants, emit the
// minimal statement plan — keep untouched rows, UPDATE changed positions in
// place, INSERT only a grown tail, DELETE only a shrunk tail. Positional
// matching (i-th stored row by sortKey ↔ i-th target value) is the promised
// granularity: the (entityId, fieldId, position) row is stable; we do NOT
// promise "the row follows the value" across reorders.
//
// The caller MUST feed this rows read INSIDE its transaction, after the
// advisory lock (§5B RULE) — a diff computed against an outside-the-lock
// snapshot silently interleaves with a concurrent writer's rows.
//
// No DB access here: this module stays unit-testable without a database.

import type { schema } from '@auxx/database'
import { readEnvelope } from '@auxx/types/field-value'
import { isValidOrderKey, nKeysAfter } from '@auxx/utils/fractional-indexing'
import { stableStringify } from '@auxx/utils/json'

/**
 * Longest stored sortKey the reconcile will work with. Fractional keys grow
 * only through repeated between-inserts; anything past this length (or any
 * invalid/disordered key) routes the write to the full-rewrite fallback,
 * which re-mints canonical `a0…aN` keys — the fallback doubles as the
 * opportunistic compactor, so no background rebalancing job is needed.
 */
export const MAX_SANE_SORT_KEY_LENGTH = 32

/** Insert-shaped row; `aiStatus` present only on stage-2 AI commit rows. */
export type FieldValueInsertRow = typeof schema.FieldValue.$inferInsert & {
  aiStatus?: string | null
}

/** The stored-row shape the diff compares (raw DB row + AI marker column). */
export interface StoredSetRow {
  id: string
  sortKey: string
  aiStatus?: string | null
  managedByConnectorId?: string | null
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  valueJson: unknown | null
  optionId: string | null
  relatedEntityId: string | null
  relatedEntityDefinitionId: string | null
  actorId: string | null
}

export type SetReconcilePlan<R extends StoredSetRow> =
  | {
      /** Stored keys are unusable — fall back to full DELETE+INSERT with fresh canonical keys. */
      kind: 'rewrite'
      reason: 'invalid-key' | 'grown-key' | 'disordered-keys'
    }
  | {
      kind: 'diff'
      /** Positions whose stored row already matches the target — zero statements. */
      keep: Array<{ position: number; row: R }>
      /** Positions whose payload or AI-marker state differs — one UPDATE by row id each. */
      update: Array<{ position: number; row: R; target: FieldValueInsertRow }>
      /** Target grew past the stored count — tail rows with keys minted after the last surviving key. */
      insertTail: FieldValueInsertRow[]
      /** Target shrank — stored tail rows to DELETE by id. */
      deleteIds: string[]
    }

/**
 * TOTAL, conservative payload equality between one stored row and the row the
 * write would insert (`buildFieldValueRow` output). Every value column is
 * compared; any uncertainty (unparseable date, non-finite number, JSON that
 * fails to serialize) answers "changed", so the worst a wrong answer can cost
 * is one unnecessary in-place UPDATE.
 */
export function existingRowMatchesInsert(
  existing: StoredSetRow,
  insert: FieldValueInsertRow
): boolean {
  // Connector ownership is part of the row's identity for the diff: a stored
  // marker the incoming write does not re-assert is a REAL change — the old
  // DELETE+INSERT cleared ownership on every set-write, and keeping the row
  // marked would let the connector overwrite the user's manual edit on its
  // next sync (and hide the edit from scalar drift detection).
  if ((existing.managedByConnectorId ?? null) !== (insert.managedByConnectorId ?? null)) {
    return false
  }

  // Text-like columns: null-safe strict equality, no normalization.
  if ((existing.valueText ?? null) !== (insert.valueText ?? null)) return false
  if ((existing.optionId ?? null) !== (insert.optionId ?? null)) return false
  if ((existing.relatedEntityId ?? null) !== (insert.relatedEntityId ?? null)) return false
  if ((existing.relatedEntityDefinitionId ?? null) !== (insert.relatedEntityDefinitionId ?? null)) {
    return false
  }
  if ((existing.actorId ?? null) !== (insert.actorId ?? null)) return false
  if ((existing.valueBoolean ?? null) !== (insert.valueBoolean ?? null)) return false

  // Numbers: compare numerically; anything non-finite is "changed".
  const existingNum = existing.valueNumber ?? null
  const insertNum = insert.valueNumber ?? null
  if ((existingNum === null) !== (insertNum === null)) return false
  if (existingNum !== null && insertNum !== null) {
    const a = Number(existingNum)
    const b = Number(insertNum)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a !== b) return false
  }

  // Dates: `valueDate` is a `mode: 'string'` timestamp, so the stored pg text
  // form and a fresh `toISOString()` differ textually for the same instant —
  // compare by parsed instant, and treat unparseable as "changed".
  const existingDate = existing.valueDate ?? null
  const insertDate = insert.valueDate ?? null
  if ((existingDate === null) !== (insertDate === null)) return false
  if (existingDate !== null && insertDate !== null) {
    const a = Date.parse(existingDate)
    const b = Date.parse(insertDate)
    if (Number.isNaN(a) || Number.isNaN(b) || a !== b) return false
  }

  // JSON: jsonb does not preserve object key order, so compare both envelope
  // halves via `stableStringify` (the repo's canonical jsonb comparison).
  // `meta` must match too — dropping stored metadata the incoming write
  // doesn't re-assert is a REAL change (this is also what makes an AI
  // stage-2 commit with fresh generation metadata land as an UPDATE even
  // when the visible value is identical).
  const existingJson = existing.valueJson ?? null
  const insertJson = (insert.valueJson as unknown) ?? null
  if ((existingJson === null) !== (insertJson === null)) return false
  if (existingJson !== null && insertJson !== null) {
    try {
      const a = readEnvelope(existingJson)
      const b = readEnvelope(insertJson)
      if (stableStringify(a.v ?? null) !== stableStringify(b.v ?? null)) return false
      if (stableStringify(a.meta ?? null) !== stableStringify(b.meta ?? null)) return false
    } catch {
      return false
    }
  }

  return true
}

/**
 * The value columns an in-place UPDATE rewrites — everything
 * `buildFieldValueRow` decides, plus the AI marker pair and connector
 * ownership. Explicit `aiStatus: null` / `managedByConnectorId: null` on a
 * manual write is what clears a stale marker in place (§4: the old
 * DELETE+INSERT cleared both by omission on the fresh insert).
 * Identity and ordering columns (id, entityId, fieldId, organizationId,
 * entityDefinitionId, sortKey, createdAt) are deliberately NOT touched.
 */
export function updateColumnsFor(target: FieldValueInsertRow): {
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  valueJson: unknown
  optionId: string | null
  relatedEntityId: string | null
  relatedEntityDefinitionId: string | null
  actorId: string | null
  aiStatus: string | null
  managedByConnectorId: string | null
} {
  return {
    managedByConnectorId: target.managedByConnectorId ?? null,
    valueText: target.valueText ?? null,
    valueNumber: target.valueNumber ?? null,
    valueBoolean: target.valueBoolean ?? null,
    valueDate: target.valueDate ?? null,
    valueJson: target.valueJson ?? null,
    optionId: target.optionId ?? null,
    relatedEntityId: target.relatedEntityId ?? null,
    relatedEntityDefinitionId: target.relatedEntityDefinitionId ?? null,
    actorId: target.actorId ?? null,
    aiStatus: target.aiStatus ?? null,
  }
}

/**
 * Diff the stored rows (sortKey-ordered) against the target rows. Target
 * sortKeys are ignored for surviving positions (rows keep their stored keys);
 * a grown tail gets keys minted after the last surviving stored key, so the
 * tail sorts after every kept row. An empty target list plans a pure delete.
 */
export function planSetReconcile<R extends StoredSetRow>(
  existing: R[],
  targets: FieldValueInsertRow[]
): SetReconcilePlan<R> {
  for (let i = 0; i < existing.length; i++) {
    const key = existing[i]!.sortKey
    if (!isValidOrderKey(key)) return { kind: 'rewrite', reason: 'invalid-key' }
    if (key.length > MAX_SANE_SORT_KEY_LENGTH) return { kind: 'rewrite', reason: 'grown-key' }
    if (i > 0 && !(existing[i - 1]!.sortKey < key)) {
      return { kind: 'rewrite', reason: 'disordered-keys' }
    }
  }

  const keep: Array<{ position: number; row: R }> = []
  const update: Array<{ position: number; row: R; target: FieldValueInsertRow }> = []
  const shared = Math.min(existing.length, targets.length)

  for (let i = 0; i < shared; i++) {
    const row = existing[i]!
    const target = targets[i]!
    const markerMatches = (row.aiStatus ?? null) === (target.aiStatus ?? null)
    if (markerMatches && existingRowMatchesInsert(row, target)) {
      keep.push({ position: i, row })
    } else {
      update.push({ position: i, row, target })
    }
  }

  let insertTail: FieldValueInsertRow[] = []
  if (targets.length > existing.length) {
    const lastSurvivingKey = existing.length > 0 ? existing[existing.length - 1]!.sortKey : null
    const tailKeys = nKeysAfter(lastSurvivingKey, targets.length - existing.length)
    insertTail = targets.slice(existing.length).map((t, j) => ({ ...t, sortKey: tailKeys[j]! }))
  }

  const deleteIds: string[] = []
  for (let i = targets.length; i < existing.length; i++) {
    deleteIds.push(existing[i]!.id)
  }

  return { kind: 'diff', keep, update, insertTail, deleteIds }
}
