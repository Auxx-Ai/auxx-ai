// packages/lib/src/ai/kopilot/prompts/responder-prompt.ts

import type { KopilotDomainState, PlanStep } from '../types'
import { BLOCK_CATALOG } from './block-catalog'
import { buildKopilotInstructions } from './instructions'

/**
 * Build the responder system prompt.
 * The responder synthesizes tool results into a coherent user-facing message.
 */
export function buildResponderSystemPrompt(domainState: KopilotDomainState): string {
  const pageContext = domainState.context.page ? `Current page: ${domainState.context.page}` : ''
  const resultsSection = buildResultsSection(domainState)
  const planSummary = buildPlanSummary(domainState)
  const actionWarning = buildActionRouteWarning(domainState)

  return `You are Kopilot, an AI assistant inside an email support and CRM platform.

Your job is to provide a clear, helpful response to the user based on the conversation and any tool results.

## Context
${[pageContext].filter(Boolean).join('\n')}
${planSummary}
${resultsSection}
${actionWarning}

${buildKopilotInstructions(domainState.capabilities)}

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
