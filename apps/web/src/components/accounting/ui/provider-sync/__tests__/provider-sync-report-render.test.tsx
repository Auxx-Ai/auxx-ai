// apps/web/src/components/accounting/ui/provider-sync/__tests__/provider-sync-report-render.test.tsx
//
// The divergence card, and the one thing it must never become.
//
// 🛑 An entry auxx authored that the accountant has since edited in the provider
// is invisible to every other path in this feature - `isOurs` keys on
// authorship, and an edit does not transfer it. This card is where the only
// detector that exists is SEEN, and it REPORTS: no repair, no merge, no "fix
// this". Deciding whose version wins gives one entry two authors (brief 20 §3.4).

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProviderSyncRun } from '../../../hooks/use-provider-sync-run'
import { ProviderSyncReport } from '../provider-sync-report'

function run(over: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    startedAt: '2026-09-16T10:00:00.000Z',
    heartbeatAt: '2026-09-16T10:05:00.000Z',
    status: 'partial',
    finishedAt: '2026-09-16T10:05:00.000Z',
    counters: {
      fetched: 12,
      created: 3,
      updated: 0,
      skipped: 0,
      archived: 0,
      deleted: 0,
      failed: 0,
    },
    errorSample: [],
    pagesProcessed: 1,
    rateLimitWaitMs: 0,
    ...over,
  } as ProviderSyncRun
}

function renderReport(over: Partial<ProviderSyncRun>) {
  render(
    <ProviderSyncReport
      currentRun={null}
      lastRun={run(over)}
      stale={false}
      providerLabel='QuickBooks'
    />
  )
}

describe('the divergence card', () => {
  it('names the doc number, the verdict and the differences verbatim', () => {
    renderReport({
      errorSample: [
        {
          externalId: 'JNL-0006',
          error:
            'Edited in the provider since we exported it. Total: ours is $900.00, theirs is $1,500.00.',
          tier: 'diverged',
        },
      ],
    })

    expect(screen.getByText(/no longer matches QuickBooks/)).toBeDefined()
    expect(screen.getByText('JNL-0006')).toBeDefined()
    expect(screen.getByText(/Total: ours is \$900\.00, theirs is \$1,500\.00\./)).toBeDefined()
  })

  // 🛑 The negative half, and the one that matters most.
  it('offers nothing that would repair it', () => {
    renderReport({
      errorSample: [{ externalId: 'JNL-0006', error: 'Edited…', tier: 'diverged' }],
    })

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText(/fix|merge|overwrite|resolve/i)).toBeNull()
  })

  it('says nothing when every entry of ours still matches', () => {
    renderReport({ errorSample: [] })

    expect(screen.queryByText(/no longer match/)).toBeNull()
  })

  // A divergence is not a refusal: the entries came across, and mixing the two
  // would tell a reader that something is missing from their books.
  it('keeps a divergence out of the refusal card', () => {
    renderReport({
      errorSample: [{ externalId: 'JNL-0006', error: 'Edited…', tier: 'diverged' }],
    })

    expect(screen.queryByText(/refused and are NOT in your books/)).toBeNull()
  })
})

describe('the deferral card', () => {
  it('names the month and what is waiting on it, not just a count', () => {
    renderReport({
      counters: { ...run().counters, deferred: 1 },
      errorSample: [
        {
          externalId: '2026-02',
          error:
            '2026-02 is closed, so Credit Card Expense 77 dated 2026-02-15 was not written. ' +
            'Reopen the month and run the sync again.',
          tier: 'skipped',
        },
      ],
    })

    expect(screen.getByText(/1 entry is waiting on a closed month/)).toBeDefined()
    expect(screen.getByText('2026-02')).toBeDefined()
    expect(
      screen.getByText(/Credit Card Expense 77 dated 2026-02-15 was not written/)
    ).toBeDefined()
  })
})
