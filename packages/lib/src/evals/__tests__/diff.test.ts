// packages/lib/src/evals/__tests__/diff.test.ts
//
// 5B verdict diff. `diffChildRuns` is pure (full bucket/flip/delta coverage,
// no DB); `compareSuiteRuns` wrapper tests mock the queries module.

import type { AssertionResult, EvalRunStatus } from '@auxx/types/evals'
import { ok } from 'neverthrow'

vi.mock('../queries', () => ({
  getEvalSuiteRun: vi.fn(),
  listSuiteChildRunSummaries: vi.fn(),
}))

import { compareSuiteRuns, diffChildRuns } from '../diff'
import { getEvalSuiteRun, listSuiteChildRunSummaries, type SuiteChildRunSummary } from '../queries'

const mockedGetSuite = getEvalSuiteRun as unknown as ReturnType<typeof vi.fn>
const mockedListChildren = listSuiteChildRunSummaries as unknown as ReturnType<typeof vi.fn>

let runCounter = 0
function run(
  caseId: string | null,
  status: EvalRunStatus,
  assertionResults: AssertionResult[] = []
): SuiteChildRunSummary {
  runCounter += 1
  return {
    id: `run-${runCounter}`,
    caseId,
    status,
    runMode: 'pinned',
    assertionResults,
    caseName: caseId ? `Case ${caseId}` : 'Deleted case',
  }
}

function assertion(
  assertionId: string,
  type: string,
  status: AssertionResult['status']
): AssertionResult {
  return { assertionId, type, definition: {}, status }
}

beforeEach(() => {
  runCounter = 0
  mockedGetSuite.mockReset()
  mockedListChildren.mockReset()
})

describe('diffChildRuns — buckets', () => {
  it('buckets the full pass/fail matrix', () => {
    const baseline = [
      run('a', 'failed'),
      run('b', 'passed'),
      run('c', 'failed'),
      run('d', 'passed'),
    ]
    const candidate = [
      run('a', 'passed'),
      run('b', 'failed'),
      run('c', 'failed'),
      run('d', 'passed'),
    ]

    const diff = diffChildRuns(baseline, candidate)
    expect(diff.counts).toEqual({
      fixed: 1,
      regressed: 1,
      still_failing: 1,
      still_passing: 1,
      incomparable: 0,
      uncompared: 0,
    })
    const byCase = new Map(diff.entries.map((e) => [e.caseId, e.bucket]))
    expect(byCase.get('a')).toBe('fixed')
    expect(byCase.get('b')).toBe('regressed')
    expect(byCase.get('c')).toBe('still_failing')
    expect(byCase.get('d')).toBe('still_passing')
  })

  it.each([
    'error',
    'cancelled',
    'timed_out',
  ] as const)('marks %s incomparable on either side', (status) => {
    const onBaseline = diffChildRuns([run('a', status)], [run('a', 'passed')])
    const onCandidate = diffChildRuns([run('a', 'passed')], [run('a', status)])
    expect(onBaseline.entries[0]?.bucket).toBe('incomparable')
    expect(onCandidate.entries[0]?.bucket).toBe('incomparable')
  })

  it('marks one-sided cases uncompared, recording the side that has the run', () => {
    const diff = diffChildRuns([run('only-base', 'passed')], [run('only-cand', 'failed')])
    expect(diff.counts.uncompared).toBe(2)
    const base = diff.entries.find((e) => e.caseId === 'only-base')
    const cand = diff.entries.find((e) => e.caseId === 'only-cand')
    expect(base?.baseline).toBeDefined()
    expect(base?.candidate).toBeUndefined()
    expect(cand?.candidate).toBeDefined()
    expect(cand?.baseline).toBeUndefined()
  })

  it('lands null-caseId runs in uncompared with the snapshot-backed name', () => {
    const diff = diffChildRuns([run(null, 'passed')], [run(null, 'passed')])
    expect(diff.counts.uncompared).toBe(2)
    expect(diff.entries[0]?.caseName).toBe('Deleted case')
  })
})

describe('diffChildRuns — assertion flips + flip driver', () => {
  it('joins flips by assertionId and keeps only status changes', () => {
    const baseline = [
      run('a', 'failed', [
        assertion('x', 'tool_called', 'failed'),
        assertion('y', 'response_criteria', 'passed'),
      ]),
    ]
    const candidate = [
      run('a', 'passed', [
        assertion('x', 'tool_called', 'passed'),
        assertion('y', 'response_criteria', 'passed'),
      ]),
    ]

    const entry = diffChildRuns(baseline, candidate).entries[0]
    expect(entry?.assertionFlips).toEqual([
      { assertionId: 'x', type: 'tool_called', from: 'failed', to: 'passed' },
    ])
    expect(entry?.flipDriver).toBe('deterministic')
  })

  it("classifies judge-only flips as 'judge'", () => {
    const baseline = [run('a', 'failed', [assertion('y', 'response_criteria', 'failed')])]
    const candidate = [run('a', 'passed', [assertion('y', 'response_criteria', 'passed')])]

    const diff = diffChildRuns(baseline, candidate)
    expect(diff.entries[0]?.flipDriver).toBe('judge')
    expect(diff.judgeOnlyFlips).toBe(1)
  })

  it("classifies mixed deterministic + judge flips as 'mixed'", () => {
    const baseline = [
      run('a', 'failed', [
        assertion('x', 'tool_called', 'failed'),
        assertion('y', 'response_criteria', 'failed'),
      ]),
    ]
    const candidate = [
      run('a', 'passed', [
        assertion('x', 'tool_called', 'passed'),
        assertion('y', 'response_criteria', 'passed'),
      ]),
    ]

    expect(diffChildRuns(baseline, candidate).entries[0]?.flipDriver).toBe('mixed')
  })

  it("records one-sided assertions as flips to/from 'error' and forces 'mixed'", () => {
    const baseline = [run('a', 'failed', [assertion('removed', 'response_criteria', 'failed')])]
    const candidate = [run('a', 'passed', [assertion('added', 'response_criteria', 'passed')])]

    const entry = diffChildRuns(baseline, candidate).entries[0]
    expect(entry?.assertionFlips).toEqual([
      { assertionId: 'removed', type: 'response_criteria', from: 'failed', to: 'error' },
      { assertionId: 'added', type: 'response_criteria', from: 'error', to: 'passed' },
    ])
    // Judge-only types, but the one-sided join makes attribution impossible.
    expect(entry?.flipDriver).toBe('mixed')
  })

  it('omits flips entirely for unchanged buckets', () => {
    const diff = diffChildRuns(
      [run('a', 'passed', [assertion('x', 'tool_called', 'passed')])],
      [run('a', 'passed', [assertion('x', 'tool_called', 'failed')])]
    )
    expect(diff.entries[0]?.assertionFlips).toBeUndefined()
    expect(diff.entries[0]?.flipDriver).toBeUndefined()
  })
})

describe('diffChildRuns — passRateDelta', () => {
  it('computes the delta over comparable cases only', () => {
    const baseline = [
      run('a', 'failed'),
      run('b', 'failed'),
      run('c', 'passed'),
      run('d', 'error'),
      run('only-base', 'passed'),
    ]
    const candidate = [
      run('a', 'passed'),
      run('b', 'passed'),
      run('c', 'passed'),
      run('d', 'passed'),
    ]

    // Comparable: a, b, c → baseline 1/3 passed, candidate 3/3 passed.
    const diff = diffChildRuns(baseline, candidate)
    expect(diff.passRateDelta).toBeCloseTo(2 / 3)
  })

  it('is null when no cases are comparable', () => {
    const diff = diffChildRuns([run('a', 'error')], [run('a', 'passed'), run('b', 'passed')])
    expect(diff.passRateDelta).toBeNull()
  })
})

describe('diffChildRuns — joinKey seam (phase 4)', () => {
  it('joins by a custom accessor instead of caseId', () => {
    const byTicket = (ticketId: string | null) => ({
      ...run(null, 'passed'),
      caseName: `Ticket ${ticketId}`,
      ticketId,
    })
    const baseline = [{ ...byTicket('t1'), status: 'failed' as const }]
    const candidate = [byTicket('t1')]

    const diff = diffChildRuns(baseline, candidate, {
      joinKey: (r) => (r as { ticketId?: string | null }).ticketId ?? null,
    })
    expect(diff.entries[0]?.bucket).toBe('fixed')
  })
})

describe('compareSuiteRuns — wrapper', () => {
  const SUITES: Record<string, { id: string; status: string; runMode: string }> = {
    'esr-base': { id: 'esr-base', status: 'completed', runMode: 'pinned' },
    'esr-cand': { id: 'esr-cand', status: 'completed', runMode: 'draft' },
    'esr-running': { id: 'esr-running', status: 'running', runMode: 'draft' },
  }

  beforeEach(() => {
    mockedGetSuite.mockImplementation(async ({ suiteRunId }: { suiteRunId: string }) =>
      ok(SUITES[suiteRunId] ?? null)
    )
    mockedListChildren.mockImplementation(async ({ suiteRunId }: { suiteRunId: string }) =>
      ok([run('a', suiteRunId === 'esr-base' ? 'failed' : 'passed')])
    )
  })

  it('diffs two terminal suites and stamps ids + run modes', async () => {
    const result = await compareSuiteRuns({
      organizationId: 'org',
      baselineSuiteRunId: 'esr-base',
      candidateSuiteRunId: 'esr-cand',
    })
    const summary = result._unsafeUnwrap()
    expect(summary.baselineRunMode).toBe('pinned')
    expect(summary.candidateRunMode).toBe('draft')
    expect(summary.counts.fixed).toBe(1)
  })

  it('rejects when a suite does not resolve org-scoped', async () => {
    const result = await compareSuiteRuns({
      organizationId: 'org',
      baselineSuiteRunId: 'esr-foreign',
      candidateSuiteRunId: 'esr-cand',
    })
    expect(result._unsafeUnwrapErr().code).toBe('EVAL_SUITE_RUN_NOT_FOUND')
  })

  it('rejects a non-terminal suite without loading children', async () => {
    const result = await compareSuiteRuns({
      organizationId: 'org',
      baselineSuiteRunId: 'esr-base',
      candidateSuiteRunId: 'esr-running',
    })
    expect(result._unsafeUnwrapErr().code).toBe('SUITE_NOT_TERMINAL')
    expect(mockedListChildren).not.toHaveBeenCalled()
  })
})
