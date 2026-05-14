// packages/lib/src/ai/kopilot/prompts/build-kopilot-prompt.ts

import type { ResolvedAgentConfig } from '../../../agents'
import type { IntegrationCatalogEntry } from '../../../cache/integration-catalog'
import type { AgentToolDefinition } from '../../agent-framework/types'
import { tiptapDocToPlainText } from '../blocks/tiptap-to-plain-text'
import type { KopilotDomainState } from '../types'
import { buildAgentPersonaPrompt } from './agent-persona-prompt'
import { buildCoreRuntimePrompt } from './core-runtime-prompt'
import { buildKopilotMasterPersona } from './kopilot-master-persona'
import type { CurrentUserInfo, EntityCatalogEntry } from './shared-types'

/**
 * Compose the full system prompt for a Kopilot turn.
 *
 * Order: persona (master identity OR user-authored agent persona) → core
 * runtime (job statement, context, refs, catalogs, tool block, blocks/approval
 * mechanism, instructions, toolset prompt additions).
 *
 * The persona slot branches on whether the session is master Kopilot
 * (`agentConfig` is master or undefined) or a user-authored agent.
 *
 * `toolsetPromptAdditions` carries the per-capability rules
 * (`PageCapability.systemPromptAddition`) for whatever capabilities are
 * active on the current page — Hard rules from mail, When to plan from
 * kopilot, Cross-cutting flows from entities, etc. Resolved by the
 * caller against the capability registry.
 */
export function buildKopilotPrompt(args: {
  domainState: KopilotDomainState
  entityCatalog: EntityCatalogEntry[]
  capabilities: string[]
  tools: AgentToolDefinition[]
  currentUser: CurrentUserInfo | null
  integrations: IntegrationCatalogEntry[]
  toolsetPromptAdditions: string
  /** Master sentinel or undefined → master persona; agent → agent persona. */
  agentConfig?: ResolvedAgentConfig
}): string {
  const persona =
    args.agentConfig && args.agentConfig.agentId !== null
      ? buildAgentPersonaPrompt({
          agentName: args.agentConfig.name,
          description: args.agentConfig.description ?? undefined,
          instructions: tiptapDocToPlainText(args.agentConfig.prompt),
        })
      : buildKopilotMasterPersona({ capabilities: args.capabilities })
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

/**
 * @deprecated Use `buildKopilotPrompt` — branches on `agentConfig` for
 * master vs user-authored persona.
 */
export const buildKopilotMasterPrompt = buildKopilotPrompt
