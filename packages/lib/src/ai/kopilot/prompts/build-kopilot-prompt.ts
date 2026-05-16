// packages/lib/src/ai/kopilot/prompts/build-kopilot-prompt.ts

import type { ResolvedAgentConfig } from '../../../agents'
import type { IntegrationCatalogEntry } from '../../../cache/integration-catalog'
import { docToText } from '../../../tiptap'
import type { AgentToolDefinition } from '../../agent-framework/types'
import type { KopilotDomainState } from '../types'
import { buildAgentPersonaPrompt } from './agent-persona-prompt'
import { buildCoreRuntimePrompt } from './core-runtime-prompt'
import { buildKopilotMasterPersona } from './kopilot-master-persona'
import type { CurrentUserInfo, EntityCatalogEntry } from './shared-types'
import { renderTriggerSection, type TriggerContext } from './trigger-context'

/**
 * Compose the full system prompt for a Kopilot turn.
 *
 * Order: persona (master identity OR user-authored agent persona) →
 * trigger-run section (only on autonomous runs) → core runtime (job
 * statement, context, refs, catalogs, tool block, blocks/approval
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
 *
 * `triggerContext` (optional) is set when the run was kicked off by an
 * AgentTrigger. Renders the kind-specific context block, the operator's
 * trigger instructions, and the autonomous run-mode banner. See
 * `./trigger-context.ts` and plans/kopilot/agents/trigger-instructions.md.
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
  /** Present iff this run was fired by an AgentTrigger. */
  triggerContext?: TriggerContext
  /**
   * Optional resolver for inline `reference` chips inside the agent's
   * persona prompt (`tool:<name>`, `toolset:<slug>`, etc.). When omitted,
   * chips fall back to the default `[reference](id)` form — fine for
   * personas that never embed references.
   */
  instructionsReferences?: (id: string) => string
}): string {
  // Autonomous runs are always backed by a user-authored agent; the master
  // Kopilot never runs on a trigger. If this ever flips, the trigger
  // banner and persona will contradict each other — fail fast instead.
  if (args.triggerContext && (!args.agentConfig || args.agentConfig.agentId === null)) {
    throw new Error('buildKopilotPrompt: triggerContext set without a user-authored agentConfig')
  }
  const runMode: 'interactive' | 'autonomous' = args.triggerContext ? 'autonomous' : 'interactive'
  const persona =
    args.agentConfig && args.agentConfig.agentId !== null
      ? buildAgentPersonaPrompt({
          agentName: args.agentConfig.name,
          description: args.agentConfig.description ?? undefined,
          instructions: docToText(args.agentConfig.prompt, {
            references: args.instructionsReferences,
          }),
        })
      : buildKopilotMasterPersona({ capabilities: args.capabilities })
  const triggerSection = renderTriggerSection(args.triggerContext, {
    agentUserId: args.agentConfig?.userId ?? null,
  })
  const core = buildCoreRuntimePrompt({
    domainState: args.domainState,
    entityCatalog: args.entityCatalog,
    tools: args.tools,
    currentUser: args.currentUser,
    integrations: args.integrations,
    toolsetPromptAdditions: args.toolsetPromptAdditions,
    runMode,
  })
  return `${persona}${triggerSection}\n\n${core}`
}

/**
 * @deprecated Use `buildKopilotPrompt` — branches on `agentConfig` for
 * master vs user-authored persona.
 */
export const buildKopilotMasterPrompt = buildKopilotPrompt
