// packages/lib/src/ai/kopilot/index.ts

export type { CapabilityRegistry, GetToolDeps, PageCapability, ToolDeps } from './capabilities'
export {
  createCapabilityRegistry,
  createMailCapabilities,
  createToolDepsFactory,
} from './capabilities'
export type { KopilotDomainConfigOptions } from './domain-config'
export { createKopilotDomainConfig } from './domain-config'
export { generateSessionTitle } from './session-title'
export type {
  KopilotDomainState,
  KopilotExecutionMode,
  KopilotRoute,
  KopilotSessionContext,
  PlanStep,
  SupervisorClassification,
} from './types'
