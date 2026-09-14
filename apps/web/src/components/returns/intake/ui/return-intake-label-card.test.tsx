// apps/web/src/components/returns/intake/ui/return-intake-label-card.test.tsx
//
// The card's refusals, pinned (plans/money/tasks/57 §4.4 / §4.5 / §4.6 / §4.7),
// following `return-lines-card.test.tsx`'s harness: heavy leaves with surfaces
// of their own (the photo preview, the relationship picker, the tooltip shell)
// are stubbed to their props; everything the brief argues about — what is
// pre-selected, what warns, what creates a return anyway — runs for real.

import {
  EMPTY_TRANSCRIBED_LABEL,
  type ReturnIntakeLabel,
  type ReturnIntakeOrderOption,
  type TranscribedLabel,
} from '@auxx/lib/returns/intake/client'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CONTACT_A = 'edf_contact00000000000000000:ein_contacta0000000000000000'
const CONTACT_B = 'edf_contact00000000000000000:ein_contactb0000000000000000'
const SEARCHED_CONTACT = 'edf_contact00000000000000000:ein_searched0000000000000000'
const ORDER_1 = 'edf_order0000000000000000000:ein_order1000000000000000000'
const ORDER_2 = 'edf_order0000000000000000000:ein_order2000000000000000000'

const h = vi.hoisted(() => ({
  confirmedContacts: [] as string[],
  unidentifiedCalls: 0,
  reopenCalls: 0,
  chosenOrders: [] as (string | null)[],
  patches: [] as unknown[],
}))

vi.mock('~/components/attachments/attachment-preview', () => ({
  AttachmentPreview: ({
    id,
    scope,
  }: {
    id: string
    scope?: { kind: string; draftId?: string }
  }) => (
    <div
      data-testid={`photo-${id}`}
      data-scope-kind={scope?.kind ?? 'files'}
      data-scope-draft={scope?.draftId ?? ''}
    />
  ),
}))

vi.mock('@auxx/ui/components/tooltip', () => ({
  SimpleTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Two shapes behind one adapter, told apart by the value the card passes: the
// contact picker takes an array of `RecordId`s, the manual-entry rows take a
// string. Stubbing them as one control would make the typed-in label untestable.
vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value: unknown
    onChange: (value: unknown) => void
    placeholder?: string
    disabled?: boolean
  }) =>
    Array.isArray(value) ? (
      <button
        type='button'
        data-testid='contact-search'
        disabled={disabled}
        onClick={() => onChange([SEARCHED_CONTACT])}>
        {placeholder ?? 'picker'}
      </button>
    ) : (
      <input
        value={String(value ?? '')}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
}))

import { ReturnIntakeLabelCard } from './return-intake-label-card'

const LEGIBLE: TranscribedLabel = {
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
  recipientNameRaw: 'Auxx Lift Ltd',
  legible: true,
}

function makeLabel(overrides: Partial<ReturnIntakeLabel> = {}): ReturnIntakeLabel {
  return {
    id: 'lbl_1',
    fileRef: 'asset:ast_1',
    fileName: 'IMG_4410.jpg',
    transcription: LEGIBLE,
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
      {
        contactRecordId: CONTACT_B as never,
        contactName: 'Jonathan Weaver',
        contactPlace: 'Coventry',
        orderRecordId: null,
        orderNumber: null,
        tier: 'name',
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

const DRAFT_ID = 'drf_1'

function cardProps(
  label: ReturnIntakeLabel,
  orderOptions: ReturnIntakeOrderOption[] = [],
  isLoadingOrderOptions = false
) {
  return {
    label,
    draftId: DRAFT_ID,
    index: 1,
    total: 3,
    orderOptions,
    isLoadingOrderOptions,
    onConfirmContact: (id: never) => h.confirmedContacts.push(id),
    onConfirmUnidentified: () => {
      h.unidentifiedCalls += 1
    },
    onReopen: () => {
      h.reopenCalls += 1
    },
    onChooseOrder: (id: string | null) => h.chosenOrders.push(id),
    onPatchTranscription: (patch: unknown) => h.patches.push(patch),
  }
}

function renderCard(
  label: ReturnIntakeLabel,
  orderOptions: ReturnIntakeOrderOption[] = [],
  isLoadingOrderOptions = false
) {
  return render(
    <ReturnIntakeLabelCard {...cardProps(label, orderOptions, isLoadingOrderOptions)} />
  )
}

beforeEach(() => {
  h.confirmedContacts = []
  h.unidentifiedCalls = 0
  h.reopenCalls = 0
  h.chosenOrders = []
  h.patches = []
})

describe('nothing auto-links (§4.4)', () => {
  it('pre-selects no candidate, however strong the tier', () => {
    renderCard(makeLabel())

    // Both candidates are offered, neither is chosen, and the card still says
    // it needs an answer.
    expect(screen.getByRole('button', { name: /Jon Weaver/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Jonathan Weaver/ })).toBeInTheDocument()
    expect(screen.getByTestId('status-lbl_1')).toHaveTextContent('Needs confirming')
    expect(screen.queryByTestId('decided-lbl_1')).not.toBeInTheDocument()
    expect(h.confirmedContacts).toEqual([])
  })

  it('the tier is only a badge — the address hit is still a tap', async () => {
    renderCard(makeLabel())

    await userEvent.click(screen.getByRole('button', { name: /Jon Weaver/ }))

    expect(h.confirmedContacts).toEqual([CONTACT_A])
  })

  it('the free search is an escape hatch, not a default', async () => {
    renderCard(makeLabel())

    expect(screen.getByTestId('contact-search')).toHaveTextContent('Someone else...')
    await userEvent.click(screen.getByTestId('contact-search'))

    expect(h.confirmedContacts).toEqual([SEARCHED_CONTACT])
  })
})

describe('not one of ours (§4.6)', () => {
  it('offers the outcome as a decision, not a dead end', async () => {
    renderCard(makeLabel({ candidates: [], bestTier: 'none' }))

    await userEvent.click(screen.getByTestId('unidentified-lbl_1'))

    expect(h.unidentifiedCalls).toBe(1)
  })

  it('once taken, says a return is still created and keeps the read sender', () => {
    renderCard(makeLabel({ confirmedUnidentified: true, candidates: [], bestTier: 'none' }))

    expect(screen.getByTestId('status-lbl_1')).toHaveTextContent('Not one of ours')
    const decided = screen.getByTestId('decided-lbl_1')
    expect(decided).toHaveTextContent('This still becomes a return')
    expect(decided).toHaveTextContent('Jon Weaver')
    expect(decided).toHaveTextContent('14 Mill Lane')
  })

  it('Change re-opens the question and clears the stored answer', async () => {
    renderCard(makeLabel({ confirmedUnidentified: true }))

    await userEvent.click(screen.getByTestId('reopen-lbl_1'))

    // Instant locally, and the answer is cleared on the draft too — a Change
    // that only re-opened the picker would leave a match the worker had just
    // called wrong standing in the group summary.
    expect(screen.getByTestId('candidates-lbl_1')).toBeInTheDocument()
    expect(h.reopenCalls).toBe(1)
    expect(h.confirmedContacts).toEqual([])
    expect(h.unidentifiedCalls).toBe(0)
  })
})

describe('looksOutbound warns, never blocks (§4.7)', () => {
  it('shows the warning and leaves every answer available', async () => {
    renderCard(makeLabel({ looksOutbound: true }))

    expect(screen.getByTestId('outbound-warning-lbl_1')).toHaveTextContent(
      'This looks like an outbound label'
    )

    await userEvent.click(screen.getByRole('button', { name: /Jon Weaver/ }))
    expect(h.confirmedContacts).toEqual([CONTACT_A])

    expect(screen.getByTestId('unidentified-lbl_1')).not.toBeDisabled()
  })
})

describe('an illegible label is a different, calmer state (§3.2)', () => {
  const BLANK: TranscribedLabel = { ...EMPTY_TRANSCRIBED_LABEL, legible: false }

  it('says nothing could be read instead of showing an empty transcription', () => {
    renderCard(makeLabel({ transcription: BLANK, candidates: [], bestTier: 'none' }))

    expect(screen.getByTestId('illegible-lbl_1')).toHaveTextContent(
      'Nothing could be read off this label'
    )
    // No tier badge on a photo the model could not read — a ranking over nothing
    // would be a claim the card cannot support.
    expect(screen.queryByText('No match')).not.toBeInTheDocument()
    // Still fully answerable.
    expect(screen.getByTestId('unidentified-lbl_1')).toBeInTheDocument()
  })
})

/**
 * 🛑 Gap 2: §4.6 says "fill `senderNameRaw` and `senderAddressRaw` from the
 * transcription", and `commit.ts` reads exactly `label.transcription` for both.
 * With no way to type one in, the unannounced pallet — the case this feature
 * exists for — produced a return with nothing identifying on it at all.
 */
describe('an illegible label can be typed in (§4.6)', () => {
  const BLANK: TranscribedLabel = { ...EMPTY_TRANSCRIBED_LABEL, legible: false }

  const illegible = (transcription: TranscribedLabel = BLANK) =>
    makeLabel({ transcription, candidates: [], bestTier: 'none' })

  function type(field: string, text: string) {
    return userEvent.type(
      within(screen.getByTestId(`manual-lbl_1-${field}`)).getByRole('textbox'),
      text
    )
  }

  it('offers the printed fields, so the sender is not lost with the photo', async () => {
    renderCard(illegible())

    await type('senderName', 'Meyer GmbH')
    await type('senderStreet1', '9 Hafenstrasse')
    await userEvent.click(screen.getByTestId('save-transcription-lbl_1'))

    expect(h.patches).toEqual([{ senderName: 'Meyer GmbH', senderStreet1: '9 Hafenstrasse' }])
  })

  it('⚠️ sends a PARTIAL patch — the street without the name does not blank the name', async () => {
    renderCard(illegible({ ...BLANK, senderName: 'Meyer GmbH' }))

    await type('senderCity', 'Bremen')
    await userEvent.click(screen.getByTestId('save-transcription-lbl_1'))

    // Only the key the worker touched. `senderName` is absent, not null.
    expect(h.patches).toEqual([{ senderCity: 'Bremen' }])
  })

  it('clears a field as an explicit null rather than an empty string', async () => {
    renderCard(illegible({ ...BLANK, senderName: 'Wrong' }))

    await userEvent.clear(
      within(screen.getByTestId('manual-lbl_1-senderName')).getByRole('textbox')
    )
    await userEvent.click(screen.getByTestId('save-transcription-lbl_1'))

    expect(h.patches).toEqual([{ senderName: null }])
  })

  it('Save is inert until something actually changed', async () => {
    renderCard(illegible({ ...BLANK, senderName: 'Meyer GmbH' }))

    expect(screen.getByTestId('save-transcription-lbl_1')).toBeDisabled()
    await type('senderName', '!')
    expect(screen.getByTestId('save-transcription-lbl_1')).not.toBeDisabled()
  })

  it('🛑 never presents typed text as the model’s reading', async () => {
    // What the draft looks like after a save: still `legible: false`, because
    // the writer never touches the model's own answer.
    renderCard(illegible({ ...BLANK, senderName: 'Meyer GmbH', senderStreet1: '9 Hafenstrasse' }))

    const panel = screen.getByTestId('manual-entry-lbl_1')
    expect(panel).toHaveTextContent('Read off the photo by hand')
    expect(panel).toHaveTextContent('nothing below is a machine read')
    // And it has stopped claiming nothing could be read, which would be the
    // other half of the lie.
    expect(screen.queryByTestId('illegible-lbl_1')).not.toBeInTheDocument()
    // Still no tier badge: the ladder ran on a label the model could not read.
    expect(screen.queryByText('Address match')).not.toBeInTheDocument()
  })

  it('a label the model DID read stays read-only — nothing edits a transcription', () => {
    renderCard(makeLabel())

    expect(screen.queryByTestId('manual-entry-lbl_1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('save-transcription-lbl_1')).not.toBeInTheDocument()
    expect(screen.getByTestId('label-card-lbl_1')).toHaveTextContent('14 Mill Lane')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('⚠️ a label whose CALL failed can be typed in too', () => {
    renderCard(makeLabel({ transcription: null, error: 'the provider refused this HEIC' }))

    expect(screen.getByTestId('manual-entry-lbl_1')).toBeInTheDocument()
    // The failure is still said out loud beside it.
    expect(screen.getByText('This photo could not be read')).toBeInTheDocument()
  })

  it('a label still being read offers nothing to type into yet', () => {
    renderCard(makeLabel({ transcription: null, error: null }))

    expect(screen.queryByTestId('manual-entry-lbl_1')).not.toBeInTheDocument()
    expect(screen.getByText(/Still reading this label/)).toBeInTheDocument()
  })
})

/**
 * 🛑 Gap 1: the default `files` preview scope runs `FeatureKey.files` +
 * `filesView`, so a dock account with returns access and no Files app saw an
 * empty pane and no reason why — on the screen whose whole job is checking a
 * transcription against the photo.
 */
describe('the photo authorizes against the draft, not the Files app (§7.2)', () => {
  it('previews under the returnIntakeDraft scope, carrying this draft', () => {
    renderCard(makeLabel())

    const photo = screen.getByTestId('photo-ast_1')
    expect(photo).toHaveAttribute('data-scope-kind', 'returnIntakeDraft')
    expect(photo).toHaveAttribute('data-scope-draft', DRAFT_ID)
  })
})

describe('the order, after the contact is confirmed (§4.5)', () => {
  const option = (recordId: string, number: string): ReturnIntakeOrderOption => ({
    orderRecordId: recordId as never,
    orderNumber: number,
    lastFulfilledAt: null,
  })

  it('zero options is normal, not an error', () => {
    renderCard(makeLabel({ confirmedContactRecordId: CONTACT_A as never }), [])

    expect(screen.getByTestId('no-orders-lbl_1')).toHaveTextContent(
      'No shipped order found for this customer'
    )
    expect(h.chosenOrders).toEqual([])
  })

  it('exactly one shipped order preselects it, and it stays changeable', () => {
    renderCard(makeLabel({ confirmedContactRecordId: CONTACT_A as never }), [
      option(ORDER_1, 'SO-1043'),
    ])

    expect(h.chosenOrders).toEqual([ORDER_1])
    expect(screen.getByRole('button', { name: 'No order' })).toBeInTheDocument()
  })

  it('several options preselect nothing', () => {
    renderCard(makeLabel({ confirmedContactRecordId: CONTACT_A as never }), [
      option(ORDER_1, 'SO-1043'),
      option(ORDER_2, 'SO-1099'),
    ])

    expect(h.chosenOrders).toEqual([])
    expect(screen.getByText('Which order is it from?')).toBeInTheDocument()
  })

  it('does not re-preselect an order the worker cleared', () => {
    const label = makeLabel({ confirmedContactRecordId: CONTACT_A as never })
    const { rerender } = renderCard(label, [option(ORDER_1, 'SO-1043')])
    expect(h.chosenOrders).toEqual([ORDER_1])

    // The draft comes back with the order still null — the worker cleared it.
    rerender(<ReturnIntakeLabelCard {...cardProps(label, [option(ORDER_1, 'SO-1043')])} />)

    expect(h.chosenOrders).toEqual([ORDER_1])
  })

  it('there is no order question until a contact is confirmed', () => {
    renderCard(makeLabel(), [option(ORDER_1, 'SO-1043')])

    expect(screen.queryByTestId('orders-lbl_1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('no-orders-lbl_1')).not.toBeInTheDocument()
    expect(h.chosenOrders).toEqual([])
  })
})
