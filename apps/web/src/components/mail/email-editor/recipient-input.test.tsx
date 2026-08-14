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

interface PickerItemStub {
  id: string
  recordId: string
  displayName: string
  secondaryInfo?: string
  data: Record<string, unknown>
}

const h = vi.hoisted(() => ({
  batchGet: vi.fn(),
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
  onContactSelect = vi.fn()
) {
  const utils = render(
    <RecipientInput
      recipients={recipients as never}
      field='TO'
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onMoveTo={vi.fn()}
      onContactSelect={onContactSelect}
      placeholder='To'
    />
  )
  return { ...utils, onContactSelect }
}

async function openPickerAndPick(name: string) {
  await userEvent.type(screen.getByLabelText('Add recipient'), 'ada')
  await userEvent.click(await screen.findByRole('button', { name }))
}

beforeEach(() => {
  h.batchGet.mockReset()
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
