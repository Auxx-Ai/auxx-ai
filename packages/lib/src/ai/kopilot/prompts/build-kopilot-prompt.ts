// packages/lib/src/ai/kopilot/prompts/build-kopilot-prompt.ts

import { createScopedLogger } from '@auxx/logger'
import type { ResolvedAgentConfig } from '../../../agents'
import type { IntegrationCatalogEntry } from '../../../cache/integration-catalog'
import type { AgentToolDefinition } from '../../agent-framework/types'
import type { KopilotDomainState } from '../types'
import { SYSTEM_PROMPT_SECTIONS } from './sections/registry'
import {
  type PromptBlock,
  renderSections,
  renderSectionsToBlocks,
  serializePromptBlocks,
  summarizePromptBlocks,
} from './sections/render'
import type { ProcedureStepInput, PromptCtx, RunMode } from './sections/types'

export type { PromptBlock } from './sections/render'
export { CACHE_BREAK_SENTINEL, stripCacheBreakSentinels } from './sections/render'

import type { CurrentUserInfo, EntityCatalogEntry } from './shared-types'
import type { TriggerContext } from './trigger-context'

export interface BuildKopilotPromptArgs {
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
   * chips fall back to the default `[reference](id)` form.
   */
  instructionsReferences?: (id: string) => string
  /**
   * The top frame's active procedure step (v9 procedures). Set by the Phase-4
   * turn preamble (read off `domainState[PROCEDURE_STEP_KEY]`) while a frame is
   * active; unset on free-form turns so `agentProcedureStep` renders `null`.
   */
  procedureStep?: ProcedureStepInput
}

/**
 * Compose the full system prompt for a Kopilot turn.
 *
 * Order is `SYSTEM_PROMPT_SECTIONS`: persona → trigger-bundle (autonomous
 * only) → core runtime sections. Each section gates itself on `runMode`
 * and on the relevant fields in `PromptCtx`.
 *
 * `toolsetPromptAdditions` carries the per-capability rules
 * (`PageCapability.systemPromptAddition`) for whatever capabilities are
 * active on the current page — Hard rules from mail, When to plan from
 * kopilot, etc. Resolved by the caller against the capability registry.
 *
 * `triggerContext` (optional) is set when the run was kicked off by an
 * AgentTrigger. See `./trigger-context.ts` and
 * plans/kopilot/agents/trigger-instructions.md.
 */
export function buildKopilotPrompt(args: BuildKopilotPromptArgs): string {
  return renderSections(SYSTEM_PROMPT_SECTIONS, buildPromptCtx(args))
}

/**
 * Block-aware variant of `buildKopilotPrompt`. Returns the prompt as
 * tier-grouped `PromptBlock[]` with `cache: { type: 'ephemeral' }` on the
 * last block of the static tier and the last block of the org tier.
 *
 * Use this at the LLM call site to wire Anthropic `cache_control`. The
 * Kopilot agent ships the result as a single system message string with
 * `CACHE_BREAK_SENTINEL` markers (see `serializePromptBlocks`), and the
 * Anthropic client recovers per-block cache boundaries.
 */
export function buildKopilotPromptBlocks(args: BuildKopilotPromptArgs): PromptBlock[] {
  return renderSectionsToBlocks(SYSTEM_PROMPT_SECTIONS, buildPromptCtx(args))
}

/**
 * Serialised flavour for `Message.content` — emits the prompt as a single
 * string with sentinel markers at each cache boundary. The Anthropic LLM
 * client splits on the sentinel; other providers strip it. Equivalent to
 * `buildKopilotPrompt` when there are no cached tiers.
 */
export function buildKopilotPromptSerialized(args: BuildKopilotPromptArgs): string {
  const blocks = buildKopilotPromptBlocks(args)
  // Opt-in prompt-size instrumentation for the caching investigation. Logs the
  // static/org/turn split and the cacheable-prefix size so we can see how much
  // of the prompt is inter-org shareable. Gated to keep normal logs quiet.
  if (process.env.KOPILOT_PROMPT_METRICS === '1') {
    promptMetricsLogger.info('Kopilot prompt blocks', summarizePromptBlocks(blocks))
  }
  return serializePromptBlocks(blocks)
}

const promptMetricsLogger = createScopedLogger('kopilot-prompt-metrics')

function buildPromptCtx(args: BuildKopilotPromptArgs): PromptCtx {
  // DM is an interactive trigger — a human is in the loop, just authored on a
  // specific agent's surface. All other trigger kinds run autonomously.
  const isDmTrigger = args.triggerContext?.kind === 'dm'
  const runMode: RunMode = args.triggerContext && !isDmTrigger ? 'autonomous' : 'interactive'

  // Any triggerContext (autonomous or DM) is always backed by a user-authored
  // agent; the master Kopilot never runs on a trigger. Fail fast if they ever
  // contradict.
  if (args.triggerContext && (!args.agentConfig || args.agentConfig.agentId === null)) {
    throw new Error('buildKopilotPrompt: triggerContext set without a user-authored agentConfig')
  }

  return {
    runMode,
    tools: args.tools,
    toolNames: new Set(args.tools.map((t) => t.name)),
    currentUser: args.currentUser,
    integrations: args.integrations,
    entityCatalog: args.entityCatalog,
    domainState: args.domainState,
    toolsetPromptAdditions: args.toolsetPromptAdditions,
    agentConfig: args.agentConfig,
    capabilities: args.capabilities,
    instructionsReferences: args.instructionsReferences,
    triggerContext: args.triggerContext,
    procedureStep: args.procedureStep,
  }
}

/**
 * @deprecated Use `buildKopilotPrompt` — branches on `agentConfig` for
 * master vs user-authored persona.
 */
export const buildKopilotMasterPrompt = buildKopilotPrompt
