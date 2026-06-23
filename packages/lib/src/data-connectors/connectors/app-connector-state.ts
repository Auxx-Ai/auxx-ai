// packages/lib/src/data-connectors/connectors/app-connector-state.ts
// Pure cursor-translation helpers for the app-connector adapter — the boundary
// between the engine's structured `SyncCursor` (opaque token the core persists +
// forwards but never interprets) and the FLAT, JSON-serializable cursor an app
// author deals in (`ConnectorStreamState.cursor`). Kept separate from the adapter
// so they unit-test without the adapter's lazy cluster imports.

import type { SyncCursor } from '../../sync-core/contracts'

/**
 * Decode the engine's backfill `SyncCursor` into the flat app cursor it carries.
 * The adapter JSON-encodes the app's (possibly structured) cursor into
 * `SyncCursor.value`; this reverses it. A malformed/legacy value yields
 * `undefined` rather than throwing — a bad cursor must never fail a live sync.
 */
export function decodeCursor(cursor?: SyncCursor): unknown {
  if (!cursor || typeof cursor.value !== 'string') return undefined
  try {
    return JSON.parse(cursor.value)
  } catch {
    return undefined
  }
}

/**
 * Encode the app's flat cursor into the opaque token `SyncCursor` the engine
 * persists. `kind` is always `'token'` for app connectors — the engine treats
 * `value` as opaque, so any JSON-serializable cursor (string or object) survives
 * the round-trip intact.
 */
export function encodeCursor(value: unknown): SyncCursor {
  return { kind: 'token', value: JSON.stringify(value) }
}
