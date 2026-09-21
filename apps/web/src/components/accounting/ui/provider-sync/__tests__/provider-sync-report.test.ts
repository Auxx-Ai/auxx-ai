// apps/web/src/components/accounting/ui/provider-sync/__tests__/provider-sync-report.test.ts
//
// The readings the sync rows are built on
// (plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §4.5, §7.4).
//
// 🛑 A STALE OPEN RUN MUST NOT READ AS RUNNING. §7.4: a chain killed mid-slice
// by a worker restart leaves `currentRun` open with nothing to close it, so a
// panel that believed the blob would show a spinner for ever on a walk that is
// not happening - and the person watching would wait instead of pressing again.

import { describe, expect, it } from 'vitest'
import type { ProviderSyncRun } from '../../../hooks/use-provider-sync-run'
import { describeProviderSyncRun, elapsedLabel, splitErrorSample } from '../provider-sync-report'

const STARTED = '2026-09-16T10:00:00.000Z'
const NOW = Date.parse('2026-09-16T10:04:05.000Z')

function run(over: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    startedAt: STARTED,
    heartbeatAt: STARTED,
    status: 'running',
    counters: {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      archived: 0,
      deleted: 0,
      failed: 0,
    },
    errorSample: [],
    pagesProcessed: 0,
    rateLimitWaitMs: 0,
    ...over,
  } as ProviderSyncRun
}

describe('describeProviderSyncRun', () => {
  it('reads an open run as running, with the clock', () => {
    const reading = describeProviderSyncRun(
      { currentRun: run({ pagesProcessed: 3 }), lastRun: null, stale: false },
      'QuickBooks',
      NOW
    )
    expect(reading.tone).toBe('running')
    expect(reading.headline).toContain('4:05')
    expect(reading.detail).toContain('3 months read so far')
  })

  // §7.4. The run is open in the blob and nothing is going to close it.
  it('reads a stale open run as stopped, not running', () => {
    const reading = describeProviderSyncRun(
      { currentRun: run(), lastRun: null, stale: true },
      'QuickBooks',
      NOW
    )
    expect(reading.tone).toBe('alarm')
    expect(reading.headline).toBe('The last sync stopped without finishing')
  })

  it('says nothing has been read when there is no run at all', () => {
    const reading = describeProviderSyncRun(
      { currentRun: null, lastRun: null, stale: false },
      'QuickBooks',
      NOW
    )
    expect(reading.tone).toBe('neutral')
    expect(reading.headline).toBe('QuickBooks has not been read yet')
  })

  // A partial run wrote entries AND left some behind; the row must not read as
  // a plain success, because what was refused is not in the books.
  it('reads a partial run as a warning', () => {
    const reading = describeProviderSyncRun(
      {
        currentRun: null,
        lastRun: run({
          status: 'partial',
          finishedAt: '2026-09-16T10:09:00.000Z',
          pagesProcessed: 9,
        }),
        stale: false,
      },
      'QuickBooks',
      NOW
    )
    expect(reading.tone).toBe('warn')
    expect(reading.detail).toContain('NOT in your books')
  })

  it('carries a failed run’s own message rather than paraphrasing it', () => {
    const reading = describeProviderSyncRun(
      {
        currentRun: null,
        lastRun: run({ status: 'failed', error: 'The accounting cutoff month is not set.' }),
        stale: false,
      },
      'QuickBooks',
      NOW
    )
    expect(reading.tone).toBe('alarm')
    expect(reading.detail).toBe('The accounting cutoff month is not set.')
  })
})

describe('splitErrorSample', () => {
  // The two have different remedies: an unbalanced entry is fixed on their side,
  // a refusal is usually an account map or a closed period on ours.
  it('separates unbalanced entries from refusals', () => {
    const split = splitErrorSample(
      run({
        errorSample: [
          { externalId: '112', error: 'does not balance', tier: 'invalid' },
          { externalId: '2026-07-01..2026-07-31', error: 'unmapped account', tier: 'rejected' },
          { externalId: '', error: 'no tier at all' },
        ],
      })
    )
    expect(split.unbalanced.map((s) => s.externalId)).toEqual(['112'])
    expect(split.refused).toHaveLength(2)
  })

  // 🛑 A divergence is not a refusal and a deferral is not one either. Both ride
  // `errorSample` because it is the only per-entry channel the run carries, and
  // filing either under "refused and NOT in your books" would be a lie.
  it('keeps divergences and deferrals out of the refusals', () => {
    const split = splitErrorSample(
      run({
        errorSample: [
          { externalId: 'JNL-0006', error: 'Edited…', tier: 'diverged' },
          { externalId: '2026-02', error: '2026-02 is closed…', tier: 'skipped' },
          { externalId: '2026-07-01..2026-07-31', error: 'unmapped account', tier: 'rejected' },
        ],
      })
    )
    expect(split.diverged.map((s) => s.externalId)).toEqual(['JNL-0006'])
    expect(split.deferred.map((s) => s.externalId)).toEqual(['2026-02'])
    expect(split.refused).toHaveLength(1)
  })
})

describe('elapsedLabel', () => {
  it('reads four minutes as four minutes', () => {
    expect(elapsedLabel(245_000)).toBe('4:05')
  })

  it('never renders a negative clock', () => {
    expect(elapsedLabel(-1_000)).toBe('0:00')
  })
})
