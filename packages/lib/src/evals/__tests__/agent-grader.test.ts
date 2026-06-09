// packages/lib/src/evals/__tests__/agent-grader.test.ts

import type { AgentEvalAssertion, EvalTraceEvent } from '@auxx/types/evals'
import type { FieldReference } from '@auxx/types/field'
import { describe, expect, it, vi } from 'vitest'
import { gradeAgentSimulation, type ResponseJudge } from '../agent-grader'
import type { AgentSimulationResult } from '../simulation/executor'

const trace = (
  turns: { role: 'customer' | 'agent'; text: string; id?: string }[]
): EvalTraceEvent[] =>
  turns.map((t, i) => ({
    id: t.id ?? `e${i}`,
    sequence: i,
    timestamp: '2026-01-01T00:00:00.000Z',
    kind: t.role === 'agent' ? ('agent' as const) : ('system' as const),
    type: t.role === 'agent' ? 'agent_message' : 'customer_message',
    data: { text: t.text },
  }))

const result = (over: Partial<AgentSimulationResult>): AgentSimulationResult => ({
  terminalOutcome: 'finished',
  selectedProcedureId: null,
  toolInvocations: [],
  transitions: [],
  trace: [],
  visibleAgentTurns: [],
  customerTurns: 1,
  capExceeded: false,
  nonOffline: false,
  usage: { totalTokens: 0, llmCalls: 0 },
  verification: {
    compatible: true,
    missingTools: [],
    digestMismatches: [],
    codeRevisionDrifted: false,
    snapshotCodeRevision: 'r',
    currentCodeRevision: 'r',
  },
  finalResolver: {
    resolveField: async () => undefined,
    resolveLocalVar: async () => undefined,
  },
  ...over,
})

const passJudge: ResponseJudge = async () => ({
  passed: true,
  rationale: 'ok',
  evidenceEventIds: [],
})

describe('gradeAgentSimulation', () => {
  it('passes when every assertion passes', async () => {
    const assertions: AgentEvalAssertion[] = [
      { id: 'a', type: 'terminal_outcome', data: { outcome: 'finished' } },
    ]
    const r = await gradeAgentSimulation({
      assertions,
      scope: 'procedure',
      result: result({ terminalOutcome: 'finished' }),
      judge: passJudge,
    })
    expect(r.status).toBe('passed')
    expect(r.assertionResults[0]?.status).toBe('passed')
  })

  it('fails when a terminal outcome differs', async () => {
    const assertions: AgentEvalAssertion[] = [
      { id: 'a', type: 'terminal_outcome', data: { outcome: 'finished' } },
    ]
    const r = await gradeAgentSimulation({
      assertions,
      scope: 'procedure',
      result: result({ terminalOutcome: 'handoff' }),
      judge: passJudge,
    })
    expect(r.status).toBe('failed')
  })

  it('marks the run error when the executor reported an error, even if assertions pass', async () => {
    const assertions: AgentEvalAssertion[] = [
      { id: 'a', type: 'terminal_outcome', data: { outcome: 'finished' } },
    ]
    const r = await gradeAgentSimulation({
      assertions,
      scope: 'procedure',
      result: result({
        terminalOutcome: 'finished',
        error: { code: 'TURN_CAP_EXCEEDED', message: 'cap' },
      }),
      judge: passJudge,
    })
    expect(r.status).toBe('error')
  })

  it('errors a procedure_selected assertion in procedure scope', async () => {
    const assertions: AgentEvalAssertion[] = [
      { id: 'p', type: 'procedure_selected', data: { procedureId: 'proc_1' } },
    ]
    const r = await gradeAgentSimulation({
      assertions,
      scope: 'procedure',
      result: result({}),
      judge: passJudge,
    })
    expect(r.assertionResults[0]?.status).toBe('error')
    expect(r.status).toBe('error')
  })

  it('grades tool_called / tool_not_called against recorded invocations', async () => {
    const r = await gradeAgentSimulation({
      assertions: [
        {
          id: 't1',
          type: 'tool_called',
          data: { toolName: 'find_order', args: { mode: 'subset', value: { id: 1 } } },
        },
        { id: 't2', type: 'tool_not_called', data: { toolName: 'refund' } },
      ],
      scope: 'procedure',
      result: result({
        toolInvocations: [
          {
            toolName: 'find_order',
            args: { id: 1, locale: 'en' },
            output: {},
            mockId: 'm',
            resolution: 'mock',
            captured: false,
          },
        ],
      }),
      judge: passJudge,
    })
    expect(r.assertionResults.find((a) => a.assertionId === 't1')?.status).toBe('passed')
    expect(r.assertionResults.find((a) => a.assertionId === 't2')?.status).toBe('passed')
  })

  it('does not count an unmatched-error invocation as a tool call', async () => {
    const r = await gradeAgentSimulation({
      assertions: [{ id: 't', type: 'tool_called', data: { toolName: 'find_order' } }],
      scope: 'procedure',
      result: result({
        toolInvocations: [
          {
            toolName: 'find_order',
            args: {},
            output: {},
            mockId: null,
            resolution: 'unmatched_error',
            captured: false,
          },
        ],
        error: { code: 'UNMATCHED_MOCK', message: 'x' },
      }),
      judge: passJudge,
    })
    expect(r.assertionResults[0]?.status).toBe('failed')
  })

  it('grades crm_field through the final resolver', async () => {
    const r = await gradeAgentSimulation({
      assertions: [
        {
          id: 'c',
          type: 'crm_field',
          data: {
            ref: 'contact:status' as unknown as FieldReference,
            comparator: { op: 'equals' },
            expected: 'CLOSED',
          },
        },
      ],
      scope: 'procedure',
      result: result({
        finalResolver: {
          resolveField: async () => 'CLOSED',
          resolveLocalVar: async () => undefined,
        },
      }),
      judge: passJudge,
    })
    expect(r.assertionResults[0]?.status).toBe('passed')
  })

  it('emits one result per response criterion and errors on judge failure', async () => {
    const badJudge: ResponseJudge = vi.fn(async ({ criterion }) => {
      if (criterion === 'b') throw new Error('judge down')
      return { passed: true, rationale: 'ok', evidenceEventIds: ['e1'] }
    })
    const r = await gradeAgentSimulation({
      assertions: [{ id: 'rc', type: 'response_criteria', data: { criteria: ['a', 'b'] } }],
      scope: 'procedure',
      result: result({ trace: trace([{ role: 'agent', text: 'hi', id: 'e1' }]) }),
      judge: badJudge,
    })
    expect(r.assertionResults).toHaveLength(2)
    expect(r.assertionResults[0]?.status).toBe('passed')
    expect(r.assertionResults[1]?.status).toBe('error')
    expect(r.status).toBe('error')
  })
})
