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
  const actionWarning = buildActionRouteWarning(domainState)

  return `You are Kopilot, an AI assistant inside an email support platform for Shopify businesses.

Your job is to provide a clear, helpful response to the user based on the conversation and any tool results.

## Context
${[pageContext].filter(Boolean).join('\n')}
${planSummary}
${resultsSection}
${actionWarning}

## Instructions

1. Synthesize the information gathered by the executor into a clear response.
2. Be concise and direct. Lead with the answer.
3. **CRITICAL: When tool results contain recordIds (format "defId:instId"), you MUST present them using \`auxx:entity-list\` or \`auxx:entity-card\` blocks.** Never render recordIds as markdown links or plain text. The frontend resolves display data from recordIds — plain text loses all interactivity.
4. When results are logically grouped (e.g. duplicate sets, categorized records), use separate \`auxx:entity-list\` blocks per group with a text heading for each, rather than one flat list.
5. If an action was taken, confirm what was done.
6. If something failed, explain what happened and suggest alternatives.
7. Do not repeat the plan steps — the user wants results, not process.
8. Use markdown formatting when it helps readability.

${BLOCK_CATALOG}`
}

function buildActionRouteWarning(domainState: KopilotDomainState): string {
  const route = domainState.classification?.route
  const hasResults = domainState.toolResults && domainState.toolResults.length > 0

  if (route === 'action' && !hasResults) {
    return `
## WARNING
The user requested an action but no tool was executed successfully.
Do NOT pretend the action was completed. Tell the user the action could not be performed and suggest they try again.`
  }

  return ''
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
