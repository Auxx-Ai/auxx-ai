// apps/web/src/components/dashboard/ui/dashboard-kopilot-turn-review.test.tsx
//
// The Undo offer for a turn that stopped early (plan v3/04 §8, v3/03 §6).
//
// Two claims, and the first is why the offer is worth having at all:
//
//  - it RUNS ON MOUNT off `dashboard.kopilotTurnReview({ dashboardId })`, whose
//    turn id comes from the snapshot slot server-side. The outcome that most
//    often leaves a revertible snapshot is `aborted`, and `aborted` IS a reload
//    or a navigate-away, so the most common case for the offer is exactly the
//    one where no client ever saw the `ended` event. A turn-pinned input would
//    withhold it precisely when it is needed.
//  - `revertDashboardTurn`'s TWO refusals are two different statements and must
//    never collapse into one message.
//
//   404 - there is no snapshot under this turn id. Nothing to undo, nothing
//         touched, the offer is dead.
//   409 - the snapshot is there but the dashboard moved on since the turn, so
//         undoing would also discard the newer changes. The snapshot is LEFT IN
//         PLACE, so the offer survives and carries the reason.
//
// Collapsing them tells a user whose colleague added a widget that their undo
// "expired", which is both false and unactionable.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  review: null as Record<string, unknown> | null,
  useQuery: vi.fn(),
  mutateAsync: vi.fn(),
  toastError: vi.fn(),
  confirmResult: true,
}))

vi.mock('~/realtime/hooks', () => ({ useOrgChannel: () => true }))

vi.mock('@auxx/ui/components/toast', () => ({ toastError: h.toastError }))

vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [async () => h.confirmResult, () => null],
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      dashboard: {
        get: { invalidate: vi.fn() },
        kopilotTurnReview: { invalidate: vi.fn() },
      },
    }),
    dashboard: {
      kopilotTurnReview: { useQuery: (...args: unknown[]) => h.useQuery(...args) },
      revertKopilotTurn: { useMutation: () => ({ mutateAsync: h.mutateAsync, isPending: false }) },
    },
  },
}))

import { DashboardKopilotTurnReview } from './dashboard-kopilot-turn-review'

const REVIEW = {
  turnId: 'turn-1',
  capturedAt: Date.now() - 60_000,
  endedAs: 'exhausted' as const,
  preTurnWidgetCount: 2,
  currentWidgetCount: 5,
  canvasChangedSinceTurn: false,
}

function renderCard(canEdit = true) {
  return render(<DashboardKopilotTurnReview dashboardId='d1' canEdit={canEdit} />)
}

beforeEach(() => {
  h.review = { ...REVIEW }
  // Faithful to React Query: a disabled query still hands back whatever is in
  // the cache, which is why the component gates on `canEdit` too.
  h.useQuery.mockReset().mockImplementation(() => ({ data: h.review }))
  h.confirmResult = true
  h.mutateAsync.mockReset().mockResolvedValue({ reverted: true })
  h.toastError.mockReset()
})

describe('DashboardKopilotTurnReview', () => {
  it('offers the undo for a turn that stopped early, in the unit the snapshot can prove', () => {
    renderCard()
    expect(screen.getByText(/ran out of room before it finished/)).toBeInTheDocument()
    // Widgets, not "12 edits were applied": the snapshot stores the pre-turn
    // document, never a tool-call log.
    expect(screen.getByText(/from 5 widgets back to 2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Undo Kopilot/ })).toBeEnabled()
  })

  it('renders nothing for a viewer', () => {
    renderCard(false)
    expect(screen.queryByRole('button', { name: /Undo Kopilot/ })).not.toBeInTheDocument()
  })

  it('asks the SERVER for the turn, so the offer survives the reload that caused it', () => {
    renderCard()
    // `{ dashboardId }` only. No turn id: this component may never have seen the
    // turn that left the snapshot, which is the common case for `aborted`.
    expect(h.useQuery.mock.calls[0]?.[0]).toEqual({ dashboardId: 'd1' })
    expect(screen.getByRole('button', { name: /Undo Kopilot/ })).toBeInTheDocument()
  })

  it('reverts the turn the QUERY named, never one re-derived at click time', async () => {
    renderCard()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Undo Kopilot/ }))
    })
    expect(h.mutateAsync).toHaveBeenCalledWith({ dashboardId: 'd1', turnId: 'turn-1' })
  })

  it('renders nothing when the server has no snapshot', () => {
    h.review = null
    renderCard()
    expect(screen.queryByRole('button', { name: /Undo Kopilot/ })).not.toBeInTheDocument()
  })

  it('the query is disabled for a viewer, so it is never even asked', () => {
    renderCard(false)
    expect(h.useQuery.mock.calls[0]?.[1]).toMatchObject({ enabled: false })
  })

  it('a 409 says the dashboard CHANGED, and the offer stays up', async () => {
    h.mutateAsync.mockRejectedValue({ data: { code: 'CONFLICT' } })
    renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Undo Kopilot/ }))
    })
    expect(await screen.findByText(/would also discard the newer changes/)).toBeInTheDocument()
    // Left in place: the snapshot survives a refused revert, so the offer does.
    expect(screen.getByRole('button', { name: /Undo Kopilot/ })).toBeInTheDocument()
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('a 404 says there is NOTHING to undo, and the offer comes down', async () => {
    h.mutateAsync.mockRejectedValue({ data: { code: 'NOT_FOUND' } })
    renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Undo Kopilot/ }))
    })
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1))
    expect(h.toastError.mock.calls[0]?.[0]).toMatchObject({ title: 'Nothing to undo' })
    // Two DIFFERENT sentences: the 409 wording must not appear here.
    expect(screen.queryByText(/would also discard the newer changes/)).not.toBeInTheDocument()
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: /Undo Kopilot/ })).not.toBeInTheDocument()
    )
  })

  it('pre-empts the 409: a dashboard already known to have moved on cannot be undone', () => {
    h.review = { ...REVIEW, canvasChangedSinceTurn: true }
    renderCard()

    expect(screen.getByRole('button', { name: /Undo Kopilot/ })).toBeDisabled()
    expect(screen.getByText(/would also discard the newer changes/)).toBeInTheDocument()
  })

  it('does not revert when the confirm is declined', () => {
    h.confirmResult = false
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: /Undo Kopilot/ }))
    expect(h.mutateAsync).not.toHaveBeenCalled()
  })
})
