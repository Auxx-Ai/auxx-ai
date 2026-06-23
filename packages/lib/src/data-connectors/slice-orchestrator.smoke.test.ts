// Smoke: the slice orchestrator module imports cleanly under vitest (its queue +
// crud + provisioning imports must not drag deps that break) and exposes sane
// slice-budget tunables (maxMs well under the worker lock — §4.1).
import { describe, expect, it } from 'vitest'
import {
  runBackfillSlice,
  SLICE_BUDGET,
  SLICE_LOCK_DURATION_MS,
  startConnectorSync,
  sweepStaleConnectorRuns,
} from './slice-orchestrator'

describe('slice-orchestrator module', () => {
  it('exports the orchestration entry points', () => {
    expect(typeof startConnectorSync).toBe('function')
    expect(typeof runBackfillSlice).toBe('function')
    expect(typeof sweepStaleConnectorRuns).toBe('function')
  })

  it('keeps the slice budget safely under the worker lock', () => {
    // A slice never sleeps on a throttle, so the lock just needs comfortable margin
    // over the active-work budget (2–3×).
    expect(SLICE_BUDGET.maxMs).toBeLessThan(SLICE_LOCK_DURATION_MS / 2)
    expect(SLICE_BUDGET.maxPages).toBeGreaterThan(0)
    expect(SLICE_BUDGET.maxRecords).toBeGreaterThan(0)
  })
})
