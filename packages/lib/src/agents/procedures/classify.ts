// packages/lib/src/agents/procedures/classify.ts

import type { Database } from '@auxx/database'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import type { TriggerExample } from './types'

/**
 * The selection classifier — ONE constrained, multi-way LLM call that, given the
 * conversation plus the survivors' `{ id, whenToUse, triggerExamples }`, returns the
 * single best procedure id or `null`. **O(1) in #procedures** (one call, not one per
 * candidate). The model cannot invent an id: the structured-output schema constrains
 * `procedureId` to the candidate id set ∪ `null`, and a belt-and-suspenders filter
 * rejects anything outside it. Mirrors `ai/kopilot/session-title.ts`'s minimal-deps
 * `LLMOrchestrator` invocation, with `structuredOutput` enabled.
 */

export interface ClassifierCandidate {
  id: string
  whenToUse: string
  triggerExamples: TriggerExample[]
}

export interface ClassifyDeps {
  db: Database
  organizationId: string
  userId: string
  /**
   * The cheap UTILITY tier, resolved by the caller via `resolveUtilityModel`
   * (`ai/providers/utility-model.ts`): a same-provider sibling of the agent's
   * primary model for this low-stakes routing. Does NOT violate
   * [[feedback_kopilot_byo_model]] — the customer-facing reply still runs on the
   * primary; only internal classification drops a tier.
   */
  model: string
  provider: string
}

export type ConversationMessage = { role: 'user' | 'assistant'; content: string }

/**
 * Build the few-shot system prompt: a compact catalog of each candidate's `id`,
 * `whenToUse` prose, and its `triggerExamples` split into "Use when" / "Avoid when"
 * lists. The `avoid` shots are the primary lever against over-triggering on an
 * adjacent intent.
 */
function buildSystemPrompt(candidates: ClassifierCandidate[]): string {
  const catalog = candidates
    .map((c) => {
      const use = c.triggerExamples
        .filter((e) => e.behavior === 'use')
        .map((e) => `    - ${e.text}`)
      const avoid = c.triggerExamples
        .filter((e) => e.behavior === 'avoid')
        .map((e) => `    - ${e.text}`)
      const lines = [`- id: ${c.id}`, `  When to use: ${c.whenToUse}`]
      if (use.length > 0) lines.push('  Use when:', ...use)
      if (avoid.length > 0) lines.push('  Avoid when:', ...avoid)
      return lines.join('\n')
    })
    .join('\n')

  return [
    'You route a customer conversation to at most one support procedure.',
    'Below is the catalog of available procedures. Each has a "When to use" description',
    'and may list example messages it should be used for ("Use when") or explicitly',
    'NOT used for ("Avoid when").',
    '',
    'Procedures:',
    catalog,
    '',
    'Pick the single best-matching procedure id for the latest customer intent, or',
    'null if none clearly applies. Prefer null over a weak match — a wrong match is',
    'worse than free-form. Respond only via the structured output.',
  ].join('\n')
}

function renderConversation(conversation: ConversationMessage[]): string {
  return conversation
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`)
    .join('\n')
}

/** ONE constrained multi-way call. Returns the chosen procedure id or null. */
export async function classifyProcedure(
  conversation: ConversationMessage[],
  candidates: ClassifierCandidate[],
  deps: ClassifyDeps
): Promise<{ id: string | null }> {
  if (candidates.length === 0) return { id: null } // never reached via select.ts; defensive

  const orchestrator = new LLMOrchestrator(undefined, deps.db)
  const response = await orchestrator.invoke({
    model: deps.model,
    provider: deps.provider,
    organizationId: deps.organizationId,
    userId: deps.userId,
    messages: [
      { role: 'system', content: buildSystemPrompt(candidates) },
      { role: 'user', content: renderConversation(conversation) },
    ],
    tools: [],
    structuredOutput: {
      enabled: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['procedureId'],
        properties: {
          procedureId: {
            type: ['string', 'null'],
            enum: [...candidates.map((c) => c.id), null],
          },
        },
      },
    },
    parameters: { max_tokens: 60 },
    context: { source: 'procedure-classify' },
  })

  const picked = response.structured_output?.procedureId ?? null
  // Belt-and-suspenders: reject any id not in the candidate set.
  return { id: candidates.some((c) => c.id === picked) ? picked : null }
}
