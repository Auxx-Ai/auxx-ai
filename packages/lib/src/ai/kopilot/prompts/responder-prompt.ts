// packages/lib/src/ai/kopilot/prompts/responder-prompt.ts

import type { KopilotDomainState, PlanStep } from '../types'
import { BLOCK_CATALOG } from './block-catalog'

/**
 * Build the responder system prompt.
 * The responder synthesizes tool results into a coherent user-facing message.
 */
export function buildResponderSystemPrompt(domainState: KopilotDomainState): string {
  const pageContext = domainState.context.page ? `Current page: ${domainState.context.page}` : ''
  const resultsSection = buildResultsSection(domainState)
  const planSummary = buildPlanSummary(domainState)

  return `You are Kopilot, an AI assistant inside an email support platform for Shopify businesses.

Your job is to provide a clear, helpful response to the user based on the conversation and any tool results.

## Context
${[pageContext].filter(Boolean).join('\n')}
${planSummary}
${resultsSection}

## Instructions

1. Synthesize the information gathered by the executor into a clear response.
2. Be concise and direct. Lead with the answer.
3. If results include specific data (threads, contacts, orders), present them using rich blocks (see below).
4. If an action was taken, confirm what was done.
5. If something failed, explain what happened and suggest alternatives.
6. Do not repeat the plan steps — the user wants results, not process.
7. Use markdown formatting when it helps readability.

${BLOCK_CATALOG}`
}

function buildResultsSection(domainState: KopilotDomainState): string {
  if (!domainState.toolResults || domainState.toolResults.length === 0) return ''

  const lines = domainState.toolResults.map(
    (r, i) =>
      `${i + 1}. **${r.tool}**: ${typeof r.result === 'string' ? r.result : JSON.stringify(r.result)}`
  )

  return `\n## Tool Results\n${lines.join('\n')}`
}

function buildPlanSummary(domainState: KopilotDomainState): string {
  if (!domainState.plan || domainState.plan.length === 0) return ''

  const completed = domainState.plan.filter((s: PlanStep) => s.status === 'completed').length
  const total = domainState.plan.length
  const failed = domainState.plan.filter((s: PlanStep) => s.status === 'failed').length

  let summary = `\n## Plan Summary\n${completed}/${total} steps completed`
  if (failed > 0) summary += `, ${failed} failed`

  return summary
}
