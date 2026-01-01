// packages/lib/src/snapshot/index.ts

// Types
export type {
  QuerySnapshot,
  GetOrCreateSnapshotInput,
  SnapshotResult,
  GetSnapshotChunkInput,
  SnapshotChunkResult,
  InvalidateSnapshotsInput,
} from './types'

// Functions
export {
  getOrCreateSnapshot,
  getSnapshotChunk,
  invalidateSnapshots,
  invalidateSnapshot,
} from './service'
