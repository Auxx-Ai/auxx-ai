// packages/lib/src/ai/kopilot/domain-config.ts

import { createScopedLogger } from '@auxx/logger'
import type { ResolvedAgentConfig } from '../../agents'
import type {
  AgentDomainConfig,
  AgentState,
  AgentToolDefinition,
  AgentToolResult,
  PostProcessResult,
  TurnSnapshots,
} from '../agent-framework/types'
import { createKopilotAgent } from './agents/agent'
import { extractLinkSnapshots } from './blocks/extract-link-snapshots'
import { injectSnapshotsIntoFinal } from './blocks/inject-snapshots'
import { createEmptyTurnSnapshots, runSnapshotWalker } from './blocks/snapshot-walker'
import type { CapabilityRegistry } from './capabilities/types'
import { applyContextDefaults } from './context-refs'
import type { TriggerContext } from './prompts/trigger-context'
import type { KopilotDomainState, PlanState, PlanStepStatus, SessionRef } from './types'

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
    triggerContext,
  } = options

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
    triggerContext,
  })

  return {
    type: 'kopilot',
    defaultModel,
    defaultProvider,
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
      let next: AgentState = { ...state, turnSnapshots: snapshots }

      // Plan tools: mutate domainState.plan.
      if (toolName === 'plan_create') {
        const plan = (result.output as { plan?: PlanState } | null)?.plan
        if (plan) {
          next = {
            ...next,
            domainState: { ...(next.domainState as KopilotDomainState), plan },
          }
        }
        return next
      }
      if (toolName === 'plan_update_step') {
        const patch = (
          result.output as {
            _planPatch?: { stepId: string; status: PlanStepStatus; detail?: string }
          } | null
        )?._planPatch
        const ds = next.domainState as KopilotDomainState
        const current = ds.plan
        if (patch && current) {
          const idx = current.steps.findIndex((s) => s.id === patch.stepId)
          if (idx >= 0) {
            const steps = current.steps.map((s, i) =>
              i === idx
                ? {
                    ...s,
                    status: patch.status,
                    ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
                  }
                : s
            )
            next = {
              ...next,
              domainState: {
                ...ds,
                plan: { ...current, steps, updatedAt: Date.now() },
              },
            }
          }
          // Unknown stepId → leave plan unchanged; transformToolResult below
          // surfaces an explicit error to the LLM with the canonical plan.
        }
        return next
      }

      return next
    },
    transformToolResult(
      toolName: string,
      result: AgentToolResult,
      state: AgentState
    ): AgentToolResult | undefined {
      if (toolName === 'plan_create') {
        // Raw output already carries `{ plan }`; no rewrite needed.
        return undefined
      }
      if (toolName === 'plan_update_step') {
        const ds = state.domainState as KopilotDomainState
        const patch = (result.output as { _planPatch?: { stepId: string } } | null)?._planPatch
        if (!ds.plan) {
          return {
            success: false,
            output: { plan: null },
            error: 'no active plan; call plan_create first',
          }
        }
        if (patch && !ds.plan.steps.some((s) => s.id === patch.stepId)) {
          return {
            success: false,
            output: { plan: ds.plan },
            error: `no plan step with id "${patch.stepId}"; current plan attached`,
          }
        }
        return { success: true, output: { plan: ds.plan } }
      }
      return undefined
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
