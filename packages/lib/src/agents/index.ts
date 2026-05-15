// packages/lib/src/agents/index.ts

export {
  type AgentPinInput,
  type AgentScopeMode,
  type AgentScopeRemoveInput,
  type AgentScopeUpsertInput,
  batchSetAgentResourceScopes,
  PIN_HARD_CAP,
  PinLimitExceededError,
  parseRecordIdForScope,
  recordMatchesScopeRow,
  removeAgentScopeRow,
  ScopeRowImmutableError,
  setAgentPin,
  upsertAgentScopeRow,
} from './agent-scope-service'
export {
  type AgentDetail,
  type AgentSummary,
  agentExistsInOrg,
  archiveAgent,
  type CreateAgentInput,
  type CreatedAgent,
  createAgent,
  getAgentDetail,
  getAgentDetailByIdOrSlug,
  isAgentSlugTaken,
  listAgents,
  type UpdateAgentInput,
  updateAgent,
} from './agent-service'
export {
  type AgentToolsetPatch,
  batchUpdateAgentToolsets,
  listAgentToolsets,
  updateAgentToolset,
} from './agent-toolset-service'
export type { AgentToolsetConfig } from './agent-toolset-types'
export { NATIVE_DEFAULT_TOOLSETS, resolveDefaultToolsets } from './default-toolsets'
export { filterToolsByToolsets } from './filter-tools'
export { type ResolvedAgentConfig, resolveAgentConfig } from './resolve-agent-config'
export {
  getOrgToolsetCatalog,
  NATIVE_TOOLSET_LABELS,
  type ToolCatalogEntry,
  type ToolsetCatalogEntry,
} from './toolset-catalog'
