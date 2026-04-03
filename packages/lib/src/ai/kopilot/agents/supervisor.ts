// packages/lib/src/ai/kopilot/agents/supervisor.ts

import { createScopedLogger } from '@auxx/logger'
import type { AgentDefinition, AgentDeps, AgentState } from '../../agent-framework/types'
import type { Message } from '../../clients/base/types'
import { buildSupervisorSystemPrompt } from '../prompts/supervisor-prompt'
import type { KopilotDomainState, SupervisorClassification } from '../types'

const logger = createScopedLogger('kopilot-supervisor')

const SUPERVISOR_RESPONSE_SCHEMA = {
  name: 'supervisor_classification',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      route: {
        type: 'string',
        enum: ['simple', 'search', 'multi-step', 'action', 'conversational'],
      },
      reasoning: { type: 'string' },
      executionMode: {
        type: 'string',
        enum: ['one-shot', 'agentic'],
      },
    },
    required: ['route', 'reasoning', 'executionMode'],
    additionalProperties: false,
  },
}

export function createSupervisorAgent(): AgentDefinition<KopilotDomainState> {
  return {
    name: 'supervisor',

    buildMessages(state: AgentState<KopilotDomainState>, _deps: AgentDeps): Message[] {
      const systemPrompt = buildSupervisorSystemPrompt(state.domainState)
      const conversationMessages: Message[] = state.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-6) // Last few turns for context
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      return [{ role: 'system', content: systemPrompt }, ...conversationMessages]
    },

    tools: [], // Supervisor is one-shot, no tools

    async processResult(
      content: string,
      _toolCalls,
      state: AgentState<KopilotDomainState>,
      _deps: AgentDeps
    ): Promise<AgentState<KopilotDomainState>> {
      let classification: SupervisorClassification
      try {
        if (!content || content.trim().length === 0) {
          throw new Error('Empty supervisor response from LLM')
        }
        // Strip markdown code fences if present (e.g. ```json ... ```)
        const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
        classification = JSON.parse(cleaned)
        if (!classification.route || !classification.executionMode) {
          throw new Error(
            `Missing required fields: route=${classification.route}, executionMode=${classification.executionMode}`
          )
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.warn('Failed to parse supervisor output, defaulting to simple route', {
          error: errorMessage,
          rawContent: content,
          rawContentLength: content?.length ?? 0,
        })
        // Fallback if structured output fails
        classification = {
          route: 'simple',
          reasoning: `Failed to parse supervisor output: ${errorMessage}`,
          executionMode: 'one-shot',
        }
      }

      logger.info('Classification', {
        route: classification.route,
        mode: classification.executionMode,
        reasoning: classification.reasoning,
      })

      // Map route name to the state's currentRoute
      const routeMap: Record<string, string> = {
        simple: 'simple',
        search: 'search',
        'multi-step': 'multi-step',
        action: 'action',
        conversational: 'conversational',
      }

      return {
        ...state,
        currentRoute: routeMap[classification.route] ?? 'simple',
        domainState: {
          ...state.domainState,
          classification,
        },
      }
    },

    parameters: { temperature: 0 },
    responseFormat: { type: 'json_schema', jsonSchema: SUPERVISOR_RESPONSE_SCHEMA },
  }
}
