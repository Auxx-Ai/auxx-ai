// apps/web/src/components/workflow/utils/layout-constants.ts

// The layout constants moved to lib
// (`@auxx/lib/workflows/graph-edit/layout-constants`, Phase 3 §4) alongside the
// dagre helpers; re-exported here so no web import churns.
export {
  CONTAINER_LAYOUT_CONFIG,
  LAYOUT_ANIMATION,
  LAYOUT_CONFIG,
  LAYOUT_SPACING,
  NODE_ADDITION_CONFIG,
  NODE_CLASSIFICATIONS,
  type ResizeParamsWithDirection,
} from '@auxx/lib/workflows/graph-edit/layout-constants'
