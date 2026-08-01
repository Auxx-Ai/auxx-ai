// packages/lib/src/ai/kopilot/agents/agent.ts

import { createScopedLogger } from '@auxx/logger'
import { toActorId } from '@auxx/types/actor'
import { getOrgToolCatalog, getOrgToolsetCatalog, type ResolvedAgentConfig } from '../../../agents'
import type { AgentSurface } from '../../../agents/client'
import { PROCEDURE_STEP_KEY } from '../../../agents/procedures/persist'
import type { ResolvedKnowledgeScope } from '../../../agents/resolve-knowledge-scope'
import { getCachedIntegrationCatalog } from '../../../cache/integration-catalog'
import {
  getCachedKbCatalog,
  getCachedMembersByUserIds,
  getCachedResources,
} from '../../../cache/org-cache-helpers'
import type { CapabilityView } from '../../../permissions/capabilities/capability-view'
import type {
  AgentDefinition,
  AgentDeps,
  AgentState,
  AgentToolDefinition,
} from '../../agent-framework/types'
import { sessionMessagesToWire } from '../../agent-framework/utils'
import type { Message, ToolCall } from '../../clients/base/types'
import { transformAssistantContentForLLM } from '../blocks/transform-for-llm'
import { isAiVisibleResource } from '../capabilities/entities/shared/ai-entity-visibility'
import { buildKopilotPromptSerialized } from '../prompts/build-kopilot-prompt'
import { buildInstructionReferenceResolver } from '../prompts/resolve-instruction-references'
import type { Audience, ProcedureStepInput } from '../prompts/sections/types'
import type { CurrentUserInfo } from '../prompts/shared-types'
import type { TriggerContext } from '../prompts/trigger-context'
import type { KopilotDomainState } from '../types'

const logger = createScopedLogger('kopilot-agent')

export interface CreateKopilotAgentOptions {
  /** Business tools scoped to the current page (from CapabilityRegistry.getTools) */
  tools: AgentToolDefinition[]
  /** Human-friendly capability descriptions surfaced on request */
  capabilities?: string[]
  /** Max tool-use iterations before forcing a stop (default: 15) */
  maxIterations?: number
  /**
   * Concatenated `systemPromptAddition` strings from the active capabilities
   * on the current page, resolved by the caller via
   * `CapabilityRegistry.getSystemPromptAddition(page)`. Empty string when no
   * capability declares an addition.
   */
  toolsetPromptAdditions?: string
  /**
   * Per-session resolved agent configuration. Undefined or master sentinel
   * (`agentId === null`) renders the master Kopilot persona; a user-authored
   * agent renders its persona from `prompt` / `name` / `description`.
   */
  agentConfig?: ResolvedAgentConfig
  /** Rendering medium → formatting. Defaults to `'builder'`. See `buildKopilotPrompt`. */
  surface?: AgentSurface
  /** Who reads this turn → semantics. Defaults to `'member'`. See `buildKopilotPrompt`. */
  audience?: Audience
  /**
   * Present iff this run was kicked off by an AgentTrigger. Threads the
   * autonomous-run prompt section through `buildKopilotPrompt`. Chat runs
   * (master or user agent) leave this undefined.
   */
  triggerContext?: TriggerContext
  /**
   * The turn's resolved read enforcement (capability layer v2 §3.4). Filters
   * the org-wide catalogs hydrated into the system prompt — the prompt-side
   * twin of the client's `useViewableResources`. Undefined ⇒ no filtering, so
   * un-threaded callers render exactly today's prompt.
   *
   * Named apart from {@link CreateKopilotAgentOptions.capabilities}, which is
   * the human-readable capability *description* list.
   */
  recordAccess?: CapabilityView
  /**
   * The running agent's resolved retrieval scope (capability layer v2 §1.1).
   * Forwarded into `buildKopilotPromptSerialized` so the Knowledge Catalog
   * section can narrow to what this agent may actually search. Absent/null ⇒
   * unrestricted, org-wide knowledge — today's behavior.
   */
  knowledgeScope?: ResolvedKnowledgeScope | null
}

/**
 * Create the solo Kopilot agent.
 *
 * Owns the full turn: calls tools, loops on tool results, and ends the turn
 * by responding with prose plus any `auxx:*` reference fences (no separate
 * terminator tool — implicit termination on no-tool-call iterations).
 */
export function createKopilotAgent(
  options: CreateKopilotAgentOptions
): AgentDefinition<KopilotDomainState> {
  const {
    tools,
    capabilities = [],
    maxIterations = 15,
    toolsetPromptAdditions = '',
    agentConfig,
    surface,
    audience,
    triggerContext,
    recordAccess,
    knowledgeScope,
  } = options

  const agentTools: AgentToolDefinition[] = tools

  return {
    name: 'agent',

    async buildMessages(
      state: AgentState<KopilotDomainState>,
      deps: AgentDeps
    ): Promise<Message[]> {
      // Only fetch the chip-resolution catalogs when the run actually has
      // an agent persona to render — master Kopilot doesn't reference chips.
      const hasAgentPersona = Boolean(agentConfig && agentConfig.agentId !== null)
      const [resources, caller, integrations, toolCatalog, toolsetCatalog, kbCatalog] =
        await Promise.all([
          getCachedResources(deps.organizationId),
          hydrateCaller(deps.organizationId, deps.userId),
          getCachedIntegrationCatalog(deps.organizationId),
          hasAgentPersona ? getOrgToolCatalog(deps.organizationId) : Promise.resolve(undefined),
          hasAgentPersona ? getOrgToolsetCatalog(deps.organizationId) : Promise.resolve(undefined),
          // Knowledge is optional context — never let a catalog failure kill the turn.
          getCachedKbCatalog(deps.organizationId).catch((err) => {
            logger.warn('Failed to load KB catalog for Kopilot prompt', {
              organizationId: deps.organizationId,
              error: err instanceof Error ? err.message : String(err),
            })
            return []
          }),
        ])

      // Def-level read enforcement, prompt-side (capability layer v2 §3.4): the
      // catalog must not advertise defs the tools would deny — the twin of the
      // client's `useViewableResources`. No `recordAccess` ⇒ unfiltered, as today.
      //
      // The first filter is the curated AI-visible set, NOT the Records-nav flag
      // it replaced: `isVisible` means "show in the sidebar", and reusing it here
      // hid inboxes, tags and catalog items from the model while leaving them
      // fully queryable by hand-typed slug. See `entities/shared/ai-entity-visibility`.
      const entityCatalog = resources
        .filter(
          (r) =>
            isAiVisibleResource(r) &&
            (!recordAccess || recordAccess.canViewEntity(r.entityDefinitionId ?? r.id))
        )
        .map((r) => ({
          apiSlug: r.apiSlug,
          label: r.label,
          plural: r.plural,
          entityDefinitionId: r.entityDefinitionId ?? r.id,
        }))

      const instructionsReferences = hasAgentPersona
        ? buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
        : undefined

      // The Phase-4 turn preamble stashes the active procedure step here before
      // the engine drains; absent (or on a free-form turn) the section drops out.
      // `domainState` is treated as a Record for slice reads (as the context
      // store does) — the typed interface has no index signature.
      const procedureStep = (state.domainState as Record<string, unknown>)[PROCEDURE_STEP_KEY] as
        | ProcedureStepInput
        | undefined

      const systemPrompt = buildKopilotPromptSerialized({
        domainState: state.domainState,
        entityCatalog,
        kbCatalog,
        capabilities,
        tools: agentTools,
        currentUser: caller.currentUser,
        // The caller's own zone drives the `now` clock. Null (no member row, no
        // saved preference, autonomous run with no caller) renders UTC — see
        // `prompts/sections/now.ts`.
        timezone: caller.timezone,
        integrations,
        toolsetPromptAdditions,
        agentConfig,
        surface,
        audience,
        triggerContext,
        instructionsReferences,
        procedureStep,
        recordAccess,
        knowledgeScope,
      })

      // Full conversation for tool-loop continuity. Each persisted assistant
      // message is one *turn* with a `parts[]` array; expand back into
      // OpenAI/Anthropic wire format (one assistant + N tool messages per
      // turn) via `sessionMessagesToWire`.
      //
      // Final-prose assistant messages run through `transformAssistantContentForLLM`
      // so `auxx:*` reference fences become numbered text the model can index
      // by ordinal ("delete the second one"). Persisted content is unchanged —
      // this is a per-call view transform applied to the last assistant turn
      // that has no tool_call parts.
      // Drop ALL persisted system messages — the live system prompt is
      // prepended below. Approval-card system messages are pure UI markers
      // and aren't part of the LLM's view either.
      const filtered = state.messages.filter((m) => m.role !== 'system')
      const rawMessages = sessionMessagesToWire(filtered, {
        finalAssistantTextTransform: (text) => transformAssistantContentForLLM(text),
      })

      return [{ role: 'system', content: systemPrompt }, ...rawMessages]
    },

    tools: agentTools,

    async processResult(
      _content: string,
      _toolCalls: ToolCall[],
      state: AgentState<KopilotDomainState>,
      _deps: AgentDeps
    ): Promise<AgentState<KopilotDomainState>> {
      // The query loop owns message persistence and block rendering. processResult
      // is just an identity here — no per-turn transient state to maintain.
      return state
    },

    maxIterations,
  }
}

/**
 * What one read of the org `members` cache yields for the turn's caller.
 *
 * `timezone` is deliberately NOT folded into {@link CurrentUserInfo}: that shape
 * is what the caller-preamble section prints, and it is audience-gated — a chat
 * turn resolves the *agent's own* member row, so anything added there risks
 * being rendered into a customer-facing prompt. The zone feeds only the `now`
 * clock, which every audience sees.
 */
interface CallerHydration {
  currentUser: CurrentUserInfo | null
  /** IANA zone, or `null` ⇒ the `now` section renders UTC. */
  timezone: string | null
}

/** The value every failure path resolves to — no caller, no zone, UTC clock. */
const NO_CALLER: CallerHydration = { currentUser: null, timezone: null }

/**
 * Resolve the turn's caller from the org `members` cache (one read, no DB hit).
 *
 * Both the identity and the clock come from the same blob on purpose — the
 * `userProfile` USER cache also carries `preferredTimezone`, but sourcing it
 * there would add a second cache roundtrip to every turn for one string.
 *
 * **Staleness:** `members` is invalidated on membership events, not on
 * `user.updated`, so a zone changed in settings can lag by up to the key's TTL.
 * Documented on the `members` key in `cache/org-cache-keys.ts`; a wrong-by-a-day
 * zone still beats no zone, and the section coalesces anything missing to UTC.
 */
async function hydrateCaller(organizationId: string, userId: string): Promise<CallerHydration> {
  try {
    const [member] = await getCachedMembersByUserIds(organizationId, [userId])
    if (!member) {
      logger.debug('Current user not found in org members cache', { organizationId, userId })
      return NO_CALLER
    }
    return {
      currentUser: {
        userId,
        actorId: toActorId('user', userId),
        name: member.user?.name ?? null,
        email: member.user?.email ?? null,
        role: member.role,
      },
      // `undefined` is reachable on a pre-`v2` cached blob; both it and an empty
      // string mean "no preference", which the `now` section renders as UTC.
      timezone: member.user?.preferredTimezone?.trim() || null,
    }
  } catch (err) {
    logger.warn('Failed to hydrate current user for Kopilot prompt', {
      organizationId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    return NO_CALLER
  }
}
