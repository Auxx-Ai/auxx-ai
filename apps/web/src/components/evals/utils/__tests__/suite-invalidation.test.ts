// apps/web/src/components/evals/utils/__tests__/suite-invalidation.test.ts

import { invalidateAfterSuiteTerminal } from '../suite-invalidation'

describe('invalidateAfterSuiteTerminal', () => {
  it('invalidates the suite list, case rows, and run feed exactly once each', () => {
    const listSuiteRuns = vi.fn().mockResolvedValue(undefined)
    const list = vi.fn().mockResolvedValue(undefined)
    const listRuns = vi.fn().mockResolvedValue(undefined)

    invalidateAfterSuiteTerminal({
      eval: {
        listSuiteRuns: { invalidate: listSuiteRuns },
        list: { invalidate: list },
        listRuns: { invalidate: listRuns },
      },
    })

    expect(listSuiteRuns).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(1)
    expect(listRuns).toHaveBeenCalledTimes(1)
  })
})
