// packages/lib/src/ai/kopilot/prompts/build-kopilot-prompt.ts

import type { IntegrationCatalogEntry } from '../../../cache/integration-catalog'
import type { AgentToolDefinition } from '../../agent-framework/types'
import type { KopilotDomainState } from '../types'
import { buildCoreRuntimePrompt } from './core-runtime-prompt'
import { buildKopilotMasterPersona } from './kopilot-master-persona'
import type { CurrentUserInfo, EntityCatalogEntry } from './shared-types'

/**
 * Compose the full system prompt for the master Kopilot agent.
 *
 * Order: persona (identity + capabilities + scope guard) → core runtime
 * (job statement, context, refs, catalogs, tool block, blocks/approval
 * mechanism, instructions, toolset prompt additions).
 *
 * `toolsetPromptAdditions` carries the per-capability rules
 * (`PageCapability.systemPromptAddition`) for whatever capabilities are
 * active on the current page — Hard rules from mail, When to plan from
 * kopilot, Cross-cutting flows from entities, etc. Resolved by the
 * caller against the capability registry.
 */
export function buildKopilotMasterPrompt(args: {
  domainState: KopilotDomainState
  entityCatalog: EntityCatalogEntry[]
  capabilities: string[]
  tools: AgentToolDefinition[]
  currentUser: CurrentUserInfo | null
  integrations: IntegrationCatalogEntry[]
  toolsetPromptAdditions: string
}): string {
  const persona = buildKopilotMasterPersona({ capabilities: args.capabilities })
  const core = buildCoreRuntimePrompt({
    domainState: args.domainState,
    entityCatalog: args.entityCatalog,
    tools: args.tools,
    currentUser: args.currentUser,
    integrations: args.integrations,
    toolsetPromptAdditions: args.toolsetPromptAdditions,
  })
  return `${persona}\n\n${core}`
}
