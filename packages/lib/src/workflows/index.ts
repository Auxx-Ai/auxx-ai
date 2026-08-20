// packages/lib/src/workflows/index.ts

export {
  buildTemplateWorkflowData,
  type TemplateForCreate,
  type TemplateWorkflowData,
} from './create-from-template'
export { normalizeTemplateGraph } from './normalize-template-graph'
export { type ResolvedTemplate, resolveTemplateById } from './resolve-template'
export { type SystemWorkflowRun, startSystemWorkflowRun } from './system-workflow-run'
export type { WorkflowGraph } from './template-graph-transformer'
export { TemplateGraphTransformer } from './template-graph-transformer'
export {
  checkEntityReadiness,
  type EntityResolutionResult,
  extractRequiredEntities,
  type RequiredEntity,
  type ResolvedApp,
  resolveAllAppSlugs,
  resolveAppSlugForOrg,
  resolveEntityRefsInGraph,
  resolveFieldsFromInstallerResult,
} from './template-resolution'
export {
  FILE_TEMPLATE_ID_PREFIX,
  FILE_TEMPLATES,
  type FileWorkflowTemplate,
  type FileWorkflowTemplateListItem,
  getFileTemplateById,
  isFileTemplateId,
  type ListFileTemplatesOptions,
  listFileTemplates,
} from './templates'
// Export all types
export * from './types'
export { firstPathSegment, rewriteVariableRefs } from './variable-ref-rewriter'
export {
  assertWorkflowAppNotSystemOwned,
  assertWorkflowRunNotSystemOwned,
  assertWorkflowVersionNotSystemOwned,
  getWorkflowRunCreatorId,
  type WorkflowAppAccessOptions,
} from './workflow-app-access-guard'
export {
  getWorkflowExecutionEvents,
  type SSEResponse,
  type WorkflowEvent,
  WorkflowExecutionEvents,
  workflowExecutionEvents,
} from './workflow-execution-events'
export {
  type CreatedWorkflowRun,
  createWorkflowRun,
  WorkflowExecutionService,
} from './workflow-execution-service'
// Export all services
export { toWorkflowAppResponse, WorkflowService } from './workflow-service'
export { WorkflowStatsService } from './workflow-stats-service'
export { WorkflowVersionService } from './workflow-version-service'
