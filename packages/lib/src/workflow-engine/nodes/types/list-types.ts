// packages/lib/src/workflow-engine/nodes/types/list-types.ts

// The list node's operation vocabulary and config types moved to the node
// catalog (`../../catalog/nodes/list`, node-catalog Phase 1) — this file
// previously shadowed the builder's declarations. Re-exported so the
// processor's imports keep working.
export type {
  ListOperation,
  NullHandling,
  SortConfig,
  SortDirection,
} from '../../catalog/nodes/list'
