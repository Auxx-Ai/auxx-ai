// apps/web/src/components/mail/email-editor/recipient-input.test.tsx
//
// C6 (multi-email plan): the compose recipient picker under the multi-value
// email flip. A picked contact is expanded into its N addresses — the user
// picks WHICH address the mail goes to (a contact with 2 emails yields 2
// address rows) — and the exclude filter keys on ADDRESSES: a contact whose
// primary is already a recipient stays pickable for its other addresses and
// hides only once every known address is a recipient.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhoneRegion } from './identifier-model'

interface PickerItemStub {
  id: string
  recordId: string
  displayName: string
  secondaryInfo?: string
  data: Record<string, unknown>
}

const h = vi.hoisted(() => ({
  batchGet: vi.fn(),
  toastError: vi.fn(),
  pickerItems: [] as unknown[],
}))

vi.mock('~/trpc/react', () => ({
  api: {
    fieldValue: {
      batchGet: { useMutation: () => ({ mutateAsync: h.batchGet }) },
    },
  },
}))

// The record picker's own behavior (search, hydration) is exercised elsewhere;
// this stub renders the item list with the SAME excludeFilter/onSelectItem/
// onResultsChange contract so the expansion + per-address exclude logic is
// what's under test.
vi.mock('~/components/pickers/record-picker/record-picker-content', async () => {
  const { useEffect } = await import('react')
  return {
    RecordPickerContent: ({
      onSelectItem,
      onResultsChange,
      excludeFilter,
    }: {
      onSelectItem: (item: unknown) => void
      onResultsChange?: (items: unknown[]) => void
      excludeFilter?: (item: unknown) => boolean
    }) => {
      useEffect(() => {
        onResultsChange?.(h.pickerItems)
      }, [onResultsChange])
      return (
        <div data-testid='record-picker'>
          {(h.pickerItems as Array<{ id: string; displayName: string }>)
            .filter((item) => !excludeFilter?.(item))
            .map((item) => (
              <button key={item.id} type='button' onClick={() => onSelectItem(item)}>
                {item.displayName}
              </button>
            ))}
        </div>
      )
    },
  }
})

vi.mock('~/components/resources/store/resource-store', () => ({
  useResourceStore: {
    getState: () => ({
      systemAttributeMap: {},
      systemAttributeByDef: {},
      ambiguousSystemAttributes: new Set(),
    }),
  },
}))

vi.mock('~/components/resources/utils/normalize-record-id', () => ({
  getNormalizedRecordId: (id: string) => id,
}))

vi.mock('~/components/resources/utils/resolve-system-attribute', () => ({
  resolveSystemAttributeRef: () => 'contact:field-email',
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

const ADA: PickerItemStub = {
  id: 'c1',
  recordId: 'contact:c1',
  displayName: 'Ada Lovelace',
  secondaryInfo: 'a@x.com',
  data: {},
}

/** batchGet payload for a contact whose primary_email holds the given addresses. */
function emailValues(addresses: string[], recordId = 'contact:c1') {
  return {
    values: [
      {
        recordId,
        fieldRef: 'contact:field-email',
        fieldType: 'EMAIL',
        value: addresses.map((value) => ({ type: 'text', value })),
      },
    ],
  }
}

function renderInput(
  recipients: Array<{ id: string; identifier: string; identifierType: 'EMAIL' }>,
  onContactSelect = vi.fn(),
  onAdd = vi.fn()
) {
  const utils = render(
    <RecipientInput
      recipients={recipients as never}
      field='TO'
      onAdd={onAdd}
      onRemove={vi.fn()}
      onMoveTo={vi.fn()}
      onContactSelect={onContactSelect}
      placeholder='To'
    />
  )
  return { ...utils, onContactSelect, onAdd }
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

async function openPickerAndPick(name: string) {
  await userEvent.type(screen.getByLabelText('Add recipient'), 'ada')
  await userEvent.click(await screen.findByRole('button', { name }))
}

beforeEach(() => {
  h.batchGet.mockReset()
  h.toastError.mockReset()
  h.pickerItems = [ADA]
  Element.prototype.scrollIntoView = vi.fn()
})

describe('RecipientInput — contact expansion into N addresses', () => {
  it('a contact with 2 emails yields 2 address rows; picking one commits that address', async () => {
    h.batchGet.mockResolvedValue(emailValues(['a@x.com', 'b@x.com']))
    const { onContactSelect } = renderInput([])

    await openPickerAndPick('Ada Lovelace')

    // One row per address — the pick must not silently choose one.
    const rowA = await screen.findByRole('option', { name: /a@x\.com/ })
    const rowB = screen.getByRole('option', { name: /b@x\.com/ })
    expect(rowA).toBeVisible()
    expect(rowB).toBeVisible()
    expect(onContactSelect).not.toHaveBeenCalled()

    await userEvent.click(rowB)
    expect(onContactSelect).toHaveBeenCalledWith({
      id: 'c1',
      identifier: 'b@x.com',
      identifierType: 'EMAIL',
      name: 'Ada Lovelace',
    })
  })

  it('a single-address contact commits directly without an address list', async () => {
    h.batchGet.mockResolvedValue(emailValues(['a@x.com']))
    const { onContactSelect } = renderInput([])

    await openPickerAndPick('Ada Lovelace')

    await waitFor(() =>
      expect(onContactSelect).toHaveBeenCalledWith({
        id: 'c1',
        identifier: 'a@x.com',
        identifierType: 'EMAIL',
        name: 'Ada Lovelace',
      })
    )
    expect(screen.queryByRole('option', { name: /a@x\.com/ })).not.toBeInTheDocument()
  })

  it('excludes per ADDRESS: with the primary already a recipient, picking offers only the rest', async () => {
    h.batchGet.mockResolvedValue(emailValues(['a@x.com', 'b@x.com']))
    const { onContactSelect } = renderInput([
      { id: 'r1', identifier: 'a@x.com', identifierType: 'EMAIL' },
    ])

    await openPickerAndPick('Ada Lovelace')

    // Only the not-yet-added address remains — exactly one candidate, so it
    // commits directly.
    await waitFor(() =>
      expect(onContactSelect).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'b@x.com' })
      )
    )
  })

  it('hides the contact from the list once ALL its known addresses are recipients', async () => {
    h.batchGet.mockResolvedValue(emailValues(['a@x.com', 'b@x.com']))
    const { rerender, onContactSelect } = renderInput([
      { id: 'r1', identifier: 'a@x.com', identifierType: 'EMAIL' },
    ])

    // First pick fetches + caches the full address list and commits b@x.com.
    await openPickerAndPick('Ada Lovelace')
    await waitFor(() => expect(onContactSelect).toHaveBeenCalled())

    // With both addresses now recipients, the contact row is excluded.
    rerender(
      <RecipientInput
        recipients={
          [
            { id: 'r1', identifier: 'a@x.com', identifierType: 'EMAIL' },
            { id: 'r2', identifier: 'b@x.com', identifierType: 'EMAIL' },
          ] as never
        }
        field='TO'
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onMoveTo={vi.fn()}
        onContactSelect={onContactSelect}
        placeholder='To'
      />
    )
    await userEvent.type(screen.getByLabelText('Add recipient'), 'ada')
    expect(screen.queryByRole('button', { name: 'Ada Lovelace' })).not.toBeInTheDocument()
  })

  it('falls back to the picker row primary when the field read fails', async () => {
    h.batchGet.mockRejectedValue(new Error('offline'))
    const { onContactSelect } = renderInput([])

    await openPickerAndPick('Ada Lovelace')

    await waitFor(() =>
      expect(onContactSelect).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'a@x.com' })
      )
    )
  })
})

// Quo (formerly OpenPhone) is the first channel whose recipient is a phone
// number, not an address. The same input has to accept E.164, reject anything
// libphonenumber can't parse, commit `PHONE`, and read the contact's
// multi-value `phone` field instead of `primary_email`.
describe('RecipientInput — phone recipientModel', () => {
  /** batchGet payload for a contact whose phone field holds the given numbers. */
  function phoneValues(numbers: string[]) {
    return {
      values: [
        {
          recordId: 'contact:c1',
          fieldRef: 'contact:field-email',
          fieldType: 'PHONE_INTL',
          value: numbers.map((value) => ({ type: 'text', value })),
        },
      ],
    }
  }

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

  it('expands a picked contact into its phone numbers, not its addresses', async () => {
    h.pickerItems = [{ ...ADA, data: { phone: '+14155551234' } }]
    h.batchGet.mockResolvedValue(phoneValues(['+14155551234', '+442071838750']))
    const { onContactSelect } = renderPhoneInput()

    await openPickerAndPick('Ada Lovelace')

    const rowUs = await screen.findByRole('option', { name: /\+14155551234/ })
    expect(rowUs).toBeVisible()
    await userEvent.click(screen.getByRole('option', { name: /\+442071838750/ }))

    expect(onContactSelect).toHaveBeenCalledWith({
      id: 'c1',
      identifier: '+442071838750',
      identifierType: 'PHONE',
      name: 'Ada Lovelace',
    })
  })

  it('never falls back to the row secondaryInfo (an email) when the field read fails', async () => {
    h.pickerItems = [{ ...ADA, data: {} }]
    h.batchGet.mockRejectedValue(new Error('offline'))
    const { onContactSelect } = renderPhoneInput()

    await openPickerAndPick('Ada Lovelace')

    await waitFor(() => expect(screen.getByTestId('record-picker')).toBeInTheDocument())
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
