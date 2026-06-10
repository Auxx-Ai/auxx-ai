// packages/lib/src/evals/__tests__/model-summary.test.ts

import type { EvalRunEntity } from '@auxx/database'
import { summarizeEvalRunForModel } from '../model-summary'

let seq = 0
function event(type: string, data: Record<string, unknown>, kind = 'agent') {
  seq += 1
  return {
    id: `evt-${seq}`,
    sequence: seq,
    timestamp: '2026-06-10T00:00:00.000Z',
    kind,
    type,
    data,
  }
}

function makeRun(overrides: Partial<EvalRunEntity> = {}): EvalRunEntity {
  return {
    id: 'run-1',
    organizationId: 'org',
    caseId: 'c1',
    suiteRunId: null,
    kind: 'agent_simulation',
    status: 'failed',
    runMode: 'draft',
    definitionSnapshot: { version: 1, case: { name: 'Refund case' } },
    runtimeSnapshot: { agent: { toolBindings: { secret: 'never' } } },
    snapshotHash: 'h',
    traceVersion: 1,
    trace: [],
    lastTraceSequence: 0,
    assertionResults: [],
    attempt: 0,
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    errorCode: null,
    error: null,
    createdAt: new Date('2026-06-10T00:00:00Z'),
    ...overrides,
  } as EvalRunEntity
}

beforeEach(() => {
  seq = 0
})

describe('summarizeEvalRunForModel', () => {
  it('renders chronological transcript lines per event type', () => {
    const trace = [
      event('customer_message', { text: 'My mug arrived broken.' }, 'system'),
      event('tool_call', {
        toolName: 'order_lookup',
        args: { orderId: '1001' },
        resolution: 'mock',
      }),
      event('agent_message', { text: 'Refund issued.' }),
      event(
        'terminal',
        { terminalOutcome: 'finished', capExceeded: false, customerTurns: 1 },
        'system'
      ),
    ]
    // Shuffle to prove sequence ordering wins over array order.
    const summary = summarizeEvalRunForModel(
      makeRun({ trace: [trace[2], trace[0], trace[3], trace[1]] })
    )

    expect(summary.transcript.split('\n')).toEqual([
      'Customer: My mug arrived broken.',
      'tool order_lookup({"orderId":"1001"}) → ok [mocked]',
      'Agent: Refund issued.',
      '[terminal] outcome=finished capExceeded=false customerTurns=1',
    ])
    expect(summary.caseName).toBe('Refund case')
    expect(summary.runMode).toBe('draft')
    expect(summary.truncated).toBe(false)
  })

  it('marks unmatched tool calls as errors and passthrough as un-mocked', () => {
    const summary = summarizeEvalRunForModel(
      makeRun({
        trace: [
          event('tool_call', { toolName: 'a', args: {}, resolution: 'unmatched_error' }),
          event('tool_call', { toolName: 'b', args: {}, resolution: 'passthrough' }),
        ],
      })
    )
    const [first, second] = summary.transcript.split('\n')
    expect(first).toBe('tool a({}) → error')
    expect(second).toBe('tool b({}) → ok')
  })

  it('extracts failed AND errored assertions, never passed ones', () => {
    const summary = summarizeEvalRunForModel(
      makeRun({
        assertionResults: [
          {
            assertionId: 'a1',
            type: 'tool_called',
            definition: { toolName: 'x' },
            status: 'passed',
          },
          {
            assertionId: 'a2',
            type: 'response_criteria',
            definition: { criteria: ['states timeline'] },
            status: 'failed',
            note: 'No timeline given',
          },
          { assertionId: 'a3', type: 'crm_field', definition: { ref: 'f' }, status: 'error' },
        ],
      })
    )
    expect(summary.failedAssertions.map((a) => a.assertionId)).toEqual(['a2', 'a3'])
    expect(summary.failedAssertions[0]?.note).toBe('No timeline given')
  })

  it('truncates the middle with an explicit marker and keeps head + tail', () => {
    const trace = Array.from({ length: 200 }, (_, i) =>
      event('agent_message', { text: `turn ${i} ${'x'.repeat(80)}` })
    )
    const summary = summarizeEvalRunForModel(makeRun({ trace }), { maxChars: 2000 })

    expect(summary.truncated).toBe(true)
    expect(summary.transcript.length).toBeLessThanOrEqual(2000)
    expect(summary.transcript).toMatch(/…\[truncated \d+ events\]…/)
    expect(summary.transcript).toContain('turn 0 ')
    expect(summary.transcript).toContain('turn 199 ')
  })

  it('never leaks runtime-snapshot internals', () => {
    const summary = summarizeEvalRunForModel(makeRun())
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('toolBindings')
    expect(serialized).not.toContain('never')
  })

  it('surfaces a run-level error when the trace never got that far', () => {
    const summary = summarizeEvalRunForModel(
      makeRun({ status: 'error', errorCode: 'ENQUEUE_FAILED', error: 'queue down', trace: [] })
    )
    expect(summary.transcript).toBe('[run error] ENQUEUE_FAILED: queue down')
  })
})
