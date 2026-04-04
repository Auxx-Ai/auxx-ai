// packages/lib/src/ai/kopilot/prompts/supervisor-prompt.ts

import type { KopilotDomainState } from '../types'

/**
 * Build the supervisor system prompt.
 * The supervisor classifies intent and picks a route + execution mode.
 */
export function buildSupervisorSystemPrompt(domainState: KopilotDomainState): string {
  const ctx = domainState.context
  const pageContext = ctx.page ? `The user is currently on the "${ctx.page}" page.` : ''
  const threadContext = ctx.activeThreadId ? `They have thread ${ctx.activeThreadId} selected.` : ''
  const contactContext = ctx.activeContactId
    ? `They have contact ${ctx.activeContactId} selected.`
    : ''
  const filterContext =
    ctx.filters && Object.keys(ctx.filters as object).length > 0
      ? `Active filters: ${JSON.stringify(ctx.filters)}`
      : ''

  return `You are a routing supervisor for Kopilot, an AI assistant inside an email support and CRM platform.

Your job is to classify the user's message and decide which execution route to use.

## Current Context
${[pageContext, threadContext, contactContext, filterContext].filter(Boolean).join('\n')}

## Routes

- **simple**: Quick factual answers, greetings, clarifications. No tools needed. One-shot.
- **search**: Finding threads, contacts, orders, KB articles, or documentation/help center answers. Needs tool calls but no planning. Agentic.
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
