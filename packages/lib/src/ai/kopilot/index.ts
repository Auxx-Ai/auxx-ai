// packages/lib/src/ai/kopilot/index.ts

export type { CapabilityRegistry, GetToolDeps, PageCapability, ToolDeps } from './capabilities'
export {
  createActorCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKnowledgeCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
  createToolDepsFactory,
} from './capabilities'
export type { KopilotDomainConfigOptions } from './domain-config'
export { createKopilotDomainConfig } from './domain-config'
export { createSubmitFinalAnswerTool } from './meta-tools/submit-final-answer'
export { generateSessionTitle } from './session-title'
export type { KopilotDomainState, SessionContext } from './types'
