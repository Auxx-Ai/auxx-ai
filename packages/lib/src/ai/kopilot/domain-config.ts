// packages/lib/src/ai/kopilot/domain-config.ts

import type { AgentDomainConfig, AgentToolDefinition } from '../agent-framework/types'
import { createExecutorAgent } from './agents/executor'
import { createPlannerAgent } from './agents/planner'
import { createResponderAgent } from './agents/responder'
import { createSupervisorAgent } from './agents/supervisor'
import type { CapabilityRegistry } from './capabilities/types'
import type { KopilotDomainState } from './types'

export interface KopilotDomainConfigOptions {
  /** Tools available to the executor and planner (manual injection) */
  tools?: AgentToolDefinition[]
  /** Page capability registry for page-based tool resolution */
  capabilityRegistry?: CapabilityRegistry
  /** Current page (used with capabilityRegistry to resolve tools) */
  page?: string
  /** Default LLM model (default: 'gpt-4o') */
  defaultModel?: string
  /** Default LLM provider (default: 'openai') */
  defaultProvider?: string
}

/**
 * Create a Kopilot domain config for the agent framework.
 *
 * This wires up the four Kopilot agents (supervisor, planner, executor, responder)
 * and defines the five routes with their agent sequences.
 *
 * Tools are resolved from:
 * 1. capabilityRegistry + page (if both provided)
 * 2. Manually passed tools
 * Both are merged — duplicates by name are deduplicated (registry wins).
 */
export function createKopilotDomainConfig(
  options: KopilotDomainConfigOptions = {}
): AgentDomainConfig<KopilotDomainState> {
  const {
    tools = [],
    capabilityRegistry,
    page,
    defaultModel = 'gpt-4o',
    defaultProvider = 'openai',
  } = options

  // Resolve tools: registry + manual, deduplicated
  const registryTools = capabilityRegistry && page ? capabilityRegistry.getTools(page) : []
  const toolMap = new Map<string, AgentToolDefinition>()
  for (const tool of registryTools) toolMap.set(tool.name, tool)
  for (const tool of tools) {
    if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool)
  }
  const resolvedTools = [...toolMap.values()]

  const supervisor = createSupervisorAgent()
  const planner = createPlannerAgent(resolvedTools)
  const executor = createExecutorAgent(resolvedTools)
  const responder = createResponderAgent()

  return {
    type: 'kopilot',
    supervisorAgent: 'supervisor',
    defaultModel,
    defaultProvider,

    agents: {
      supervisor,
      planner,
      executor,
      responder,
    },

    routes: [
      {
        name: 'simple',
        agents: ['supervisor', 'responder'],
      },
      {
        name: 'search',
        agents: ['supervisor', 'executor', 'responder'],
      },
      {
        name: 'multi-step',
        agents: ['supervisor', 'planner', 'executor', 'responder'],
      },
      {
        name: 'action',
        agents: ['supervisor', 'executor', 'responder'],
      },
      {
        name: 'conversational',
        agents: ['supervisor', 'responder'],
      },
    ],

    createInitialState(context: Record<string, unknown>): KopilotDomainState {
      return { context }
    },

    applyContext(state: KopilotDomainState, context: Record<string, unknown>): KopilotDomainState {
      return { ...state, context }
    },
  }
}
