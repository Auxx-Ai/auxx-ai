// packages/lib/src/snapshot/types.ts

import type { ConditionGroup } from '../conditions'

/**
 * Cached snapshot of filtered record IDs
 */
export interface QuerySnapshot {
  /** Unique snapshot ID */
  id: string
  /** Organization this snapshot belongs to */
  organizationId: string
  /** Resource type (e.g., 'contact', 'entity_abc123') */
  resourceType: string
  /** Hash of filter + sorting config for deduplication */
  filterHash: string
  /** Total count of matching records */
  total: number
  /** When snapshot was created */
  createdAt: number
}

/**
 * Input for creating/retrieving a query snapshot
 */
export interface GetOrCreateSnapshotInput {
  organizationId: string
  resourceType: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
  /** Function to execute if cache miss */
  executeQuery: () => Promise<string[]>
}

/**
 * Result from getOrCreateSnapshot
 */
export interface SnapshotResult {
  snapshotId: string
  ids: string[]
  total: number
  fromCache: boolean
}

/**
 * Input for getting a chunk from existing snapshot
 */
export interface GetSnapshotChunkInput {
  snapshotId: string
  offset: number
  limit: number
}

/**
 * Result from getSnapshotChunk
 */
export interface SnapshotChunkResult {
  ids: string[]
  total: number
}

/**
 * Input for invalidating snapshots
 */
export interface InvalidateSnapshotsInput {
  organizationId: string
  resourceType: string
}
