// apps/web/src/components/evals/hooks/__tests__/build-fix-seed.test.ts

import { buildFixSeedMessage } from '../build-fix-seed'

describe('buildFixSeedMessage', () => {
  it('embeds case names, run ids, the suite id, and failed-assertion lines', () => {
    const seed = buildFixSeedMessage({
      suiteRunId: 'esr_1',
      runs: [
        {
          runId: 'run_1',
          caseName: 'Refund for damaged item',
          failedAssertions: [
            { type: 'response_criteria', note: 'No refund timeline stated' },
            { type: 'tool_called' },
          ],
        },
        {
          runId: 'run_2',
          caseName: 'Order status lookup',
          failedAssertions: [],
        },
      ],
    })

    expect(seed).toContain('2 failing simulations')
    expect(seed).toContain('Case "Refund for damaged item" failed (run run_1):')
    expect(seed).toContain('- response_criteria: No refund timeline stated')
    expect(seed).toContain('- tool_called')
    expect(seed).toContain('Case "Order status lookup" failed (run run_2):')
    expect(seed).toContain('- execution error (no assertion results)')
    expect(seed).toContain('Suite run: esr_1')
    expect(seed).toContain('get_eval_run')
  })

  it('is stable for a single run without a suite', () => {
    const seed = buildFixSeedMessage({
      runs: [{ runId: 'r1', caseName: 'A', failedAssertions: [{ type: 'crm_field' }] }],
    })
    expect(seed).toContain('1 failing simulation')
    expect(seed).not.toContain('Suite run:')
  })

  it('caps very long assertion notes and flattens whitespace', () => {
    const seed = buildFixSeedMessage({
      runs: [
        {
          runId: 'r1',
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
