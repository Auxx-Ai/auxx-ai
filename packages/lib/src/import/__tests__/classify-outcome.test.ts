// packages/lib/src/import/__tests__/classify-outcome.test.ts

import { describe, expect, it } from 'vitest'
import {
  classifyImportOutcome,
  isFinishedImportStatus,
  outcomeToJobStatus,
} from '../execution/classify-outcome'

const counters = (over: Partial<Parameters<typeof classifyImportOutcome>[0]> = {}) => ({
  created: 0,
  updated: 0,
  skipped: 0,
  unmatched: 0,
  noOps: 0,
  failed: 0,
  ...over,
})

describe('classifyImportOutcome', () => {
  it('is completed when nothing failed', () => {
    expect(classifyImportOutcome(counters({ created: 201 }))).toBe('completed')
  })

  it('is completed for an empty run', () => {
    expect(classifyImportOutcome(counters())).toBe('completed')
  })

  /**
   * THE REGRESSION. A supplier-price import mapped no column to the required
   * `part` relation, so the writer rejected all 201 rows. The executor got this
   * right; `markJobCompleted` hard-coded `'completed'` and the outcome card had
   * no failed tile, so it rendered 0/0/0/0 under a green check.
   */
  it('is failed when every row was rejected and nothing landed', () => {
    expect(classifyImportOutcome(counters({ failed: 201 }))).toBe('failed')
    expect(outcomeToJobStatus(classifyImportOutcome(counters({ failed: 201 })))).toBe('failed')
  })

  it('is partial when some rows landed and some failed', () => {
    expect(classifyImportOutcome(counters({ created: 200, failed: 1 }))).toBe('partial')
    expect(classifyImportOutcome(counters({ updated: 1, failed: 200 }))).toBe('partial')
  })

  // `skipped`, `unmatched` and `noOps` are rows the run ACCOUNTED for. A run
  // that skipped rows and failed the rest did something, so it is partial —
  // reporting it as a total failure would be as wrong as the original bug.
  it.each([
    'skipped',
    'unmatched',
    'noOps',
  ] as const)('treats %s rows as landed, not as failure', (key) => {
    expect(classifyImportOutcome(counters({ [key]: 5, failed: 3 }))).toBe('partial')
  })

  it('tolerates absent optional counters', () => {
    expect(classifyImportOutcome({ created: 0, updated: 0, skipped: 0, failed: 7 })).toBe('failed')
    expect(classifyImportOutcome({ created: 1, updated: 0, skipped: 0, failed: 7 })).toBe('partial')
  })
})

describe('outcomeToJobStatus', () => {
  it('keeps partial distinct from completed', () => {
    expect(outcomeToJobStatus('completed')).toBe('completed')
    expect(outcomeToJobStatus('partial')).toBe('completed_with_errors')
    expect(outcomeToJobStatus('failed')).toBe('failed')
  })
})

describe('isFinishedImportStatus', () => {
  // The wizard gates "show the outcome" on this. Missing a terminal status here
  // strands a finished run on the pre-run summary with no result shown.
  it.each(['completed', 'completed_with_errors', 'failed'] as const)('%s is finished', (status) => {
    expect(isFinishedImportStatus(status)).toBe(true)
  })

  it.each([
    'uploading',
    'ingesting',
    'waiting',
    'planning',
    'ready',
    'executing',
  ] as const)('%s is not finished', (status) => {
    expect(isFinishedImportStatus(status)).toBe(false)
  })

  it('is not finished for an unknown job', () => {
    expect(isFinishedImportStatus(undefined)).toBe(false)
  })
})
