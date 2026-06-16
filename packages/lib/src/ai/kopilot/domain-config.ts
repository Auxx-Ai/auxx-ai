// packages/lib/src/ai/kopilot/domain-config.ts

import { createScopedLogger } from '@auxx/logger'
import type { ResolvedAgentConfig } from '../../agents'
import type { AgentSurface } from '../../agents/client'
import { PROCEDURE_SLICE_KEY } from '../../agents/procedures/persist'
import { CONTEXT_SLICE_KEY, readContextSlice } from '../agent-framework/context'
import type {
  AgentDomainConfig,
  AgentState,
  AgentToolDefinition,
  AgentToolResult,
  PostProcessResult,
  TurnSnapshots,
} from '../agent-framework/types'
import { resolveUtilityModel } from '../providers/utility-model'
import { createKopilotAgent } from './agents/agent'
import { extractLinkSnapshots } from './blocks/extract-link-snapshots'
import { injectSnapshotsIntoFinal } from './blocks/inject-snapshots'
import { createEmptyTurnSnapshots, runSnapshotWalker } from './blocks/snapshot-walker'
import type { CapabilityRegistry } from './capabilities/types'
import { applyContextDefaults } from './context-refs'
import type { TriggerContext } from './prompts/trigger-context'
import type { KopilotDomainState, SessionRef } from './types'

const logger = createScopedLogger('kopilot-domain-config')

export interface KopilotDomainConfigOptions {
  /**
   * Tools available to the agent. When provided, REPLACES the
   * `capabilityRegistry.getTools(page)` read — callers that want runtime
   * filtering (per-agent toolsets, invoker-scope, approval-mode) resolve
   * tools themselves, run them through `filterToolsByToolsets` (and future
   * predicates), and hand the result here. When omitted, falls back to the
   * registry read so master Kopilot's master-session path is unchanged.
   */
  tools?: AgentToolDefinition[]
  /** Page capability registry for page-scoped tool resolution */
  capabilityRegistry?: CapabilityRegistry
  /** Current page (used with capabilityRegistry to resolve tools) */
  page?: string
  /** Default LLM model */
  defaultModel?: string
  /** Default LLM provider */
  defaultProvider?: string
  /** Max tool-use iterations before forcing a stop (default: 30) */
  maxIterations?: number
  /**
   * Per-session resolved agent configuration. Threaded into `createKopilotAgent`
   * so the persona slot in the system prompt branches on master vs
   * user-authored agent. Tool filtering happens at the call site before this
   * config is built — see `filterToolsByToolsets` in `@auxx/lib/agents`.
   */
  agentConfig?: ResolvedAgentConfig
  /**
   * The rendering medium this turn outputs to → drives prompt formatting
   * (chat = plain text, builder = `auxx:*` rich blocks). Defaults to
   * `'builder'`. Chat leaves `triggerContext` undefined but sets `surface: 'chat'`.
   */
  surface?: AgentSurface
  /**
   * Who reads this turn's output → drives prompt semantics (customer-facing
   * opacity vs member debugging). Defaults to `'member'`.
   */
  audience?: 'member' | 'customer'
  /**
   * Present iff this run was kicked off by an AgentTrigger. Threaded into
   * `createKopilotAgent` so the autonomous-run section renders in the system
   * prompt. Chat runs leave this undefined.
   */
  triggerContext?: TriggerContext
}

/**
 * Create a Kopilot domain config for the agent framework.
 *
 * The v2 Kopilot is a solo-agent domain: one agent owns the entire turn. There is
 * no supervisor, planner, executor, or responder. The agent ends the turn by
 * stopping tool calls — its last response (prose plus optional `auxx:*` fences)
 * is committed as the final assistant message.
 */
export function createKopilotDomainConfig(
  options: KopilotDomainConfigOptions = {}
): AgentDomainConfig<KopilotDomainState> {
  const {
    tools,
    capabilityRegistry,
    page,
    defaultModel = 'gpt-5.4-nano',
    defaultProvider = 'openai',
    maxIterations = 30,
    agentConfig,
    surface,
    audience,
    triggerContext,
  } = options

  // Cheap same-provider sibling for low-stakes internal LLM tasks (procedure
  // selection/routing, goal-met checks). Returns the primary unchanged when it's
  // already tier-1. See `ai/providers/utility-model.ts`.
  const utility = resolveUtilityModel({ provider: defaultProvider, model: defaultModel })

  // Resolve tools: if the caller passed `tools`, use them verbatim (pre-filtered
  // path). Otherwise fall back to the registry's page-scoped tools so the
  // master-session default is byte-equivalent to today.
  const resolvedTools: AgentToolDefinition[] = tools
    ? [...new Map(tools.map((t) => [t.name, t])).values()]
    : capabilityRegistry && page
      ? capabilityRegistry.getTools(page)
      : []

  const excludedGlobalTools =
    !tools && capabilityRegistry && page ? capabilityRegistry.getExcludedGlobalToolNames(page) : []

  logger.info('Resolved tools', {
    page,
    source: tools ? 'caller' : 'registry',
    resolvedToolCount: resolvedTools.length,
    toolNames: resolvedTools.map((t) => t.name),
    excludedGlobalToolCount: excludedGlobalTools.length,
    excludedGlobalTools,
  })

  const resolvedToolNames = new Set(resolvedTools.map((t) => t.name))
  const capabilities =
    capabilityRegistry?.getCapabilitiesSummary({ toolNames: resolvedToolNames }) ?? []
  const toolsetPromptAdditions =
    capabilityRegistry && page
      ? (capabilityRegistry.getSystemPromptAddition(page, { toolNames: resolvedToolNames }) ?? '')
      : ''
  const agent = createKopilotAgent({
    tools: resolvedTools,
    capabilities,
    maxIterations,
    toolsetPromptAdditions,
    agentConfig,
    surface,
    audience,
    triggerContext,
  })

  return {
    type: 'kopilot',
    defaultModel,
    defaultProvider,
    utilityModel: utility.model,
    utilityProvider: utility.provider,
    // supervisorAgent intentionally omitted — solo-agent domain
    agents: {
      agent,
    },
    routes: [
      {
        name: 'default',
        agents: ['agent'],
      },
    ],
    createInitialState(context: Record<string, unknown>): KopilotDomainState {
      return { context, capabilities }
    },
    applyContext(state: KopilotDomainState, context: Record<string, unknown>): KopilotDomainState {
      return { ...state, context }
    },
    transformToolInput(
      _toolName: string,
      args: Record<string, unknown>,
      state
    ): Record<string, unknown> {
      const ctx = (state.domainState as KopilotDomainState | undefined)?.context
      if (!ctx) return args
      return applyContextDefaults(args, ctx)
    },
    onToolResult(toolName: string, result: AgentToolResult, state: AgentState): AgentState {
      const snapshots: TurnSnapshots = state.turnSnapshots ?? createEmptyTurnSnapshots()
      // Walk every tool output for entity / thread / task ids. Probes are
      // shape-disjoint, so running them all on every result is safe + cheap.
      runSnapshotWalker(result.output, snapshots)
      // Doc snapshot mining for the two knowledge tools — they emit a
      // `docs: [{ slug, title, description?, url? }]` field on success.
      if (toolName === 'search_docs' || toolName === 'search_knowledge') {
        mineDocSnapshots(result.output, snapshots)
      }
      // Plan state now lives in `var:plan` (managed by the plan tools via
      // ctx.context) — no bespoke domainState.plan mutation here.
      return { ...state, turnSnapshots: snapshots }
    },
    summarizeContext(context: Record<string, unknown> | undefined) {
      if (!context) return undefined
      const page = (context as { page?: unknown }).page
      const refs = (context as { references?: unknown }).references
      const references = Array.isArray(refs)
        ? (refs as SessionRef[]).map((r) => ({
            kind: r?.kind,
            id: r?.id,
            origin: r?.origin,
            label: r?.label ?? null,
          }))
        : undefined
      return {
        ...(typeof page === 'string' ? { page } : {}),
        ...(references ? { references } : {}),
      }
    },
    postProcessFinalContent(content: string, state: AgentState): PostProcessResult {
      const snapshots = state.turnSnapshots ?? createEmptyTurnSnapshots()
      const next = injectSnapshotsIntoFinal(content, snapshots)
      const linkSnapshots = extractLinkSnapshots(next, snapshots)
      return Object.keys(linkSnapshots).length > 0
        ? { content: next, linkSnapshots }
        : { content: next }
    },
    async onTurnEnd(
      _state: AgentState,
      outcome: 'completed' | 'error',
      turnId?: string
    ): Promise<void> {
      // Fan the engine's turn-end out to every capability that declares a
      // lifecycle — capability-scoped cleanup (e.g. the KB snapshot/lock
      // transaction) lives with the capability, not here. The domain config
      // stays capability-agnostic: no per-tool sniffing, no KB imports.
      if (!turnId) return
      for (const lifecycle of capabilityRegistry?.getLifecycles() ?? []) {
        if (!lifecycle.onTurnEnd) continue
        try {
          await lifecycle.onTurnEnd(outcome, { turnId })
        } catch (err) {
          logger.error('Capability onTurnEnd lifecycle failed', {
            outcome,
            turnId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    },
    resetTurnDomainState(domainState: Record<string, unknown>): Record<string, unknown> {
      // Drop the turn-scoped context capture (tool:*/call:*) on a new user turn
      // while preserving `var:*` scratch (incl. var:plan, promoted captures).
      // The procedure stack is cross-turn CONTROL state — exempt it from the
      // reset (the next customer turn resumes from it), exactly as `vars` is
      // preserved. Returning `domainState` unchanged already preserves it; only
      // the rebuild branch below (which spreads into a fresh object, dropping
      // un-listed keys) must re-add `procedure` explicitly or the stack is wiped
      // each turn (plans/chat/v9/phase-4-wiring.md §2.1).
      const slice = readContextSlice(domainState)
      if (!slice?.turn) return domainState
      const procedure = domainState[PROCEDURE_SLICE_KEY]
      return {
        ...domainState,
        [CONTEXT_SLICE_KEY]: { vars: slice.vars },
        ...(procedure !== undefined ? { [PROCEDURE_SLICE_KEY]: procedure } : {}),
      }
    },
  }
}

/**
 * Mine `output.docs` from a knowledge tool result into `snapshots.docs`.
 * Returns `true` if any snapshots were added.
 */
function mineDocSnapshots(output: unknown, snapshots: TurnSnapshots): boolean {
  if (!output || typeof output !== 'object') return false
  const docs = (output as { docs?: unknown }).docs
  if (!Array.isArray(docs)) return false
  let added = false
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue
    const slug = (d as { slug?: unknown }).slug
    const title = (d as { title?: unknown }).title
    if (typeof slug !== 'string' || typeof title !== 'string') continue
    const url = (d as { url?: unknown }).url
    const description = (d as { description?: unknown }).description
    snapshots.docs[slug] = {
      slug,
      title,
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof url === 'string' ? { url } : {}),
    }
    added = true
  }
  return added
}
