// packages/lib/src/ai/kopilot/domain-config.ts

import { createScopedLogger } from '@auxx/logger'
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
import {
  buildFallbackFence,
  countReferenceBlockFences,
  injectSnapshotsIntoFinal,
} from './blocks/inject-snapshots'
import { createEmptyTurnSnapshots, runSnapshotWalker } from './blocks/snapshot-walker'
import type { CapabilityRegistry } from './capabilities/types'
import type { KopilotDomainState } from './types'

const logger = createScopedLogger('kopilot-domain-config')

export interface KopilotDomainConfigOptions {
  /** Tools available to the agent (manual injection; merged with registry tools) */
  tools?: AgentToolDefinition[]
  /** Page capability registry for page-scoped tool resolution */
  capabilityRegistry?: CapabilityRegistry
  /** Current page (used with capabilityRegistry to resolve tools) */
  page?: string
  /** Default LLM model */
  defaultModel?: string
  /** Default LLM provider */
  defaultProvider?: string
  /** Max tool-use iterations before forcing a stop (default: 15) */
  maxIterations?: number
}

/**
 * Create a Kopilot domain config for the agent framework.
 *
 * The v2 Kopilot is a solo-agent domain: one agent owns the entire turn. There is
 * no supervisor, planner, executor, or responder. Tools emit rich UI blocks
 * directly; the agent ends the turn by calling `submit_final_answer`.
 */
export function createKopilotDomainConfig(
  options: KopilotDomainConfigOptions = {}
): AgentDomainConfig<KopilotDomainState> {
  const {
    tools = [],
    capabilityRegistry,
    page,
    defaultModel = 'gpt-5.4-nano',
    defaultProvider = 'openai',
    maxIterations = 15,
  } = options

  // Resolve tools: registry (page-scoped) + manual, deduplicated by name
  const registryTools = capabilityRegistry && page ? capabilityRegistry.getTools(page) : []
  const toolMap = new Map<string, AgentToolDefinition>()
  for (const tool of registryTools) toolMap.set(tool.name, tool)
  for (const tool of tools) {
    if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool)
  }
  const resolvedTools = [...toolMap.values()]

  logger.info('Resolved tools', {
    page,
    registryToolCount: registryTools.length,
    manualToolCount: tools.length,
    resolvedToolCount: resolvedTools.length,
    toolNames: resolvedTools.map((t) => t.name),
  })

  const capabilities = capabilityRegistry?.getCapabilitiesSummary() ?? []
  const agent = createKopilotAgent({ tools: resolvedTools, capabilities, maxIterations })

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
    onToolResult(toolName: string, result: AgentToolResult, state: AgentState): AgentState {
      const tool = resolvedTools.find((t) => t.name === toolName)
      const snapshots: TurnSnapshots = state.turnSnapshots ?? createEmptyTurnSnapshots()
      let mutated = false
      if (tool?.outputBlock) {
        runSnapshotWalker(tool.outputBlock, result.output, snapshots)
        mutated = true
      }
      // Doc snapshot mining for the two knowledge tools — they emit a
      // `docs: [{ slug, title, description?, url? }]` field on success.
      if (toolName === 'search_docs' || toolName === 'search_knowledge') {
        if (mineDocSnapshots(result.output, snapshots)) mutated = true
      }
      return mutated ? { ...state, turnSnapshots: snapshots } : state
    },
    postProcessFinalContent(content: string, state: AgentState): PostProcessResult {
      const snapshots = state.turnSnapshots ?? createEmptyTurnSnapshots()
      // Find the last read-tool in the turn — drives the fallback block kind
      let lastTool: AgentToolDefinition | undefined
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i]
        if (msg?.role !== 'tool' || !msg.metadata || !('agent' in msg.metadata)) continue
        const toolCallId = msg.toolCallId
        let lastToolName: string | undefined
        for (let j = i - 1; j >= 0; j--) {
          const maybeAssistant = state.messages[j]
          if (maybeAssistant?.role !== 'assistant' || !maybeAssistant.toolCalls) continue
          const tc = maybeAssistant.toolCalls.find((c) => c.id === toolCallId)
          if (tc) {
            lastToolName = tc.function.name
            break
          }
        }
        if (lastToolName && lastToolName !== 'submit_final_answer') {
          lastTool = resolvedTools.find((t) => t.name === lastToolName)
          break
        }
      }

      let next = injectSnapshotsIntoFinal(content, snapshots)
      // If the LLM forgot to embed any reference block but we captured ids, auto-emit one
      if (countReferenceBlockFences(next) === 0) {
        const fence = buildFallbackFence(snapshots, lastTool)
        if (fence) next = `${next.trimEnd()}\n\n${fence}`
      }
      const linkSnapshots = extractLinkSnapshots(next, snapshots)
      return Object.keys(linkSnapshots).length > 0
        ? { content: next, linkSnapshots }
        : { content: next }
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
