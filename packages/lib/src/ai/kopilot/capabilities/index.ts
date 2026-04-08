// packages/lib/src/ai/kopilot/capabilities/index.ts

export { createActorCapabilities } from './actors'
export { createToolDepsFactory } from './create-deps'
export { createEntityCapabilities } from './entities'
export { createKnowledgeCapabilities } from './knowledge'
export { createMailCapabilities } from './mail'
export { createCapabilityRegistry } from './registry'
export { createTaskCapabilities } from './tasks'
export type { CapabilityRegistry, GetToolDeps, PageCapability, ToolDeps } from './types'
