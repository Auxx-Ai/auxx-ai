// apps/web/src/components/inbox/ui/mail-classification-retroactive-prompt.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The post-sync prompt (07 §3.4) — the second of §2.9's two discovery triggers.
 *
 * Three rules, each of which fails SILENTLY if it regresses: the banner still
 * renders, still looks right, and is still wrong.
 *
 *  - **Two prompts must never stack**, and the filter one wins. A regression
 *    here shows two blue alerts, which is how people learn to dismiss banners
 *    without reading them.
 *  - **It never starts a run** (07 invariant 12 / R1). The equivalent filter
 *    prompt applies on one click because its action is free; this one spends
 *    money per conversation.
 *  - **It states that filters will not run** (R5 / invariant 11), because
 *    "classify existing mail" reads as "apply my automations to old mail".
 */

const h = vi.hoisted(() => ({
  prompt: null as Record<string, unknown> | null,
  filterPrompt: null as Record<string, unknown> | null,
  dismiss: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      mailClassification: { pendingRetroactivePrompt: { invalidate: h.invalidate } },
    }),
    mailClassification: {
      pendingRetroactivePrompt: { useQuery: () => ({ data: h.prompt }) },
      dismissRetroactivePrompt: {
        useMutation: () => ({ mutate: h.dismiss, isPending: false }),
      },
    },
    mailFilters: {
      pendingRetroactivePrompt: { useQuery: () => ({ data: h.filterPrompt }) },
    },
  },
}))

/** The dialog has its own file; here it is a marker for "did we open it?". */
vi.mock('./inbox-reclassify-dialog', () => ({
  InboxReclassifyDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid='reclassify-dialog' /> : null,
}))

const { MailClassificationRetroactivePrompt } = await import(
  './mail-classification-retroactive-prompt'
)

beforeEach(() => {
  h.prompt = {
    inboxId: 'ibx_1',
    inboxName: 'Support',
    threadCount: 1204,
    threadCountCapped: false,
    labelCount: 6,
  }
  h.filterPrompt = null
  vi.clearAllMocks()
})

describe('MailClassificationRetroactivePrompt', () => {
  it('asks about the inbox by name and count', () => {
    render(<MailClassificationRetroactivePrompt />)

    expect(
      screen.getByText(/Classify 1,204 existing conversations in Support/i)
    ).toBeInTheDocument()
  })

  it('renders nothing when there is nothing to ask', () => {
    h.prompt = null
    const { container } = render(<MailClassificationRetroactivePrompt />)

    expect(container).toBeEmptyDOMElement()
  })

  /**
   * ⚠️ 07 §3.4. The filter prompt is the older feature AND its action mutates
   * routing, whereas this one only labels — so the cheaper, more reversible
   * question is the one that defers.
   */
  it('yields to the mail-filter prompt rather than stacking with it', () => {
    h.filterPrompt = { inboxId: 'ibx_1', filterCount: 2, threadCount: 300 }
    const { container } = render(<MailClassificationRetroactivePrompt />)

    expect(container).toBeEmptyDOMElement()
  })

  /**
   * ⚠️ 07 invariant 12 / R1. The action opens the scope dialog, which states the
   * count and estimated cost. A banner that bills on one click is the dark
   * pattern §2.9 refuses.
   */
  it('opens the scope dialog and never starts a run itself', async () => {
    render(<MailClassificationRetroactivePrompt />)

    expect(screen.queryByTestId('reclassify-dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Choose what to classify/i }))
    expect(screen.getByTestId('reclassify-dialog')).toBeInTheDocument()
  })

  /** ⚠️ R5 / invariant 11 — required copy, not decoration. */
  it('says filters will not run on the classified mail', () => {
    render(<MailClassificationRetroactivePrompt />)

    expect(screen.getByText(/Your filters will not run on it/i)).toBeInTheDocument()
  })

  it('dismisses per inbox', async () => {
    render(<MailClassificationRetroactivePrompt />)

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(h.dismiss).toHaveBeenCalledWith({ inboxId: 'ibx_1' })
  })

  /** 07 R-Q5 — an order of magnitude for a decision, not a billing figure. */
  it('renders a capped count as `1,000+`', () => {
    h.prompt = { ...h.prompt, threadCount: 1000, threadCountCapped: true }
    render(<MailClassificationRetroactivePrompt />)

    expect(screen.getByText(/Classify 1,000\+ existing conversations/i)).toBeInTheDocument()
  })
})
