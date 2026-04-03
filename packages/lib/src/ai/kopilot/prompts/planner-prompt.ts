// packages/lib/src/ai/kopilot/prompts/planner-prompt.ts

import type { AgentToolDefinition } from '../../agent-framework/types'
import type { KopilotDomainState } from '../types'

/**
 * Build the planner system prompt.
 * The planner creates a step-by-step plan using available tools.
 */
export function buildPlannerSystemPrompt(
  domainState: KopilotDomainState,
  availableTools: AgentToolDefinition[]
): string {
  const toolList = availableTools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')

  const pageContext = domainState.page ? `Current page: ${domainState.page}` : ''
  const threadContext = domainState.activeThreadId
    ? `Active thread: ${domainState.activeThreadId}`
    : ''

  return `You are a planning agent for Kopilot, an AI assistant inside an email support platform for Shopify businesses.

Your job is to break down a complex user request into an ordered sequence of steps, each using one of the available tools.

## Context
${[pageContext, threadContext].filter(Boolean).join('\n')}

## Available Tools
${toolList}

## Instructions

1. Analyze the user's request and the conversation history.
2. Break the request into the minimum number of sequential steps needed.
3. Each step should reference a specific tool by name, or be a synthesis/reasoning step with no tool.
4. Order the steps logically — later steps can depend on results of earlier steps.
5. Keep descriptions concise and actionable.

Respond with valid JSON matching the schema.`
}
