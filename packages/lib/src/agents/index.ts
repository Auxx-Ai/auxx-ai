// packages/lib/src/agents/index.ts

export {
  type AgentScopeMode,
  type AgentScopeRemoveInput,
  type AgentScopeUpsertInput,
  batchSetAgentResourceScopes,
  recordMatchesScopeRow,
  removeAgentScopeRow,
  ScopeRowImmutableError,
  upsertAgentScopeRow,
} from './agent-scope-service'
export {
  type AgentDetail,
  type AgentSummary,
  agentExistsInOrg,
  archiveAgent,
  type CreateAgentInput,
  type CreatedAgent,
  completeAgentSetup,
  createAgent,
  deleteAgent,
  deleteDraftAgent,
  getAgentDetail,
  getAgentDetailByIdOrSlug,
  isAgentSlugTaken,
  listAgents,
  type UpdateAgentInput,
  updateAgent,
} from './agent-service'
export {
  type AgentToolsetPatch,
  applyToolsetPatch,
  batchUpdateAgentToolsets,
  listAgentToolsets,
  updateAgentToolset,
} from './agent-toolset-service'
export type { AgentToolsetConfig } from './agent-toolset-types'
export { getTriggerLabel } from './agent-trigger-label'
export { matchesFilter } from './agent-trigger-queries'
export {
  type AgentEventTriggerType,
  type AgentTriggerInput,
  type AgentTriggerKind,
  AgentTriggerService,
  ALLOWED_DIRECT_EVENT_TYPES,
  type AllowedDirectEventType,
  type AppTriggerInput,
  type AssignmentTriggerInput,
  type CreateAgentTriggerInput,
  type CrudEventTriggerInput,
  type DmTriggerInput,
  type MentionTriggerInput,
  type ScheduledTriggerInput,
  type UpdateAgentTriggerInput,
} from './agent-trigger-service'
export {
  type BuildDmTriggerContextResult,
  buildDmTriggerContext,
  type DmTriggerContext,
} from './build-dm-trigger-context'
export { BUILTIN_APP, BUILTIN_TOOLSETS, getBuiltinToolset } from './builtin-app'
export { BUILTIN_DEFAULT_TOOLSETS, resolveDefaultToolsets } from './default-toolsets'
export { filterToolsByToolsets } from './filter-tools'
export {
  type KnowledgeEntry,
  type KnowledgeMode,
  type KnowledgeSource,
  type MentionSource,
  reconcileKnowledgeMentions,
  reconcilePromptMentions,
  reconcileToolsetMentions,
  type ToolsetEntry,
  type ToolsetSource,
  walkPromptDoc,
  walkPromptDocs,
} from './prompt-mention-reconciler'
export { type ResolvedAgentConfig, resolveAgentConfig } from './resolve-agent-config'
export {
  type SetAgentToolBindingsInput,
  setAgentToolBindings,
} from './set-tool-restrictions'
export { AGENT_SLUG_MAX, AGENT_SLUG_REGEX, agentSlugSchema } from './slug-schema'
export {
  isToolVisibleOn,
  type ToolVisibilitySurface,
  toolCategory,
} from './tool-visibility'
export {
  type CatalogContainerNode,
  type CatalogNode,
  type CatalogToolsetNode,
  type FlatToolCatalogEntry,
  getOrgCatalogTree,
  getOrgToolCatalog,
  getOrgToolsetCatalog,
  type ToolCatalogEntry,
  type ToolsetCatalogEntry,
} from './toolset-catalog'
