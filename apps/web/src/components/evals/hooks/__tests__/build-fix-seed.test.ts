// apps/web/src/components/evals/hooks/__tests__/build-fix-seed.test.ts

import { buildFixSeedMessage, suiteChildrenToFixRuns } from '../build-fix-seed'

describe('buildFixSeedMessage', () => {
  it('embeds case names, case ids, run ids, the suite id, and failed-assertion lines', () => {
    const seed = buildFixSeedMessage({
      suiteRunId: 'esr_1',
      runs: [
        {
          runId: 'run_1',
          caseId: 'case_1',
          caseName: 'Refund for damaged item',
          failedAssertions: [
            { type: 'response_criteria', note: 'No refund timeline stated' },
            { type: 'tool_called' },
          ],
        },
        {
          runId: 'run_2',
          caseId: 'case_2',
          caseName: 'Order status lookup',
          failedAssertions: [],
        },
      ],
    })

    expect(seed).toContain('2 failing simulations')
    expect(seed).toContain('Case "Refund for damaged item" failed (case case_1, run run_1):')
    expect(seed).toContain('- response_criteria: No refund timeline stated')
    expect(seed).toContain('- tool_called')
    expect(seed).toContain('Case "Order status lookup" failed (case case_2, run run_2):')
    expect(seed).toContain('- execution error (no assertion results)')
    expect(seed).toContain('Suite run: esr_1')
    expect(seed).toContain('get_eval_run')
  })

  it('omits the case id for deleted cases', () => {
    const seed = buildFixSeedMessage({
      runs: [
        { runId: 'r1', caseId: null, caseName: 'A', failedAssertions: [{ type: 'crm_field' }] },
      ],
    })
    expect(seed).toContain('Case "A" failed (run r1):')
    expect(seed).not.toContain('case ')
  })

  it('is stable for a single run without a suite', () => {
    const seed = buildFixSeedMessage({
      runs: [
        { runId: 'r1', caseId: 'c1', caseName: 'A', failedAssertions: [{ type: 'crm_field' }] },
      ],
    })
    expect(seed).toContain('1 failing simulation')
    expect(seed).not.toContain('Suite run:')
  })

  it('caps very long assertion notes and flattens whitespace', () => {
    const seed = buildFixSeedMessage({
      runs: [
        {
          runId: 'r1',
          caseId: 'c1',
          caseName: 'A',
          failedAssertions: [{ type: 'response_criteria', note: `x\n${'y'.repeat(500)}` }],
        },
      ],
    })
    const line = seed.split('\n').find((l) => l.startsWith('- response_criteria'))
    expect(line?.length).toBeLessThan(200)
    expect(line).toContain('x y')
    expect(line?.endsWith('…')).toBe(true)
  })
})

describe('suiteChildrenToFixRuns', () => {
  const child = (
    id: string,
    status: string,
    assertionResults: { type: string; status: string; note?: string | null }[] = [],
    caseName = `case ${id}`
  ) => ({ id, caseId: `case-of-${id}`, status, caseName, assertionResults })

  it('keeps only failed/errored children and their non-passed assertions', () => {
    const runs = suiteChildrenToFixRuns([
      child('r1', 'failed', [
        { type: 'response_criteria', status: 'failed', note: 'missed timeline' },
        { type: 'tool_called', status: 'passed' },
      ]),
      child('r2', 'passed', [{ type: 'crm_field', status: 'passed' }]),
      child('r3', 'error', []),
    ])

    expect(runs.map((r) => r.runId)).toEqual(['r1', 'r3'])
    expect(runs.map((r) => r.caseId)).toEqual(['case-of-r1', 'case-of-r3'])
    expect(runs[0]?.failedAssertions).toEqual([
      { type: 'response_criteria', note: 'missed timeline' },
    ])
    expect(runs[1]?.failedAssertions).toEqual([])
  })

  it('feeds a multi-run suite seed with case names, case ids, run ids, and the suite id', () => {
    const runs = suiteChildrenToFixRuns([
      child('r1', 'failed', [{ type: 'response_criteria', status: 'failed', note: 'a' }], 'Refund'),
      child('r2', 'error', [], ''),
    ])
    const seed = buildFixSeedMessage({ suiteRunId: 'esr_9', runs })

    expect(seed).toContain('2 failing simulations')
    expect(seed).toContain('Case "Refund" failed (case case-of-r1, run r1):')
    expect(seed).toContain('Case "Deleted case" failed (case case-of-r2, run r2):')
    expect(seed).toContain('Suite run: esr_9')
  })
})
