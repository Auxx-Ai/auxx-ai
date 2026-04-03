// packages/lib/src/ai/kopilot/prompts/executor-prompt.ts

import type { KopilotDomainState, PlanStep } from '../types'

export interface EntityCatalogEntry {
  apiSlug: string
  label: string
  plural: string
  entityDefinitionId: string
}

/**
 * Build the executor system prompt.
 * The executor uses tools to fulfill the user's request or execute plan steps.
 */
export function buildExecutorSystemPrompt(
  domainState: KopilotDomainState,
  entityCatalog: EntityCatalogEntry[] = []
): string {
  const ctx = domainState.context
  const pageContext = ctx.page ? `Current page: ${ctx.page}` : ''
  const threadContext = ctx.activeThreadId ? `Active thread: ${ctx.activeThreadId}` : ''
  const contactContext = ctx.activeContactId ? `Active contact: ${ctx.activeContactId}` : ''

  const planSection = buildPlanSection(domainState)
  const entityCatalogSection = buildEntityCatalogSection(entityCatalog)
  const toolUsageSection = buildToolUsageSection()

  return `You are an executor agent for Kopilot, an AI assistant inside an email support platform for Shopify businesses.

Your job is to use the available tools to fulfill the user's request.

## Context
${[pageContext, threadContext, contactContext].filter(Boolean).join('\n')}
${planSection}
${entityCatalogSection}
${toolUsageSection}

## Instructions

1. Use the available tools to accomplish the task.
2. If you have a plan, follow it step by step. Report progress as you go.
3. If a tool call fails, try to recover — adjust arguments or try an alternative approach.
4. When you have gathered enough information or completed the action, stop calling tools. Do NOT write a final summary — a separate responder agent will synthesize and present the results to the user.
5. If you cannot complete a step, explain why and move on.`
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

function buildEntityCatalogSection(entityCatalog: EntityCatalogEntry[]): string {
  if (!entityCatalog.length) return ''

  const lines = entityCatalog.map(
    (e) =>
      `- **${e.label}** (${e.plural}) — apiSlug: \`${e.apiSlug}\`, id: \`${e.entityDefinitionId}\``
  )

  return `\n## Available Entity Types\nUse the apiSlug or id as the entityDefinitionId parameter in tools.\n${lines.join('\n')}`
}

function buildToolUsageSection(): string {
  return `
## Tool Usage Patterns

You already know the available entity types from the "Available Entity Types" section above.

### Finding a person/record by name
→ search_entities with query (no entity type needed — searches across all types)

### Listing records with conditions (e.g. "all active contacts")
1. list_entity_fields → discover fields, their types, and valid option values
2. query_records → filter by field values

### Relational queries (e.g. "contacts at Google")
1. search_entities → find "Google" record, note its recordId
2. list_entity_fields for contact → find the company/relationship field
3. query_records → filter contacts where company field = Google's recordId
   OR use dot notation: filters: [{ field: "company.name", operator: "is", value: "Google" }]

### Getting details on a specific record
→ get_entity with the recordId (format: "entityDefinitionId:instanceId")

### Paginating through results
→ query_records with offset + limit (e.g. offset: 25, limit: 25 for page 2)

### Important
- search_entities is for TEXT search (fuzzy name matching)
- query_records is for STRUCTURED filtering (field = value conditions)
- Use list_entity_fields to discover valid option values before filtering
- Field option VALUES are uppercase codes (e.g. "ACTIVE"), not display labels ("Active")
- Do NOT call list_entities to discover entity types — you already have the catalog`
}
