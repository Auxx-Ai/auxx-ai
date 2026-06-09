// packages/lib/src/evals/agent-grader.ts
//
// Deterministic-where-possible grader for an agent Simulation. Each assertion is
// graded against the executor's recorded outcome; the only stochastic check is
// `response_criteria`, judged one utility-model call per criterion. A failed or
// invalid judge call makes that assertion `error` (and the run `error`) — never a
// silent `failed`. Roll-up: all passed → `passed`; ran but ≥1 failed → `failed`;
// execution / required-mock / grading could not complete → `error`.
//
// See plans/evals/phase-1-agent-simulation.md §1.8.

import type { AgentEvalAssertion, AssertionResult } from '@auxx/types/evals'
import type { LLMCallParams } from '../ai/agent-framework/types'
import type { Message } from '../ai/clients/base/types'
import { evaluateComparator } from './comparators'
import type { AgentSimulationResult } from './simulation/executor'
import { argsMatch } from './simulation/mock-tools'
import type { CallModel } from './simulation/persona'

/** One structured natural-language judgment over the agent's visible prose. */
export interface ResponseJudgment {
  passed: boolean
  rationale: string
  evidenceEventIds: string[]
}

export interface JudgeTranscriptTurn {
  role: 'customer' | 'agent'
  text: string
  /** Trace event id (agent turns only) the judge can cite as evidence. */
  eventId?: string
}

/** Injected response judge — the worker binds a utility-model call here. */
export type ResponseJudge = (args: {
  criterion: string
  transcript: JudgeTranscriptTurn[]
}) => Promise<ResponseJudgment>

export interface GradeAgentSimulationInput {
  assertions: AgentEvalAssertion[]
  scope: 'procedure' | 'agent'
  result: AgentSimulationResult
  judge: ResponseJudge
}

export interface GradeResult {
  status: 'passed' | 'failed' | 'error'
  assertionResults: AssertionResult[]
}

/**
 * Grade every assertion and roll the verdicts up. The executor's own `error`
 * (unmatched mock, turn cap, incompatible snapshot, execution failure) forces the
 * run to `error` even if the surviving assertions happened to pass — an
 * unreached terminal assertion will already have failed, and a run that could not
 * complete is never reported as a clean `failed`.
 */
export async function gradeAgentSimulation(input: GradeAgentSimulationInput): Promise<GradeResult> {
  const { assertions, scope, result } = input
  const out: AssertionResult[] = []

  for (const assertion of assertions) {
    out.push(...(await gradeOne(assertion, scope, result, input.judge)))
  }

  const anyError = out.some((r) => r.status === 'error') || result.error !== undefined
  const anyFailed = out.some((r) => r.status === 'failed')
  const status: GradeResult['status'] = anyError ? 'error' : anyFailed ? 'failed' : 'passed'
  return { status, assertionResults: out }
}

async function gradeOne(
  assertion: AgentEvalAssertion,
  scope: 'procedure' | 'agent',
  result: AgentSimulationResult,
  judge: ResponseJudge
): Promise<AssertionResult[]> {
  const base = { assertionId: assertion.id, type: assertion.type, definition: assertion }

  switch (assertion.type) {
    case 'terminal_outcome': {
      const actual = result.terminalOutcome
      const passed = actual === assertion.data.outcome
      return [
        {
          ...base,
          status: passed ? 'passed' : 'failed',
          actual,
          ...(passed
            ? {}
            : {
                note: `Expected terminal outcome "${assertion.data.outcome}", got "${actual ?? 'none'}"`,
              }),
        },
      ]
    }

    case 'procedure_selected': {
      if (scope === 'procedure') {
        return [
          {
            ...base,
            status: 'error',
            note: 'procedure_selected only applies to agent-scope cases (selection never ran)',
          },
        ]
      }
      const actual = result.selectedProcedureId
      const passed = actual === assertion.data.procedureId
      return [
        {
          ...base,
          status: passed ? 'passed' : 'failed',
          actual,
          ...(passed
            ? {}
            : {
                note: `Expected procedure "${assertion.data.procedureId}", routed to "${actual ?? 'none'}"`,
              }),
        },
      ]
    }

    case 'crm_field': {
      const actual = await result.finalResolver.resolveField(assertion.data.ref)
      const outcome = evaluateComparator(assertion.data.comparator, actual, assertion.data.expected)
      return [
        {
          ...base,
          status: outcome.passed ? 'passed' : 'failed',
          actual,
          ...(outcome.note ? { note: outcome.note } : {}),
        },
      ]
    }

    case 'local_variable': {
      const actual = await result.finalResolver.resolveLocalVar(assertion.data.name)
      const outcome = evaluateComparator(assertion.data.comparator, actual, assertion.data.expected)
      return [
        {
          ...base,
          status: outcome.passed ? 'passed' : 'failed',
          actual,
          ...(outcome.note ? { note: outcome.note } : {}),
        },
      ]
    }

    case 'tool_called': {
      const match = result.toolInvocations.find(
        (inv) =>
          inv.toolName === assertion.data.toolName &&
          inv.resolution !== 'unmatched_error' &&
          argsMatch(assertion.data.args, inv.args)
      )
      const passed = match !== undefined
      return [
        {
          ...base,
          status: passed ? 'passed' : 'failed',
          actual: passed ? { toolName: match.toolName, args: match.args } : null,
          ...(passed
            ? {}
            : { note: `Tool "${assertion.data.toolName}" was not called with the expected args` }),
        },
      ]
    }

    case 'tool_not_called': {
      const match = result.toolInvocations.find(
        (inv) =>
          inv.toolName === assertion.data.toolName &&
          inv.resolution !== 'unmatched_error' &&
          argsMatch(assertion.data.args, inv.args)
      )
      const passed = match === undefined
      return [
        {
          ...base,
          status: passed ? 'passed' : 'failed',
          actual: passed ? null : { toolName: match.toolName, args: match.args },
          ...(passed
            ? {}
            : { note: `Tool "${assertion.data.toolName}" was called but should not have been` }),
        },
      ]
    }

    case 'response_criteria': {
      const transcript = buildTranscript(result)
      const results: AssertionResult[] = []
      // One judgment per criterion (a result maps to one natural-language criterion).
      for (let i = 0; i < assertion.data.criteria.length; i++) {
        const criterion = assertion.data.criteria[i]!
        const id = assertion.data.criteria.length > 1 ? `${assertion.id}:${i}` : assertion.id
        try {
          const judgment = await judge({ criterion, transcript })
          results.push({
            assertionId: id,
            type: assertion.type,
            definition: { ...assertion, data: { criteria: [criterion] } },
            status: judgment.passed ? 'passed' : 'failed',
            actual: { rationale: judgment.rationale, evidenceEventIds: judgment.evidenceEventIds },
            ...(judgment.passed ? {} : { note: judgment.rationale }),
          })
        } catch (err) {
          // A failed / invalid judge call is an `error`, never a `failed`.
          results.push({
            assertionId: id,
            type: assertion.type,
            definition: { ...assertion, data: { criteria: [criterion] } },
            status: 'error',
            note: `Response judge failed: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
      return results
    }
  }
}

// ── Default utility-model judge ──────────────────────────────────────────

const JUDGE_RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  jsonSchema: {
    name: 'criterion_judgment',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        passed: { type: 'boolean' },
        rationale: { type: 'string' },
        evidenceEventIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['passed', 'rationale', 'evidenceEventIds'],
    },
  },
}

/**
 * Build a {@link ResponseJudge} backed by the utility model. Throws on a failed
 * call or invalid structured output, so the grader records the assertion as
 * `error` rather than guessing a verdict.
 */
export function createResponseJudge(args: {
  callModel: CallModel
  model: { provider: string; model: string }
  signal?: AbortSignal
}): ResponseJudge {
  return async ({ criterion, transcript }) => {
    const conversation = transcript
      .map((t) => `${t.role === 'agent' ? `AGENT[${t.eventId}]` : 'CUSTOMER'}: ${t.text}`)
      .join('\n')
    const messages: Message[] = [
      {
        role: 'system',
        content: [
          "You are a strict evaluator of a support AGENT's replies in a conversation.",
          "Decide whether the AGENT's messages, taken together, satisfy the given criterion.",
          'Judge only the AGENT turns. Cite the AGENT[<id>] tags you relied on in evidenceEventIds.',
          'Return a structured judgment. Be conservative: if the criterion is not clearly met, fail it.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Criterion:\n${criterion}\n\nConversation:\n${conversation}`,
      },
    ]
    const params: LLMCallParams = {
      provider: args.model.provider,
      model: args.model.model,
      messages,
      responseFormat: JUDGE_RESPONSE_SCHEMA,
      signal: args.signal,
    }

    let content = ''
    for await (const event of args.callModel(params)) {
      if (event.type === 'done') content = event.content
    }
    const parsed = JSON.parse(content) as {
      passed?: unknown
      rationale?: unknown
      evidenceEventIds?: unknown
    }
    if (typeof parsed.passed !== 'boolean' || typeof parsed.rationale !== 'string') {
      throw new Error('judge returned malformed structured output')
    }
    return {
      passed: parsed.passed,
      rationale: parsed.rationale,
      evidenceEventIds: Array.isArray(parsed.evidenceEventIds)
        ? parsed.evidenceEventIds.filter((x): x is string => typeof x === 'string')
        : [],
    }
  }
}

/** Chronological customer/agent prose transcript from the trace (no tool internals). */
function buildTranscript(result: AgentSimulationResult): JudgeTranscriptTurn[] {
  const turns: JudgeTranscriptTurn[] = []
  for (const event of result.trace) {
    if (event.type === 'customer_message' && typeof event.data.text === 'string') {
      turns.push({ role: 'customer', text: event.data.text })
    } else if (event.type === 'agent_message' && typeof event.data.text === 'string') {
      turns.push({ role: 'agent', text: event.data.text, eventId: event.id })
    }
  }
  return turns
}
