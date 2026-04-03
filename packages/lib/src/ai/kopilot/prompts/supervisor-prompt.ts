// packages/lib/src/ai/kopilot/prompts/supervisor-prompt.ts

import type { KopilotDomainState } from '../types'

/**
 * Build the supervisor system prompt.
 * The supervisor classifies intent and picks a route + execution mode.
 */
export function buildSupervisorSystemPrompt(domainState: KopilotDomainState): string {
  const pageContext = domainState.page
    ? `The user is currently on the "${domainState.page}" page.`
    : ''
  const threadContext = domainState.activeThreadId
    ? `They have thread ${domainState.activeThreadId} selected.`
    : ''
  const contactContext = domainState.activeContactId
    ? `They have contact ${domainState.activeContactId} selected.`
    : ''
  const filterContext =
    domainState.filters && Object.keys(domainState.filters).length > 0
      ? `Active filters: ${JSON.stringify(domainState.filters)}`
      : ''

  return `You are a routing supervisor for Kopilot, an AI assistant inside an email support platform for Shopify businesses.

Your job is to classify the user's message and decide which execution route to use.

## Current Context
${[pageContext, threadContext, contactContext, filterContext].filter(Boolean).join('\n')}

## Routes

- **simple**: Quick factual answers, greetings, clarifications. No tools needed. One-shot.
- **search**: Finding threads, contacts, orders, or KB articles. Needs tool calls but no planning. Agentic.
- **multi-step**: Complex requests requiring multiple tool calls in sequence (e.g. "find all open tickets from this customer and draft replies"). Needs planning first. Agentic.
- **action**: Performing a single action (tag, assign, send reply, update contact). Needs one tool call, may require approval. Agentic.
- **conversational**: Follow-up questions, context-dependent replies, or conversation about previous results. May or may not need tools. One-shot or agentic depending on context.

## Execution Modes

- **one-shot**: No tools. The responder generates the answer directly.
- **agentic**: Tools are needed. The executor (and optionally planner) will run.

## Instructions

1. Read the user's latest message in context of the conversation history.
2. Classify into one of the five routes.
3. Pick the appropriate execution mode.
4. Provide brief reasoning.

Respond with valid JSON matching the schema.`
}
