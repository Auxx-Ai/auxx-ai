// packages/lib/src/ai/kopilot/index.ts

export type { CapabilityRegistry, GetToolDeps, PageCapability, ToolDeps } from './capabilities'
export {
  createActorCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKbCapabilities,
  createKnowledgeCapabilities,
  createKopilotCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
  createToolDepsFactory,
  KB_PAGE,
} from './capabilities'
export type { KopilotDomainConfigOptions } from './domain-config'
export { createKopilotDomainConfig } from './domain-config'
export { generateSessionTitle } from './session-title'
export type {
  KopilotDomainState,
  PlanState,
  PlanStep,
  PlanStepStatus,
  SessionContext,
} from './types'
