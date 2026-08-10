// apps/web/src/components/inbox/ui/inbox-reclassify-dialog.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The scope dialog (07 §3.2) and the sample results that replace its body
 * (07 §3.3).
 *
 * Four rules here are the kind that quietly stop being true and never show up in
 * a screenshot of the happy path:
 *
 *  - **The "this does not run your filters" line** (07 invariant 11). Without it
 *    "classify existing mail" reads as "apply my automations to old mail", and
 *    the user goes looking for assignments that will never happen.
 *  - **A capped count is never rendered as a bare number** (07 invariant 8 /
 *    R-Q5). `5,000` implies completeness; `5,000 of 5,000+` does not.
 *  - **A label the model never chose still renders, at zero** (07 §3.3 / `06-…`
 *    Q1). The zero row IS the finding — a label never chosen in a sample is a
 *    label to merge — so filtering it out deletes the evidence.
 *  - **Abstention is a row, not a footnote** (07 §2.11). It is the single most
 *    informative number in the report.
 */

const h = vi.hoisted(() => ({
  preview: {
    count: 412,
    capped: false,
    cap: 5000,
    eligibleTagCount: 4,
    estimatedCredits: 3790,
    sampleSize: 100,
    sampleCredits: 920,
    syncInProgress: false,
  } as Record<string, unknown> | null,
  previewPending: false,
  previewError: null as { message: string } | null,
  status: null as Record<string, unknown> | null,
  startSample: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      mailClassification: { getReclassifySampleStatus: { invalidate: h.invalidate } },
    }),
    mailClassification: {
      getReclassifyPreview: {
        useQuery: () => ({
          data: h.preview,
          isPending: h.previewPending,
          error: h.previewError,
        }),
      },
      getReclassifySampleStatus: { useQuery: () => ({ data: h.status }) },
      startReclassifySample: {
        useMutation: () => ({ mutate: h.startSample, isPending: false }),
      },
    },
  },
}))

/**
 * `next/link` prefetch does `new IntersectionObserver(...)`, and the global stub
 * in `src/test/setup.ts` is a `vi.fn().mockImplementation(() => ({…}))` — not a
 * valid constructor, exactly the failure that file already documents for
 * `ResizeObserver`. The results view is the only surface here with a link, so it
 * is swapped for the anchor it renders anyway.
 */
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const { InboxReclassifyDialog } = await import('./inbox-reclassify-dialog')

const open = () => render(<InboxReclassifyDialog inboxId='ibx_1' open onOpenChange={vi.fn()} />)

/** A completed sample whose `Account` label was never chosen. */
const report = {
  inboxId: 'ibx_1',
  mode: 'fill-gaps',
  requested: 100,
  selected: 100,
  inferred: 100,
  classified: 74,
  abstained: 26,
  abstentionRate: 0.26,
  meanConfidence: 0.81,
  labels: [
    { tagId: 't_support', title: 'Support', count: 34, meanConfidence: 0.88 },
    { tagId: 't_sales', title: 'Sales', count: 22, meanConfidence: 0.79 },
    { tagId: 't_billing', title: 'Billing', count: 12, meanConfidence: 0.74 },
    { tagId: 't_orders', title: 'Order Status', count: 6, meanConfidence: 0.71 },
    { tagId: 't_account', title: 'Account', count: 0, meanConfidence: 0 },
  ],
  skipped: {},
  abstainedByReason: { 'no-category': 26 },
  applied: false,
}

beforeEach(() => {
  h.preview = {
    count: 412,
    capped: false,
    cap: 5000,
    eligibleTagCount: 4,
    estimatedCredits: 3790,
    sampleSize: 100,
    sampleCredits: 920,
    syncInProgress: false,
  }
  h.previewPending = false
  h.previewError = null
  h.status = null
})

describe('InboxReclassifyDialog — the scope form', () => {
  it('says out loud that mail filters do not run on the backlog', () => {
    open()

    expect(screen.getByText(/Your mail filters do not run on them/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing is assigned, archived or answered/i)).toBeInTheDocument()
  })

  it('previews the thread count, the estimated credits and the sample cost', () => {
    open()

    expect(screen.getByText('412 conversations')).toBeInTheDocument()
    expect(screen.getByText(/~3,790 credits/)).toBeInTheDocument()
    expect(screen.getByText(/a sample of 100 costs ~920/)).toBeInTheDocument()
  })

  /** ⚠️ Never a bare number past the cap — that reads as "covered everything". */
  it('renders a capped count as "5,000 of 5,000+", never as 5,000', () => {
    h.preview = { ...(h.preview as object), count: 5000, capped: true, cap: 5000 }
    open()

    expect(screen.getByText('5,000 of 5,000+ conversations')).toBeInTheDocument()
    expect(screen.getByText(/Run it again to reach further back/i)).toBeInTheDocument()
  })

  /** The `null` branch: no default model, or no registry price for it. */
  it('says "metered per conversation" rather than inventing a credit figure', () => {
    h.preview = { ...(h.preview as object), estimatedCredits: null, sampleCredits: null }
    open()

    expect(screen.getAllByText(/metered per conversation/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/credits/)).not.toBeInTheDocument()
  })

  /** 07 R4 — the only place a user can accidentally pay twice. */
  it('carries the double-billing distinction in the mode copy', () => {
    open()

    expect(screen.getByText(/Never charges twice/i)).toBeInTheDocument()
    expect(screen.getByText(/Charges again for those conversations/i)).toBeInTheDocument()
  })

  it('starts a sample with the current scope', async () => {
    open()

    await userEvent.click(screen.getByRole('button', { name: /Try a sample of 100/i }))

    expect(h.startSample).toHaveBeenCalledWith({
      inboxId: 'ibx_1',
      range: { kind: 'days', days: 30 },
      mode: 'fill-gaps',
    })
  })

  /** 07 R-Q8 — a run started mid-backfill misses everything still arriving. */
  it('refuses to offer the sample while the inbox is still syncing', () => {
    h.preview = { ...(h.preview as object), syncInProgress: true }
    open()

    expect(screen.getByRole('button', { name: /Try a sample of 100/i })).toBeDisabled()
    expect(screen.getByText(/This inbox is still syncing/i)).toBeInTheDocument()
  })

  it('refuses to offer the sample when the scope is empty', () => {
    h.preview = { ...(h.preview as object), count: 0, sampleSize: 0 }
    open()

    expect(screen.getByRole('button', { name: /Try a sample of/i })).toBeDisabled()
    expect(screen.getByText(/Nothing to classify in this range/i)).toBeInTheDocument()
  })
})

describe('InboxReclassifyDialog — sample results (07 §3.3)', () => {
  beforeEach(() => {
    h.status = { jobId: 'j1', state: 'completed', processed: 100, total: 100, report }
  })

  it('leads with the classified / no-category split', () => {
    open()

    expect(
      screen.getByText(/Sampled 100 conversations · 74 classified · 26 no category/i)
    ).toBeInTheDocument()
  })

  /** ⚠️ The zero row IS the finding (`06-…` Q1) — a never-chosen label is one to merge. */
  it('renders a label the model never chose, at zero', () => {
    open()

    expect(screen.getByText('Account')).toBeInTheDocument()
    const row = screen.getByText('Account').parentElement
    expect(row?.textContent).toContain('0')
  })

  /** ⚠️ Abstention is the single most informative number, so it is a ROW. */
  it('renders "No category" as its own row', () => {
    open()

    expect(screen.getByText('No category')).toBeInTheDocument()
  })

  /** Without this the user has the evidence and nowhere to act on it. */
  it('links to the categories so the sample loop can close', () => {
    open()

    expect(screen.getByRole('link', { name: /Adjust my categories/i })).toHaveAttribute(
      'href',
      '/app/settings/tags'
    )
  })

  it('offers a re-sample rather than a size control', async () => {
    open()

    await userEvent.click(screen.getByRole('button', { name: /Sample again/i }))
    expect(h.startSample).toHaveBeenCalled()
  })

  /** 07 invariant 9 — nothing was applied, so there is nothing to undo. */
  it('states that nothing was applied and nothing was marked', () => {
    open()

    expect(screen.getByText(/Nothing was applied and nothing was marked/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
  })

  it('says how many never reached the model rather than implying a full sample', () => {
    h.status = {
      jobId: 'j1',
      state: 'completed',
      processed: 100,
      total: 100,
      report: { ...report, selected: 100, inferred: 88 },
    }
    open()

    expect(screen.getByText(/12 of them never reached the model/i)).toBeInTheDocument()
  })
})

describe('InboxReclassifyDialog — while a sample runs', () => {
  it('replaces the form with progress and offers no second start', () => {
    h.status = { jobId: 'j1', state: 'active', processed: 34, total: 100 }
    open()

    expect(screen.getByText(/Classifying 34 of 100/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try a sample/i })).not.toBeInTheDocument()
  })
})
