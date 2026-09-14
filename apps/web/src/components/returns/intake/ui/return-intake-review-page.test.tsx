// apps/web/src/components/returns/intake/ui/return-intake-review-page.test.tsx
//
// The shell's two load-bearing behaviours (plans/money/tasks/57 §5.3 / §6.3):
// grouping happens AFTER confirmation and an undecided label is in no group,
// and a PARTIAL commit is reported per group rather than as one failure.
//
// Harness per `return-lines-card.test.tsx`: the label card and the `MainPage`
// slot portals are stubbed (each has its own surface and its own test), while
// the grouping summary runs for real — it is the thing under test.

import type {
  ReturnIntakeCommitResult,
  ReturnIntakeDraftView,
  ReturnIntakeLabel,
} from '@auxx/lib/returns/intake/client'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CONTACT_A = 'edf_contact00000000000000000:ein_contacta0000000000000000'
const CONTACT_B = 'edf_contact00000000000000000:ein_contactb0000000000000000'
const ORDER_1 = 'edf_order0000000000000000000:ein_order1000000000000000000'
const ORDER_2 = 'edf_order0000000000000000000:ein_order2000000000000000000'
const RETURN_RECORD = 'edf_return0000000000000000000:ein_return1000000000000000000'

const h = vi.hoisted(() => ({
  draft: null as ReturnIntakeDraftView | null,
  isLoading: false,
  isError: false,
  commitCalls: [] as Array<{ draftId: string; groupIds: string[] }>,
  commitResults: [] as ReturnIntakeCommitResult[],
  commitShouldThrow: false,
  confirmCalls: [] as unknown[],
  patchCalls: [] as unknown[],
  orderOptionCalls: [] as unknown[],
  discardCalls: [] as unknown[],
  confirmAnswer: true,
  invalidateCalls: 0,
  toastErrors: [] as unknown[],
  pushed: [] as string[],
}))

vi.mock('@auxx/ui/components/main-page', () => ({
  MainPageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MainPageAction: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MainPageCrumbs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MainPageBreadcrumbItem: ({ title }: { title: string }) => <span>{title}</span>,
}))

vi.mock('~/components/global/loading-content', () => ({
  LoadingSpinner: () => <div data-testid='loading' />,
}))

vi.mock('~/components/resources', () => ({
  useRecords: () => ({ recordsByKey: new Map(), records: [], isLoading: false }),
}))

vi.mock('@auxx/ui/components/toast', () => ({
  toastError: (args: unknown) => h.toastErrors.push(args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => h.pushed.push(href) }),
}))

// `next/link` prefetches through `IntersectionObserver`, which the jsdom setup
// stubs as a plain function rather than a constructor — the resulting throw
// happens in a passive effect and unmounts the whole tree.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('./return-intake-label-card', () => ({
  ReturnIntakeLabelCard: ({
    label,
    draftId,
    orderOptions,
    onConfirmContact,
    onReopen,
    onPatchTranscription,
  }: {
    label: ReturnIntakeLabel
    draftId: string
    orderOptions: unknown[]
    onConfirmContact: (contactRecordId: never) => void
    onReopen: () => void
    onPatchTranscription: (patch: { senderName?: string | null }) => void
  }) => (
    <div
      data-testid={`card-${label.id}`}
      data-order-options={orderOptions.length}
      data-draft-id={draftId}>
      <button
        type='button'
        data-testid={`confirm-${label.id}`}
        onClick={() => onConfirmContact(CONTACT_A as never)}>
        confirm
      </button>
      <button type='button' data-testid={`reopen-${label.id}`} onClick={onReopen}>
        reopen
      </button>
      <button
        type='button'
        data-testid={`patch-${label.id}`}
        onClick={() => onPatchTranscription({ senderName: 'Meyer GmbH' })}>
        patch
      </button>
    </div>
  ),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      returnIntake: {
        get: {
          invalidate: () => {
            h.invalidateCalls += 1
            return Promise.resolve()
          },
        },
      },
    }),
    returnIntake: {
      get: {
        useQuery: () => ({
          data: h.draft ?? undefined,
          isLoading: h.isLoading,
          isError: h.isError,
        }),
      },
      confirmLabel: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            h.confirmCalls.push(input)
            return Promise.resolve(undefined)
          },
          isPending: false,
        }),
      },
      commit: {
        useMutation: () => ({
          mutateAsync: (input: { draftId: string; groupIds: string[] }) => {
            h.commitCalls.push(input)
            if (h.commitShouldThrow) return Promise.reject(new Error('Redis is gone'))
            return Promise.resolve(h.commitResults)
          },
          isPending: false,
        }),
      },
      patchLabelTranscription: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            h.patchCalls.push(input)
            return Promise.resolve({ ok: true as const })
          },
          isPending: false,
        }),
      },
      orderOptions: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            h.orderOptionCalls.push(input)
            return Promise.resolve([])
          },
          isPending: false,
        }),
      },
      discard: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            h.discardCalls.push(input)
            return Promise.resolve({ ok: true as const })
          },
          isPending: false,
        }),
      },
    },
  },
}))

vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [() => Promise.resolve(h.confirmAnswer), () => null] as const,
}))

import { buildReturnIntakeGroups } from './return-intake-groups'
import { ReturnIntakeReviewPage } from './return-intake-review-page'

function makeLabel(overrides: Partial<ReturnIntakeLabel> = {}): ReturnIntakeLabel {
  return {
    id: 'lbl_1',
    fileRef: 'asset:ast_1',
    fileName: 'IMG_4410.jpg',
    transcription: {
      senderName: 'Jon Weaver',
      senderStreet1: '14 Mill Lane',
      senderStreet2: null,
      senderCity: 'Stratford-on-Avon',
      senderRegion: 'Warwickshire',
      senderPostalCode: 'CV37 6AB',
      senderCountry: 'GB',
      carrier: 'DPD',
      trackingNumber: 'DPD0099123',
      ourReferenceRaw: null,
      recipientNameRaw: null,
      legible: true,
    },
    error: null,
    candidates: [
      {
        contactRecordId: CONTACT_A as never,
        contactName: 'Jon Weaver',
        contactPlace: 'Stratford-on-Avon',
        orderRecordId: ORDER_1 as never,
        orderNumber: 'SO-1043',
        tier: 'address',
      },
    ],
    bestTier: 'address',
    looksOutbound: false,
    confirmedContactRecordId: null,
    confirmedOrderRecordId: null,
    confirmedUnidentified: false,
    ...overrides,
  }
}

function makeDraft(labels: ReturnIntakeLabel[]): ReturnIntakeDraftView {
  return {
    id: 'drf_1',
    status: 'ready',
    phase: 'ready',
    labelsRead: labels.length,
    labelsTotal: labels.length,
    failureReason: null,
    payload: { labels, orderOptions: {} },
    createdAt: '2026-09-13T09:00:00.000Z',
    updatedAt: '2026-09-13T09:00:00.000Z',
  }
}

beforeEach(() => {
  h.draft = null
  h.isLoading = false
  h.isError = false
  h.commitCalls = []
  h.commitResults = []
  h.commitShouldThrow = false
  h.confirmCalls = []
  h.patchCalls = []
  h.orderOptionCalls = []
  h.discardCalls = []
  h.confirmAnswer = true
  h.invalidateCalls = 0
  h.toastErrors = []
  h.pushed = []
})

/**
 * 🛑 The group id is a WIRE FORMAT shared with
 * `packages/lib/src/returns/intake/group.ts`, which `commit({ groupIds })`
 * re-derives from the same labels.
 *
 * ⤵️ There is now exactly ONE derivation: this screen re-exports `groupLabels`
 * from the client-safe leaf subpath `@auxx/lib/returns/intake/group`, so the id
 * cannot drift by construction. These literals stay anyway, as a CHANGE
 * DETECTOR on the wire format itself — `commit({ groupIds })` sends these
 * strings over the wire, so changing the separator or a prefix silently breaks
 * any draft a worker already has open, and this test is what says so.
 */
describe('group id parity with lib/returns/intake/group.ts', () => {
  const idOf = (label: Parameters<typeof makeLabel>[0]) =>
    buildReturnIntakeGroups([makeLabel(label)])[0]?.id

  it('an identified label keys on grp|contact|order', () => {
    expect(
      idOf({
        confirmedContactRecordId: CONTACT_A as never,
        confirmedOrderRecordId: ORDER_1 as never,
      })
    ).toBe(`grp|${CONTACT_A}|${ORDER_1}`)
  })

  it('no order leaves the last segment empty, not the word "none"', () => {
    expect(idOf({ confirmedContactRecordId: CONTACT_A as never })).toBe(`grp|${CONTACT_A}|`)
  })

  it('an unidentified label keys on unid|labelId', () => {
    expect(idOf({ id: 'lbl_9', confirmedUnidentified: true })).toBe('unid|lbl_9')
  })

  it('🛑 a colon separator would be ambiguous — a RecordId is defId:instanceId', () => {
    // Pinned because the temptation to "tidy" the separator to `:` is real and
    // the damage is invisible: `grp:def:inst:def:inst` cannot be split back.
    const id = idOf({
      confirmedContactRecordId: CONTACT_A as never,
      confirmedOrderRecordId: ORDER_1 as never,
    })
    expect(id?.split('|')).toHaveLength(3)
  })
})

describe('grouping happens after confirmation (§5.3)', () => {
  it('an undecided label is named as undecided and is in no group', () => {
    h.draft = makeDraft([
      makeLabel({
        id: 'lbl_1',
        confirmedContactRecordId: CONTACT_A as never,
        confirmedOrderRecordId: ORDER_1 as never,
      }),
      makeLabel({
        id: 'lbl_2',
        fileName: 'IMG_4411.jpg',
        confirmedContactRecordId: CONTACT_A as never,
        confirmedOrderRecordId: ORDER_1 as never,
      }),
      // Its ladder proposed CONTACT_A too. Nobody confirmed it, so it groups
      // with nothing — this is the merge §5.3 refuses to make silently.
      makeLabel({ id: 'lbl_3', fileName: 'IMG_4412.jpg' }),
    ])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    expect(screen.getByTestId('group-summary')).toHaveTextContent('2 labels → 1 return')
    expect(screen.getByTestId('undecided-count')).toHaveTextContent('1 still undecided')
    expect(screen.getByTestId('undecided-lbl_3')).toHaveTextContent('IMG_4412.jpg')
  })

  it('same customer, two orders is two returns (§5.2)', () => {
    h.draft = makeDraft([
      makeLabel({
        id: 'lbl_1',
        confirmedContactRecordId: CONTACT_A as never,
        confirmedOrderRecordId: ORDER_1 as never,
      }),
      makeLabel({
        id: 'lbl_2',
        confirmedContactRecordId: CONTACT_A as never,
        confirmedOrderRecordId: ORDER_2 as never,
      }),
    ])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    expect(screen.getByTestId('group-summary')).toHaveTextContent('2 labels → 2 returns')
  })

  it('confirmedUnidentified still produces a group, one per label (§4.6 / §5.1)', () => {
    h.draft = makeDraft([
      makeLabel({ id: 'lbl_1', confirmedUnidentified: true }),
      makeLabel({ id: 'lbl_2', confirmedUnidentified: true }),
    ])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    // Two unidentified pallets are not one return merely because both are
    // unidentified — that would be grouping on the absence of information.
    expect(screen.getByTestId('group-summary')).toHaveTextContent('2 labels → 2 returns')
    expect(screen.getAllByText('Unidentified sender')).toHaveLength(2)
    expect(screen.queryByTestId('undecided-count')).not.toBeInTheDocument()
  })

  it('the button offers only what the answers add up to', () => {
    h.draft = makeDraft([
      makeLabel({ id: 'lbl_1', confirmedContactRecordId: CONTACT_A as never }),
      makeLabel({ id: 'lbl_2' }),
    ])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    expect(screen.getByRole('button', { name: 'Create 1 return' })).toBeInTheDocument()
  })
})

describe('partial commit is real and is shown as such (§6.3)', () => {
  const threeGroups = () =>
    makeDraft([
      makeLabel({ id: 'lbl_1', confirmedContactRecordId: CONTACT_A as never }),
      makeLabel({ id: 'lbl_2', confirmedContactRecordId: CONTACT_B as never }),
      makeLabel({ id: 'lbl_3', confirmedUnidentified: true }),
    ])

  it('reports per group, so two real RMAs do not read as a failure', async () => {
    h.draft = threeGroups()
    h.commitResults = [
      {
        groupId: `grp|${CONTACT_A}|`,
        returnRecordId: RETURN_RECORD as never,
        returnNumber: 'RMA-1041',
        error: null,
      },
      {
        groupId: `grp|${CONTACT_B}|`,
        returnRecordId: null,
        returnNumber: null,
        error: 'Over the return ceiling',
      },
      {
        groupId: 'unid|lbl_3',
        returnRecordId: RETURN_RECORD as never,
        returnNumber: 'RMA-1042',
        error: null,
      },
    ]

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Create 3 returns' }))

    const results = await screen.findByTestId('commit-results')
    expect(results).toHaveTextContent('2 of 3 created, 1 refused')
    expect(screen.getByTestId(`result-grp|${CONTACT_A}|`)).toHaveTextContent('RMA-1041')
    expect(screen.getByTestId('result-unid|lbl_3')).toHaveTextContent('RMA-1042')
    expect(screen.getByTestId(`result-grp|${CONTACT_B}|`)).toHaveTextContent(
      'Over the return ceiling'
    )
    // No toast: nothing about this call failed as a whole.
    expect(h.toastErrors).toEqual([])
  })

  it('retry sends only the groups that failed', async () => {
    h.draft = threeGroups()
    h.commitResults = [
      {
        groupId: `grp|${CONTACT_A}|`,
        returnRecordId: RETURN_RECORD as never,
        returnNumber: 'RMA-1041',
        error: null,
      },
      {
        groupId: `grp|${CONTACT_B}|`,
        returnRecordId: null,
        returnNumber: null,
        error: 'Over the return ceiling',
      },
      {
        groupId: 'unid|lbl_3',
        returnRecordId: RETURN_RECORD as never,
        returnNumber: 'RMA-1042',
        error: null,
      },
    ]

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Create 3 returns' }))

    const retry = await screen.findByRole('button', { name: 'Retry 1 return' })
    await userEvent.click(retry)

    expect(h.commitCalls).toHaveLength(2)
    expect(h.commitCalls[1]).toEqual({ draftId: 'drf_1', groupIds: [`grp|${CONTACT_B}|`] })
  })

  it('a call that fails outright toasts and creates no result rows', async () => {
    h.draft = threeGroups()
    h.commitShouldThrow = true

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Create 3 returns' }))

    await waitFor(() => expect(h.toastErrors).toHaveLength(1))
    expect(screen.queryByTestId('commit-results')).not.toBeInTheDocument()
  })
})

describe('typing a label in by hand (§4.6)', () => {
  it('sends the patch against this draft and this label, then re-reads the draft', async () => {
    h.draft = makeDraft([makeLabel({ id: 'lbl_1' })])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByTestId('patch-lbl_1'))

    await waitFor(() => expect(h.patchCalls).toHaveLength(1))
    expect(h.patchCalls[0]).toEqual({
      draftId: 'drf_1',
      labelId: 'lbl_1',
      senderName: 'Meyer GmbH',
    })
    // The card renders from the draft, so the typed values only come back by
    // re-reading it — the same path every other answer on this screen takes.
    expect(h.invalidateCalls).toBeGreaterThan(0)
  })

  it('hands the card its draft, which is what authorizes the photo preview (§7.2)', () => {
    h.draft = makeDraft([makeLabel({ id: 'lbl_1' })])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    expect(screen.getByTestId('card-lbl_1')).toHaveAttribute('data-draft-id', 'drf_1')
  })
})

describe('confirming a label (§4.5)', () => {
  it('saves the answer, then reads the contact orders once', async () => {
    h.draft = makeDraft([makeLabel({ id: 'lbl_1' })])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByTestId('confirm-lbl_1'))

    await waitFor(() => expect(h.orderOptionCalls).toHaveLength(1))
    expect(h.confirmCalls[0]).toEqual({
      draftId: 'drf_1',
      labelId: 'lbl_1',
      contactRecordId: CONTACT_A,
    })
    expect(h.orderOptionCalls[0]).toEqual({ draftId: 'drf_1', contactRecordId: CONTACT_A })
  })

  it('an empty order-options answer is passed down as normal, not as an error', async () => {
    // ⚠️ This is TODAY's answer for every customer: `fulfillment` rows do not
    // exist until task 55's re-sync runs, so the list is empty for everyone.
    h.draft = makeDraft([makeLabel({ id: 'lbl_1', confirmedContactRecordId: CONTACT_A as never })])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    expect(screen.getByTestId('card-lbl_1')).toHaveAttribute('data-order-options', '0')
    expect(h.toastErrors).toEqual([])
    expect(screen.getByTestId('group-summary')).toHaveTextContent('1 label → 1 return')
  })

  it('does not re-read order options the draft already cached', async () => {
    const draft = makeDraft([makeLabel({ id: 'lbl_1' })])
    draft.payload.orderOptions = {
      [CONTACT_A]: [
        { orderRecordId: ORDER_1 as never, orderNumber: 'SO-1043', lastFulfilledAt: null },
      ],
    }
    h.draft = draft

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByTestId('confirm-lbl_1'))

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1))
    expect(h.orderOptionCalls).toEqual([])
  })

  it('Change clears the answer on the draft, not just in the card', async () => {
    h.draft = makeDraft([makeLabel({ id: 'lbl_1', confirmedContactRecordId: CONTACT_A as never })])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByTestId('reopen-lbl_1'))

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1))
    expect(h.confirmCalls[0]).toEqual({
      draftId: 'drf_1',
      labelId: 'lbl_1',
      contactRecordId: null,
      unidentified: false,
      orderRecordId: null,
    })
  })
})

describe('discard', () => {
  it('asks first, and writes nothing when the answer is no', async () => {
    h.draft = makeDraft([makeLabel({ id: 'lbl_1' })])
    h.confirmAnswer = false

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(h.discardCalls).toEqual([]))
    expect(h.pushed).toEqual([])
  })

  it('discards and leaves when confirmed', async () => {
    h.draft = makeDraft([makeLabel({ id: 'lbl_1' })])

    render(<ReturnIntakeReviewPage draftId='drf_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(h.discardCalls).toEqual([{ draftId: 'drf_1' }]))
    expect(h.pushed).toEqual(['/app/returns'])
  })
})

describe('draft states', () => {
  it('an expired draft is a first-class state with a way out, not a toast', () => {
    h.isError = true

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    expect(screen.getByText('This label draft has expired')).toBeInTheDocument()
    expect(h.toastErrors).toEqual([])
  })

  it('a failed read names the reason it failed', () => {
    h.draft = { ...makeDraft([]), status: 'failed', failureReason: 'No vision-capable model' }

    render(<ReturnIntakeReviewPage draftId='drf_1' />)

    expect(screen.getByText('No vision-capable model')).toBeInTheDocument()
  })
})
