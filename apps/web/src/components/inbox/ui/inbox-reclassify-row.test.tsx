// apps/web/src/components/inbox/ui/inbox-reclassify-row.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The backlog row (07 §3.1) — the WHOLE discovery mechanism for retroactive
 * classification.
 *
 * There is no completion event left to hang a prompt on for an inbox that
 * finished syncing last week (07 §2.9), so if this row is wrong the feature is
 * invisible. Three rules, each of which fails silently:
 *
 *  - **The second line is required** (07 invariant 11). "Classify existing mail"
 *    reads as "apply my automations to old mail" to most people.
 *  - **The dialog is never auto-opened** (07 invariant 12). A dialog asking for
 *    money one click after a toggle is a dark pattern; the row is the prompt.
 *  - **A capped backlog reads `1,000+`** (07 R-Q5) — an order of magnitude for a
 *    decision, not a billing figure.
 */

const h = vi.hoisted(() => ({
  backlog: { count: 1204, capped: false, cap: 1000 } as Record<string, unknown> | undefined,
  status: null as Record<string, unknown> | null,
  runStatus: null as Record<string, unknown> | null,
  cancel: vi.fn(),
  cancelRun: vi.fn(),
  undoRun: vi.fn(),
  invalidate: vi.fn(),
  confirm: vi.fn(async () => true),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      mailClassification: {
        getBacklog: { invalidate: h.invalidate },
        getReclassifySampleStatus: { invalidate: h.invalidate },
        getReclassifyRunStatus: { invalidate: h.invalidate },
      },
    }),
    mailClassification: {
      getBacklog: { useQuery: () => ({ data: h.backlog }) },
      getReclassifySampleStatus: { useQuery: () => ({ data: h.status }) },
      getReclassifyRunStatus: { useQuery: () => ({ data: h.runStatus }) },
      cancelReclassifySample: { useMutation: () => ({ mutate: h.cancel, isPending: false }) },
      cancelReclassifyRun: { useMutation: () => ({ mutate: h.cancelRun, isPending: false }) },
      undoReclassifyRun: { useMutation: () => ({ mutate: h.undoRun, isPending: false }) },
    },
  },
}))

vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [h.confirm, () => null],
}))

/**
 * The dialog is exercised by its own file; here it is a marker, so this file
 * asserts only WHEN it opens — which is the invariant-12 question.
 */
vi.mock('./inbox-reclassify-dialog', () => ({
  InboxReclassifyDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid='reclassify-dialog' /> : null,
}))

const { InboxReclassifyRow } = await import('./inbox-reclassify-row')

beforeEach(() => {
  h.backlog = { count: 1204, capped: false, cap: 1000 }
  h.status = null
  h.runStatus = null
})

describe('InboxReclassifyRow — the standing affordance', () => {
  it('states the backlog and, REQUIRED, that filters will not run on it', () => {
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.getByText(/1,204 older conversations have never been classified/)).toBeVisible()
    expect(
      screen.getByText(
        /Labels older mail for search and reporting\. Your filters will not run on it\./
      )
    ).toBeVisible()
  })

  /** ⚠️ 07 R-Q5 — past the cap the count is genuinely unknown, so it says so. */
  it('renders a capped backlog as 1,000+', () => {
    h.backlog = { count: 1000, capped: true, cap: 1000 }
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.getByText(/1,000\+ older conversations/)).toBeVisible()
  })

  it('disappears entirely when there is no backlog and nothing running', () => {
    h.backlog = { count: 0, capped: false, cap: 1000 }
    const { container } = render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(container).toBeEmptyDOMElement()
  })

  /** ⚠️ 07 invariant 12 — the row is the prompt, the dialog is a click away. */
  it('never opens the cost dialog on its own', async () => {
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.queryByTestId('reclassify-dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Classify/i }))
    expect(screen.getByTestId('reclassify-dialog')).toBeInTheDocument()
  })
})

describe('InboxReclassifyRow — while a sample runs', () => {
  beforeEach(() => {
    h.status = { jobId: 'j1', state: 'active', processed: 340, total: 1204 }
  })

  it('becomes the progress surface with a cancel', async () => {
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.getByText(/Classifying a sample: 340 of 1,204/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(h.cancel).toHaveBeenCalledWith({ inboxId: 'ibx_1' })
  })

  /** A run in flight keeps the row alive even with the backlog counted at zero. */
  it('stays visible while running even with an empty backlog', () => {
    h.backlog = { count: 0, capped: false, cap: 1000 }
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.getByText(/Classifying a sample/)).toBeVisible()
  })
})

describe('InboxReclassifyRow — after a sample', () => {
  it('reports the outcome and offers the results, not another start', () => {
    h.status = {
      jobId: 'j1',
      state: 'completed',
      processed: 100,
      total: 100,
      report: { applied: false, selected: 100, classified: 74, abstained: 26, labels: [] },
    }
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.getByText(/Sample finished: 74 of 100 got a category/)).toBeVisible()
    expect(screen.getByRole('button', { name: /View results/i })).toBeInTheDocument()
  })
})

/**
 * ⚠️ The regression this section exists for: a run the worker DIED under used to
 * render as one that never happened.
 *
 * `runReport` is only populated for `completed`, so a `failed` job fell through
 * to the backlog branch and the row said "N older conversations have never been
 * classified" — the run visibly vanished. That is not an exotic state: every
 * deploy kills an active run, and every dev `--watch` restart does too. And it
 * is not only cosmetic, because a run killed partway has already applied tags
 * that somebody may want back.
 */
describe('an interrupted run', () => {
  beforeEach(() => {
    h.runStatus = {
      jobId: 'j1',
      state: 'failed',
      processed: 340,
      total: 1204,
      startedAtIso: '2026-08-11T01:44:00.000Z',
    }
  })

  it('says it stopped rather than falling back to the backlog copy', () => {
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.getByText(/Run interrupted after 340 of 1,204/i)).toBeInTheDocument()
    expect(screen.queryByText(/have never been classified/i)).not.toBeInTheDocument()
  })

  /**
   * The undo key comes off the job's PROGRESS, not its report — progress
   * survives a failure, a return value does not. Without it the tags an
   * interrupted run applied would be unreachable.
   */
  it('still offers undo, keyed off the progress-carried start time', async () => {
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    await userEvent.click(screen.getByRole('button', { name: /^Undo$/i }))
    expect(h.undoRun).toHaveBeenCalledWith({
      inboxId: 'ibx_1',
      sinceIso: '2026-08-11T01:44:00.000Z',
    })
  })

  it('offers to resume, and says resuming does not pay twice', () => {
    render(<InboxReclassifyRow inboxId='ibx_1' />)

    expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument()
    expect(screen.getByText(/picks up where it left off/i)).toBeInTheDocument()
  })
})
