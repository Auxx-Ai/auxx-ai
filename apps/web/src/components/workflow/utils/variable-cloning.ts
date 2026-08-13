// apps/web/src/components/workflow/utils/variable-cloning.ts

// Moved to the node catalog
// (`@auxx/lib/workflow-engine/catalog/variable-cloning`, Phase 2) — the list
// and loop resolvers need these server-side; re-exported here so no web
// import churns.
export {
  assignVariableIds,
  cloneAndRewriteVariableIds,
} from '@auxx/lib/workflow-engine/client'
