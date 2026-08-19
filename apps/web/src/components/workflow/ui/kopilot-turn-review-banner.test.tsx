// apps/web/src/components/workflow/ui/kopilot-turn-review-banner.test.tsx
//
// The Undo banner's copy — plan 20 §5 / §9 phase D, "the turn says why it
// stopped".
//
// The banner is the ONLY place the turn's ending becomes a sentence, and the
// two things worth pinning are both silent failures:
//
//   1. the wording actually differs per ending. A refactor that dropped the
//      switch would still render a banner, still offer the Undo, and read as
//      "stopped early" forever — i.e. exactly the gap this closes, restored
//      without a single test going red;
//   2. an ending of `null` FAILS OPEN. Absence must cost the adjective and
//      never the offer: the buttons stay, the counts stay, only the reason
//      falls back to the generic sentence.
//
// The hook is mocked because the copy is the unit under test — the query, the
// realtime refresh and the two mutations are covered server-side in
// `server/api/routers/workflow-kopilot-turn-review.test.ts`.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { KopilotTurnEnding } from '../hooks/use-kopilot-turn-review'

const h = vi.hoisted(() => ({
  review: {
    pending: true,
    preTurnNodeCount: 6,
    currentNodeCount: 9,
    capturedAt: Date.now() - 5 * 60 * 1000,
    endedAs: null as KopilotTurnEnding | null,
    onKeep: vi.fn(async () => undefined),
    onUndo: vi.fn(async () => undefined),
    isBusy: false,
    refusalMessage: null as string | null,
  },
}))

vi.mock('../hooks/use-kopilot-turn-review', () => ({
  useKopilotTurnReview: () => h.review,
}))

// The confirm dialog is the destructive path's own concern; rendering it here
// would drag in the whole dialog stack for a copy assertion.
vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [vi.fn(async () => true), () => null],
}))

const { KopilotTurnReviewBanner } = await import('./kopilot-turn-review-banner')

function renderWith(endedAs: KopilotTurnEnding | null) {
  h.review.endedAs = endedAs
  render(<KopilotTurnReviewBanner workflowAppId='wf_cuid0000000000000000000' />)
  return screen.getByText(/Kopilot’s last turn/).textContent ?? ''
}

describe('KopilotTurnReviewBanner copy', () => {
  it.each([
    // Resource caps — token budget, iteration cap, approval cap, failure
    // streak. Deliberately NOT "token budget": the capability lifecycle is
    // handed the four-way outcome, never the five-way reason, so naming the
    // budget would be a claim the stored data cannot back.
    ['exhausted' as const, 'ran out of room before it finished'],
    // A client disconnect — a reload or navigating away. There is no stop
    // button in the Kopilot composer.
    ['aborted' as const, 'was interrupted before it finished'],
    ['error' as const, 'hit an error before it finished'],
  ])('%s reads as its own ending', (endedAs, phrase) => {
    expect(renderWith(endedAs)).toContain(phrase)
  })

  it('every ending produces a DISTINCT first sentence', () => {
    const endings: KopilotTurnEnding[] = ['exhausted', 'aborted', 'error']
    const sentences = endings.map((e) => {
      const text = renderWith(e)
      screen.getByText(/Kopilot’s last turn/).remove()
      return text.split('.')[0]
    })
    expect(new Set(sentences).size).toBe(endings.length)
  })

  it('FAILS OPEN with no ending — generic wording, offer intact', () => {
    const text = renderWith(null)
    expect(text).toContain('stopped early')
    // The load-bearing half: absence must never suppress the Undo.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy()
    // ...and the offer still says what it would cost.
    expect(text).toContain('taking it from 9 nodes back to 6')
  })

  it('renders nothing when there is no pending review', () => {
    h.review.pending = false
    const { container } = render(<KopilotTurnReviewBanner workflowAppId='wf_1' />)
    expect(container.textContent).toBe('')
    h.review.pending = true
  })
})
