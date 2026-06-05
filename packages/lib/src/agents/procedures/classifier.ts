// packages/lib/src/agents/procedures/classifier.ts

import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import { docToText } from '../../tiptap'
import type { ClassifyDeps, ConversationMessage } from './classify'
import type { ProcedureStep } from './types'

/**
 * The cheap procedure classifiers — small structured-output calls that mirror the
 * selection classifier (`classify.ts`) / `session-title.ts`. Three jobs, each a
 * single Haiku-class call:
 *
 *  - {@link goalMetCheck} — the advance-check (#11): verify the ONE irreversible
 *    signal before honoring it (`advance` moves the cursor past a step forever).
 *  - {@link backstopClassify} — the silent-reply backstop (#2): when the model
 *    replied with no control tool, decide whether it stayed on-procedure.
 *  - {@link classifyTextBranch} — pick a `text`-mode condition arm (the one
 *    condition path that costs a model call).
 *
 * All three reuse {@link ClassifyDeps} (db + org/user + the caller-resolved
 * model/provider). Instrument every call from day one (STACK #11) — the wrong-await
 * / missed-digress / compliance rates must be measured, not guessed.
 *
 * See plans/chat/v9/phase-3-stepper-and-stack.md §7.
 */

type ActiveStep = Extract<ProcedureStep, { kind: 'instruction' }>

const BOOL_SCHEMA = (key: string) => ({
  type: 'object' as const,
  additionalProperties: false,
  required: [key],
  properties: { [key]: { type: 'boolean' } },
})

function renderConversation(conversation: ConversationMessage[]): string {
  return conversation
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`)
    .join('\n')
}

/**
 * Advance-check — did the assistant's reply actually MEET the active step's goal?
 * Strict: only `true` when the step's required outcome is unambiguously achieved.
 * A `false` keeps the cursor on the step (the caller degrades `advance` → `await`).
 */
export async function goalMetCheck(
  reply: string,
  activeStep: ActiveStep,
  deps: ClassifyDeps
): Promise<boolean> {
  const orchestrator = new LLMOrchestrator(undefined, deps.db)
  const response = await orchestrator.invoke({
    model: deps.model,
    provider: deps.provider,
    organizationId: deps.organizationId,
    userId: deps.userId,
    messages: [
      {
        role: 'system',
        content:
          "Decide whether the step goal was actually met by the assistant's reply. Respond only via the structured output. Be strict — set met=true only if the step's required outcome is unambiguously achieved.",
      },
      {
        role: 'user',
        content: `Step goal:\n${docToText(activeStep.doc)}\n\nAssistant reply:\n${reply}`,
      },
    ],
    tools: [],
    structuredOutput: { enabled: true, schema: BOOL_SCHEMA('met') },
    parameters: { max_tokens: 20 },
    context: { source: 'procedure-advance-check' },
  })
  return Boolean(response.structured_output?.met)
}

/** The backstop verdict on a silent reply (no control tool emitted). */
export interface BackstopVerdict {
  /** Did the reply continue THIS step, vs. answer something off-procedure? */
  onProcedure: boolean
  /** Off-procedure only: does the side request clearly need a multi-turn procedure? */
  multiTurn: boolean
}

/**
 * Silent-reply backstop — the model replied with text but emitted no control tool.
 * Classify whether it stayed on the active step or drifted off-procedure (and if so,
 * whether the drift is clearly multi-turn, gating a next-turn push — #8).
 */
export async function backstopClassify(
  reply: string,
  activeStep: ActiveStep,
  deps: ClassifyDeps
): Promise<BackstopVerdict> {
  const orchestrator = new LLMOrchestrator(undefined, deps.db)
  const response = await orchestrator.invoke({
    model: deps.model,
    provider: deps.provider,
    organizationId: deps.organizationId,
    userId: deps.userId,
    messages: [
      {
        role: 'system',
        content:
          "Did the assistant's reply continue THIS procedure step, or answer something off-procedure? Respond only via the structured output. Set onProcedure=true if it advanced/continued the step. Set multiTurn=true only when an off-procedure request clearly needs its own multi-step handling.",
      },
      {
        role: 'user',
        content: `Current step:\n${docToText(activeStep.doc)}\n\nAssistant reply:\n${reply}`,
      },
    ],
    tools: [],
    structuredOutput: {
      enabled: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['onProcedure', 'multiTurn'],
        properties: { onProcedure: { type: 'boolean' }, multiTurn: { type: 'boolean' } },
      },
    },
    parameters: { max_tokens: 20 },
    context: { source: 'procedure-backstop' },
  })
  return {
    onProcedure: Boolean(response.structured_output?.onProcedure),
    multiTurn: Boolean(response.structured_output?.multiTurn),
  }
}

/**
 * Pick a `text`-mode condition arm. Given the compiled NL `predicates` (arm order =
 * precedence) and the conversation, return the matching arm index, or `null` for the
 * else/fallthrough. This is the callback `prepareTurn` calls via `StepperDeps.pickTextBranch`;
 * Phase 4 binds the turn's `conversation` into the closure.
 */
export async function classifyTextBranch(
  conversation: ConversationMessage[],
  predicates: string[],
  deps: ClassifyDeps
): Promise<number | null> {
  if (predicates.length === 0) return null

  const catalog = predicates.map((p, i) => `  ${i}: ${p}`).join('\n')
  const orchestrator = new LLMOrchestrator(undefined, deps.db)
  const response = await orchestrator.invoke({
    model: deps.model,
    provider: deps.provider,
    organizationId: deps.organizationId,
    userId: deps.userId,
    messages: [
      {
        role: 'system',
        content: [
          'A procedure step branches on which of these conditions currently holds for the',
          'customer. Evaluate them IN ORDER and pick the index of the FIRST that holds, or',
          'null if none does. Respond only via the structured output.',
          '',
          'Conditions:',
          catalog,
        ].join('\n'),
      },
      { role: 'user', content: renderConversation(conversation) },
    ],
    tools: [],
    structuredOutput: {
      enabled: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['arm'],
        properties: { arm: { type: ['integer', 'null'] } },
      },
    },
    parameters: { max_tokens: 20 },
    context: { source: 'procedure-text-condition' },
  })

  const arm = response.structured_output?.arm
  return typeof arm === 'number' && arm >= 0 && arm < predicates.length ? arm : null
}
