// packages/lib/src/ai/kopilot/prompts/executor-prompt.ts

import type { KopilotDomainState, PlanStep } from '../types'

/**
 * Build the executor system prompt.
 * The executor uses tools to fulfill the user's request or execute plan steps.
 */
export function buildExecutorSystemPrompt(domainState: KopilotDomainState): string {
  const ctx = domainState.context
  const pageContext = ctx.page ? `Current page: ${ctx.page}` : ''
  const threadContext = ctx.activeThreadId ? `Active thread: ${ctx.activeThreadId}` : ''
  const contactContext = ctx.activeContactId ? `Active contact: ${ctx.activeContactId}` : ''

  const planSection = buildPlanSection(domainState)

  return `You are an executor agent for Kopilot, an AI assistant inside an email support platform for Shopify businesses.

Your job is to use the available tools to fulfill the user's request.

## Context
${[pageContext, threadContext, contactContext].filter(Boolean).join('\n')}
${planSection}

## Instructions

1. Use the available tools to accomplish the task.
2. If you have a plan, follow it step by step. Report progress as you go.
3. If a tool call fails, try to recover — adjust arguments or try an alternative approach.
4. When you have gathered enough information or completed the action, stop calling tools and provide a summary of what you did and found.
5. Be concise. Focus on results, not process.
6. If you cannot complete a step, explain why and move on.`
}

function buildPlanSection(domainState: KopilotDomainState): string {
  if (!domainState.plan || domainState.plan.length === 0) return ''

  const stepLines = domainState.plan.map((step: PlanStep, i: number) => {
    const status = step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : '○'
    const current = i === domainState.currentPlanStepIndex ? ' ← current' : ''
    const toolHint = step.tool ? ` (tool: ${step.tool})` : ''
    return `${status} ${step.id}. ${step.description}${toolHint}${current}`
  })

  return `\n## Execution Plan\n${stepLines.join('\n')}`
}
