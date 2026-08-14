// apps/web/src/server/api/workflow-template-resolver.ts

// Moved to lib (graph-edit's `applyTemplate` shares the same file + admin
// template merge); re-exported here so no server import churns.
export { type ResolvedTemplate, resolveTemplateById } from '@auxx/lib/workflows'
