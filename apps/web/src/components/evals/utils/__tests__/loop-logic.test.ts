// apps/web/src/components/evals/utils/__tests__/loop-logic.test.ts

import {
  type CasePillRun,
  canShowSuiteDiff,
  selectCasePills,
  suiteProgressRefetchInterval,
} from '../loop-logic'

describe('suiteProgressRefetchInterval', () => {
  it('polls while the status is unknown or non-terminal', () => {
    expect(suiteProgressRefetchInterval(undefined)).toBe(4000)
    expect(suiteProgressRefetchInterval('queued')).toBe(4000)
    expect(suiteProgressRefetchInterval('running')).toBe(4000)
  })

  it.each(['completed', 'cancelled', 'error'])('stops on terminal status %s', (status) => {
    expect(suiteProgressRefetchInterval(status)).toBe(false)
  })
})

describe('canShowSuiteDiff', () => {
  it('requires a candidate, a baseline pointer, and a settled candidate', () => {
    expect(canShowSuiteDiff(null, 'b')).toBe(false)
    expect(canShowSuiteDiff({ status: 'completed' }, null)).toBe(false)
    expect(canShowSuiteDiff({ status: 'running' }, 'b')).toBe(false)
    expect(canShowSuiteDiff({ status: 'error' }, 'b')).toBe(false)
    expect(canShowSuiteDiff({ status: 'completed' }, 'b')).toBe(true)
    expect(canShowSuiteDiff({ status: 'cancelled' }, 'b')).toBe(true)
  })

  it('gates on the baseline status when the baseline row is known', () => {
    expect(canShowSuiteDiff({ status: 'completed' }, 'b', { status: 'running' })).toBe(false)
    expect(canShowSuiteDiff({ status: 'completed' }, 'b', { status: 'completed' })).toBe(true)
  })
})

describe('selectCasePills — last-verified assignment', () => {
  const run = (status: CasePillRun['status'], runMode: string, runId = 'r') => ({
    runId,
    status,
    at: '2026-06-10T00:00:00.000Z',
    runMode,
  })

  it('no runs → empty pills', () => {
    expect(selectCasePills(null, null)).toEqual({ primary: null, draft: null })
  })

  it('pinned latest → primary, no draft secondary', () => {
    const latest = run('passed', 'pinned')
    expect(selectCasePills(latest, null)).toEqual({ primary: latest, draft: null })
  })

  it('draft latest → primary stays on the latest pinned run, draft as secondary', () => {
    const draft = run('passed', 'draft', 'r-draft')
    const pinned = { runId: 'r-pinned', status: 'failed' as const, at: '2026-06-09T00:00:00.000Z' }
    expect(selectCasePills(draft, pinned)).toEqual({ primary: pinned, draft })
  })

  it('draft latest with no pinned history → primary is "not run", draft as secondary', () => {
    const draft = run('failed', 'draft')
    expect(selectCasePills(draft, null)).toEqual({ primary: null, draft })
  })
})
