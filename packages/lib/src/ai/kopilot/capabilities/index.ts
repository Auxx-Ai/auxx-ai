// packages/lib/src/ai/kopilot/capabilities/index.ts

export { createActorCapabilities } from './actors'
export {
  AGENTS_BUILDER_PAGE,
  buildBuilderPersonaPrompt,
  createAgentsBuilderCapabilities,
  createSuggestRepliesGlobalCapability,
} from './agents-builder'
export { createAppCapabilities } from './apps'
export { getAppConnectionPresence } from './apps/connection-resolver'
export { createToolDepsFactory } from './create-deps'
export { createEntityCapabilities } from './entities'
export { createKbCapabilities, createKbReadCapabilities, KB_PAGE } from './kb'
export { createKnowledgeCapabilities } from './knowledge'
export { createKopilotCapabilities } from './kopilot'
export { createMailCapabilities } from './mail'
export { createCapabilityRegistry } from './registry'
export { createTaskCapabilities } from './tasks'
export type { CapabilityRegistry, GetToolDeps, PageCapability, ToolDeps } from './types'
export {
  assignVariableTool,
  createNativeWorkflowCapabilities,
  WORKFLOW_AI_NODE_PAGE,
  WORKFLOW_NATIVE_TOOLSET_SLUG,
} from './workflow'
