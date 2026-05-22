// packages/lib/src/ai/kopilot/index.ts

export type { CapabilityRegistry, GetToolDeps, PageCapability, ToolDeps } from './capabilities'
export {
  AGENTS_BUILDER_PAGE,
  buildBuilderPersonaPrompt,
  createActorCapabilities,
  createAgentsBuilderCapabilities,
  createAppCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKbCapabilities,
  createKbReadCapabilities,
  createKnowledgeCapabilities,
  createKopilotCapabilities,
  createMailCapabilities,
  createNativeWorkflowCapabilities,
  createSuggestRepliesGlobalCapability,
  createTaskCapabilities,
  createToolDepsFactory,
  KB_PAGE,
  WORKFLOW_AI_NODE_PAGE,
  WORKFLOW_NATIVE_TOOLSET_SLUG,
} from './capabilities'
export { applyContextDefaults, findAllRefs, findRef } from './context-refs'
export type { KopilotDomainConfigOptions } from './domain-config'
export { createKopilotDomainConfig } from './domain-config'
export {
  loadMasterKopilotSettings,
  type MasterKopilotSettings,
} from './load-master-settings'
export type { TriggerContext, TriggerKind } from './prompts/trigger-context'
export {
  type RunStructuredOutputPassArgs,
  type RunWorkflowAiTurnArgs,
  type RunWorkflowAiTurnResult,
  runStructuredOutputPass,
  runWorkflowAiTurn,
  type ToolCallSummary,
} from './runners'
export { generateSessionTitle } from './session-title'
export type {
  KopilotDomainState,
  PlanState,
  PlanStep,
  PlanStepStatus,
  SessionContext,
  SessionRef,
  SessionRefKind,
} from './types'
