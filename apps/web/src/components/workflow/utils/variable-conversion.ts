// apps/web/src/components/workflow/utils/variable-conversion.ts

// The output-variable constructors moved to the node catalog
// (`@auxx/lib/workflow-engine/catalog/variable-conversion`, Phase 2) so
// manifests can declare `resolveOutputs` server-side; re-exported here so no
// web import churns.
export {
  createNestedVariable,
  createUnifiedOutputVariable,
  deduplicateVariables,
  isNavigableVariable,
} from '@auxx/lib/workflow-engine/client'
