// apps/web/src/components/workflow/nodes/core/chunker/output-variables.ts

// The generator moved to the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/chunker`) so the manifest's
// `resolveOutputs` and the builder picker are the SAME function — byte-identical
// by construction rather than by two copies staying in sync. Re-exported here so
// no consumer import churns.
export { getChunkerOutputVariables } from '@auxx/lib/workflow-engine/client'
