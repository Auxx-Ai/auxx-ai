// apps/web/src/components/mail/email-editor/recipient-input.test.tsx
//
// The compose recipient picker on `api.search.recipients` — participants ∪
// contacts, one ranked read. Each suggestion IS one identifier (`Participant` is
// unique on `(organizationId, identifier, identifierType)`), so there is no
// record-to-addresses fan-out left to test: a contact with two addresses arrives
// as two rows, and excluding one is set membership on a string.
//
// The user-visible behaviours the old record-picker tests pinned still hold and
// are still covered here, one layer down: a contact with two addresses is
// reachable at both, and an address already in the field is not offered again.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhoneRegion } from './identifier-model'

interface CandidateStub {
  identifier: string
  identifierType: 'EMAIL' | 'PHONE'
  displayName: string
  contactId: string | null
  source: 'participant' | 'contact'
  score: number
}

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  candidates: [] as unknown[],
  /** Every `{ query, model, region }` the component asked the endpoint for. */
  queryInputs: [] as unknown[],
}))

vi.mock('~/trpc/react', () => ({
  api: {
    search: {
      recipients: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled !== false) h.queryInputs.push(input)
          return {
            data: { candidates: h.candidates, truncated: false },
            isFetching: false,
          }
        },
      },
    },
  },
}))

vi.mock('@auxx/ui/components/toast', () => ({ toastError: h.toastError }))

vi.mock('~/components/global/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./editor-active-state-context', () => ({
  useEditorActiveStateContext: () => ({
    trackPopoverOpen: vi.fn(),
    trackPopoverClose: vi.fn(),
  }),
}))

const { RecipientInput } = await import('./recipient-input')

/** One participant row for Ada, addressable at `identifier`. */
function participant(identifier: string, overrides: Partial<CandidateStub> = {}): CandidateStub {
  return {
    identifier,
    identifierType: 'EMAIL',
    displayName: 'Ada Lovelace',
    contactId: 'c1',
    source: 'participant',
    score: 1,
    ...overrides,
  }
}

function renderInput(
  recipients: Array<{
    id: string
    identifier: string
    identifierType: 'EMAIL'
    recordId?: string
  }>,
  onContactSelect = vi.fn(),
  onAdd = vi.fn(),
  onRemove = vi.fn()
) {
  const utils = render(
    <RecipientInput
      recipients={recipients as never}
      field='TO'
      onAdd={onAdd}
      onRemove={onRemove}
      onMoveTo={vi.fn()}
      onContactSelect={onContactSelect}
      placeholder='To'
    />
  )
  return { ...utils, onContactSelect, onAdd, onRemove }
}

interface PhoneRecipientStub {
  id: string
  identifier: string
  identifierType: 'PHONE'
}

/** Same render, on a `recipientModel: 'phone'` channel (Quo/SMS). */
function renderPhoneInput(
  onAdd = vi.fn(),
  onContactSelect = vi.fn(),
  extra: { defaultRegion?: PhoneRegion; recipients?: PhoneRecipientStub[] } = {}
) {
  const utils = render(
    <RecipientInput
      recipients={(extra.recipients ?? []) as never}
      field='TO'
      onAdd={onAdd}
      onRemove={vi.fn()}
      onMoveTo={vi.fn()}
      onContactSelect={onContactSelect}
      placeholder='To'
      recipientModel='phone'
      defaultRegion={extra.defaultRegion}
    />
  )
  return { ...utils, onAdd, onContactSelect }
}

/** Focus the input and fire a real paste event carrying `text`. */
async function pasteInto(text: string) {
  await userEvent.click(screen.getByLabelText('Add recipient'))
  await userEvent.paste(text)
}

/** Identifiers passed to `onAdd`, in commit order. */
function committedIdentifiers(onAdd: ReturnType<typeof vi.fn>): string[] {
  return onAdd.mock.calls.map((call) => (call[0] as { identifier: string }).identifier)
}

/** Type into the field, which is what opens the suggestion popover. */
async function search(text = 'ada') {
  await userEvent.type(screen.getByLabelText('Add recipient'), text)
}

/**
 * Suggestion rows only. Committed chips are `role='option'` too, so a bare
 * `getAllByRole('option')` counts the badges already in the field.
 */
async function suggestionRows() {
  const list = await screen.findByRole('listbox', { name: /^Recipient / })
  return within(list).getAllByRole('option')
}

beforeEach(() => {
  h.toastError.mockReset()
  h.candidates = []
  h.queryInputs = []
  Element.prototype.scrollIntoView = vi.fn()
})

describe('RecipientInput — suggestions from search.recipients', () => {
  it('commits the picked row identifier and its contactId as recordId', async () => {
    h.candidates = [participant('a@x.com')]
    const { onContactSelect } = renderInput([])

    await search()
    await userEvent.click(await screen.findByRole('option', { name: /Ada Lovelace/ }))

    expect(onContactSelect).toHaveBeenCalledWith({
      // The contact's `EntityInstance.id`, under `recordId` — the chip id is
      // minted by the parent, never the record id (see `RecipientState.id`).
      recordId: 'c1',
      identifier: 'a@x.com',
      identifierType: 'EMAIL',
      name: 'Ada Lovelace',
    })
  })

  // The behaviour the old "Jane has 2 addresses" popover existed to provide,
  // now free: one Participant row per identifier, so both are just rows.
  it('a contact with two addresses is reachable at both', async () => {
    h.candidates = [participant('a@x.com'), participant('b@x.com')]
    const { onContactSelect } = renderInput([])

    await search()
    expect(await suggestionRows()).toHaveLength(2)

    await userEvent.click(screen.getByRole('option', { name: /b@x\.com/ }))
    expect(onContactSelect).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'b@x.com', recordId: 'c1' })
    )
  })

  it('excludes an identifier already in the field, keeping the contact’s others', async () => {
    h.candidates = [participant('a@x.com'), participant('b@x.com')]
    renderInput([{ id: 'r1', identifier: 'a@x.com', identifierType: 'EMAIL' }])

    await search()

    const rows = await suggestionRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('b@x.com')
  })

  it('shows an empty state rather than a dead row when nothing matches', async () => {
    h.candidates = []
    const { onContactSelect } = renderInput([])

    await search('zzz')

    expect(await screen.findByText('No matching email addresses')).toBeInTheDocument()
    expect(onContactSelect).not.toHaveBeenCalled()
  })

  it('carries a null contactId through as recordId: null', async () => {
    h.candidates = [participant('nobody@x.com', { contactId: null, displayName: 'nobody@x.com' })]
    const { onContactSelect } = renderInput([])

    await search()
    await userEvent.click(await screen.findByRole('option', { name: /nobody@x\.com/ }))

    expect(onContactSelect).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: null, name: null })
    )
  })

  it('passes the channel model and region to the endpoint', async () => {
    renderPhoneInput(vi.fn(), vi.fn(), { defaultRegion: 'DE' })

    await search('030')

    expect(h.queryInputs).toContainEqual(expect.objectContaining({ model: 'phone', region: 'DE' }))
  })

  it('arrow keys move the highlight and Enter commits it', async () => {
    h.candidates = [participant('a@x.com'), participant('b@x.com')]
    const { onContactSelect, onAdd } = renderInput([])

    await search()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(onContactSelect).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'b@x.com' }))
    // The typed text is not ALSO committed as a free-typed recipient.
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('Enter with nothing highlighted still commits the typed identifier', async () => {
    h.candidates = [participant('a@x.com')]
    const { onAdd, onContactSelect } = renderInput([])

    await userEvent.type(screen.getByLabelText('Add recipient'), 'brand-new@x.com{Enter}')

    expect(committedIdentifiers(onAdd)).toEqual(['brand-new@x.com'])
    expect(onContactSelect).not.toHaveBeenCalled()
  })
})

// §5: the subtitle is what clicking commits, and it is formatted. The record
// picker showed `secondaryDisplayValue` — an email — on every channel, and
// promoted it to the TITLE when the display name was missing.
describe('RecipientInput — suggestion row shape', () => {
  it('renders the name over the formatted identifier', async () => {
    h.candidates = [
      participant('+14155551234', {
        identifierType: 'PHONE',
        displayName: 'Ada Lovelace',
      }),
    ]
    renderPhoneInput()

    await search('ada')

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('(415) 555-1234')).toBeInTheDocument()
    expect(screen.queryByText('+14155551234')).not.toBeInTheDocument()
  })

  it('renders ONE line when displayName equals the identifier', async () => {
    h.candidates = [
      participant('+14155551234', {
        identifierType: 'PHONE',
        // `calculateDisplayName` falls back to the identifier — ~31% of live rows.
        displayName: '+14155551234',
      }),
    ]
    renderPhoneInput()

    await search('415')

    const [row] = await suggestionRows()
    // The formatted form, exactly once — not the raw string twice.
    expect(row?.textContent).toBe('(415) 555-1234')
  })

  it('marks a contact-arm row as never messaged', async () => {
    h.candidates = [participant('a@x.com', { source: 'contact' })]
    renderInput([])

    await search()

    expect(await screen.findByTitle('You have not messaged this contact before')).toBeVisible()
  })

  it('leaves a participant-arm row unmarked', async () => {
    h.candidates = [participant('a@x.com')]
    renderInput([])

    await search()

    await suggestionRows()
    expect(screen.queryByTitle('You have not messaged this contact before')).not.toBeInTheDocument()
  })
})

// Two addresses of ONE contact is a supported motion — the picker lists one row
// per identifier. It used to produce two chips carrying the SAME id, because
// `handleContactSelect` wrote the contact's `EntityInstance.id` into
// `RecipientState.id`: duplicate React keys, and `onRemove(id)` matching both
// chips in the parent's filter.
describe('two chips sourced from the same contact', () => {
  const bothOfAdas = [
    { id: 'chip-1', identifier: 'a@x.com', identifierType: 'EMAIL' as const, recordId: 'c1' },
    { id: 'chip-2', identifier: 'b@x.com', identifierType: 'EMAIL' as const, recordId: 'c1' },
  ]

  it('renders one badge per address', () => {
    renderInput(bothOfAdas)

    expect(screen.getByRole('option', { name: 'Recipient: a@x.com' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Recipient: b@x.com' })).toBeInTheDocument()
  })

  it('removes only the clicked chip — onRemove gets that chip id, not the shared recordId', async () => {
    const { onRemove } = renderInput(bothOfAdas, vi.fn(), vi.fn(), vi.fn())

    await userEvent.click(screen.getByLabelText('Remove b@x.com'))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith('chip-2')
    expect(onRemove).not.toHaveBeenCalledWith('c1')
  })

  // Worth being precise about what these two tests do and do not cover: they pin
  // the CONTRACT (distinct ids in → the right id back out), not the defect. The
  // defect was the parent minting `id: contactData.id`, and what actually makes
  // that unrepresentable is the type — `onContactSelect` now takes `recordId`,
  // so no caller can hand a record id to the field the badge list keys on.
  // Reproducing the original two-identical-chips state needs the whole editor;
  // the type is the stronger guarantee, so it is deliberately not restated here.
})

// Quo (formerly OpenPhone) is the first channel whose recipient is a phone
// number, not an address. The same input has to accept E.164, reject anything
// libphonenumber can't parse, and commit `PHONE`.
describe('RecipientInput — phone recipientModel', () => {
  it('commits a typed number as E.164 with identifierType PHONE', async () => {
    const { onAdd } = renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), '(415) 555-1234{Enter}')

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: '+14155551234', identifierType: 'PHONE' })
    )
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('rejects an email address with an inline phone-specific hint, not a toast', async () => {
    const { onAdd } = renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), 'a@x.com{Enter}')

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Phone Number')
    // The red toast fired on every Enter with a half-typed number; the hint
    // lives on the field instead.
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('clears the inline hint as soon as typing resumes', async () => {
    renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), '83128{Enter}')
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Add recipient'), '2')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // The dead-row bug this endpoint deletes: a phone-less contact used to render
  // as a clickable row that silently did nothing, with its EMAIL as the
  // subtitle. It cannot reach the list now — the query that would list it is the
  // same query that failed to find a number for it — so there is nothing to
  // filter on the client, and nothing that can show an address on an SMS picker.
  it('never offers an email row on a phone channel', async () => {
    h.candidates = []
    const { onContactSelect } = renderPhoneInput()

    await search('ada')

    expect(await screen.findByText('No matching phone numbers')).toBeInTheDocument()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(onContactSelect).not.toHaveBeenCalled()
  })
})

// Phase 2 of the composer-capabilities plan: phone entry is loosened by passing
// a BETTER default region, never by relaxing `isValid()`. `formatPhoneNumber`
// stays the only normalizer, so these are the regression guard on the region
// argument reaching it.
describe('RecipientInput — free-form phone entry', () => {
  it.each([
    '8312825590',
    '831 282 5590',
    '(831) 282-5590',
    '831.282.5590',
    '1 831 282 5590',
    '+1-831-282-5590 ext 5',
    'tel:+18312825590',
  ])('accepts %j and commits +18312825590', async (typed) => {
    const { onAdd } = renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), `${typed}{Enter}`)

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: '+18312825590', identifierType: 'PHONE' })
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still rejects a 9-digit number — isValid() is the numbering-plan check', async () => {
    const { onAdd } = renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), '831282559{Enter}')

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Phone Number')
  })

  it.each([
    { region: 'DE' as const, typed: '030 901820', e164: '+4930901820' },
    { region: 'GB' as const, typed: '020 7183 8750', e164: '+442071838750' },
  ])('parses a national $region number against defaultRegion=$region', async ({
    region,
    typed,
    e164,
  }) => {
    const { onAdd } = renderPhoneInput(vi.fn(), vi.fn(), { defaultRegion: region })

    await userEvent.type(screen.getByLabelText('Add recipient'), `${typed}{Enter}`)

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ identifier: e164 }))
  })

  it.each([
    '030 901820',
    '020 7183 8750',
  ])('rejects the same national number %j on the default US region', async (typed) => {
    const { onAdd } = renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), `${typed}{Enter}`)

    expect(onAdd).not.toHaveBeenCalled()
  })
})

// Display is formatted; the committed `identifier` is a routing key
// (`Participant.identifier`) and must stay E.164.
describe('RecipientInput — badge formatting vs stored identifier', () => {
  it('commits E.164 while the badge renders the national form', async () => {
    const { onAdd, rerender } = renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), '8312825590{Enter}')

    const committed = onAdd.mock.calls[0]?.[0] as { identifier: string }
    expect(committed.identifier).toBe('+18312825590')

    rerender(
      <RecipientInput
        recipients={[{ ...committed, id: 'r1' }] as never}
        field='TO'
        onAdd={onAdd}
        onRemove={vi.fn()}
        onMoveTo={vi.fn()}
        onContactSelect={vi.fn()}
        placeholder='To'
        recipientModel='phone'
      />
    )

    expect(screen.getByText('(831) 282-5590')).toBeInTheDocument()
    expect(screen.queryByText('+18312825590')).not.toBeInTheDocument()
  })

  it('renders an out-of-region number in international form', () => {
    renderPhoneInput(vi.fn(), vi.fn(), {
      recipients: [{ id: 'r1', identifier: '+442071838750', identifierType: 'PHONE' }],
    })

    expect(screen.getByText('+44 20 7183 8750')).toBeInTheDocument()
  })

  it('leaves an email identifier untouched on the badge', () => {
    renderInput([{ id: 'r1', identifier: 'a@x.com', identifierType: 'EMAIL' }])

    expect(screen.getByText('a@x.com')).toBeInTheDocument()
  })
})

// A pasted list used to land as ONE string: Enter then normalized the whole
// blob, got null, and rejected it. The `','` keydown never fires for a paste,
// so email was affected too.
describe('RecipientInput — pasting a delimited list', () => {
  it.each([',', ';', '\n', '\t'])('splits a pasted email list on %j', async (separator) => {
    const { onAdd } = renderInput([])

    await pasteInto(`a@x.com${separator}b@x.com`)

    expect(committedIdentifiers(onAdd)).toEqual(['a@x.com', 'b@x.com'])
    expect(screen.getByLabelText('Add recipient')).toHaveValue('')
  })

  it.each([',', ';', '\n', '\t'])('splits a pasted phone list on %j', async (separator) => {
    const { onAdd } = renderPhoneInput()

    await pasteInto(`831-282-5590${separator}805-222-7374`)

    expect(committedIdentifiers(onAdd)).toEqual(['+18312825590', '+18052227374'])
    expect(screen.getByLabelText('Add recipient')).toHaveValue('')
  })

  it('commits the valid parts and leaves the rest in the input', async () => {
    const { onAdd } = renderPhoneInput()

    await pasteInto('831-282-5590, not-a-number, 805-222-7374')

    expect(committedIdentifiers(onAdd)).toEqual(['+18312825590', '+18052227374'])
    expect(screen.getByLabelText('Add recipient')).toHaveValue('not-a-number')
  })

  it('drops duplicates within the paste and against existing recipients', async () => {
    const { onAdd } = renderInput([{ id: 'r1', identifier: 'a@x.com', identifierType: 'EMAIL' }])

    await pasteInto('A@x.com, b@x.com, b@x.com')

    expect(committedIdentifiers(onAdd)).toEqual(['b@x.com'])
  })

  it('pastes a single value normally — no commit, text lands in the input', async () => {
    const { onAdd } = renderInput([])

    await pasteInto('a@x.com')

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Add recipient')).toHaveValue('a@x.com')
  })

  it('merges a paste with text already typed in the input', async () => {
    const { onAdd } = renderPhoneInput()

    await userEvent.type(screen.getByLabelText('Add recipient'), '831')
    await userEvent.paste('-282-5590, 805-222-7374')

    expect(committedIdentifiers(onAdd)).toEqual(['+18312825590', '+18052227374'])
  })
})
