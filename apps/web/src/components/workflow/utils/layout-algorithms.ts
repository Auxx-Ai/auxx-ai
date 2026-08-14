// apps/web/src/components/workflow/utils/layout-algorithms.ts

// The dagre layout helpers moved to lib (`@auxx/lib/workflows/graph-edit/layout`,
// Phase 3 §4) so one algorithm positions both agent-added and canvas-added
// nodes; re-exported here so no web import churns.
export {
  calculateContainerSize,
  getLayoutByDagre,
  getLayoutForChildNodes,
} from '@auxx/lib/workflows/graph-edit/layout'
