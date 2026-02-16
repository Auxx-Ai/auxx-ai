// packages/lib/src/snapshot/index.ts

// Functions
export {
  getOrCreateSnapshot,
  getSnapshotChunk,
  invalidateSnapshot,
  invalidateSnapshots,
  markResourceDirty,
} from './service'
// Types
export type {
  GetOrCreateSnapshotInput,
  GetSnapshotChunkInput,
  InvalidateSnapshotsInput,
  QuerySnapshot,
  SnapshotChunkResult,
  SnapshotResult,
} from './types'
