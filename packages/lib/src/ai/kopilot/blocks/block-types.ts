// packages/lib/src/ai/kopilot/blocks/block-types.ts

/**
 * Shared reference-block-type constants.
 *
 * Single source of truth for the block kinds the LLM may embed as `auxx:*`
 * fences inside the final assistant message. Imported by both the backend
 * `inject-snapshots.ts` (fence matching + fallback) and the frontend
 * `block-schemas.ts` / `assistant-message.tsx` (fence whitelist).
 *
 * This file is intentionally free of server-only imports so a frontend
 * build can pull it in through `@auxx/lib/ai/kopilot/blocks/block-types`.
 */

/** Block types the LLM may embed as `auxx:*` fences inside the final prose. */
export const REFERENCE_BLOCK_TYPES = [
  'entity-card',
  'entity-list',
  'thread-list',
  'task-list',
  'table',
] as const
export type ReferenceBlockType = (typeof REFERENCE_BLOCK_TYPES)[number]

/**
 * Subset of reference blocks that carry ids and receive snapshot injection.
 * `table` is excluded — it packs its own display data per-cell, no ids.
 */
export const SNAPSHOT_INJECTABLE_TYPES = [
  'entity-card',
  'entity-list',
  'thread-list',
  'task-list',
] as const
export type SnapshotInjectableType = (typeof SNAPSHOT_INJECTABLE_TYPES)[number]
