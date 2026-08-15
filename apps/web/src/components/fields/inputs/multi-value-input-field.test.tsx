// apps/web/src/components/fields/inputs/multi-value-input-field.test.tsx
//
// C6 (multi-email plan): the two wrappers around MultiValuePicker.
//
// - `MultiValueInputField` (panel popover): saves are debounced whole-array
//   `commitValue` calls, and the pending state MUST flush through the
//   provider's `onBeforeClose` hook when the popover dismisses — otherwise a
//   quick edit-then-click-away silently drops the change.
// - `FieldInputAdapter` multi branch (create dialog path): a multi EMAIL field
//   routes to `MultiValueFieldInput` and its onChange emits WHOLE ARRAYS —
//   this is what makes the create dialog write arrays.

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  global.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver
})

// ── panel path: PropertyProvider context is mocked, the picker runs for real ──
const h = vi.hoisted(() => ({
  ctx: null as any,
}))

vi.mock('../property-provider', () => ({
  usePropertyContext: () => h.ctx,
}))
vi.mock('../field-navigation-context', () => ({
  useFieldNavigationOptional: () => null,
}))
// Reads the org settings blob off the dehydrated-state provider, which THROWS
// outside its context — the wrappers call it for the phone arm's country.
vi.mock('./use-org-business-country', () => ({
  useOrgBusinessCountry: () => 'US',
}))

// Heavy siblings of the adapter's multi branch — not under test here.
vi.mock('~/components/records/record-editor-dialog', () => ({
  RecordEditorDialog: () => null,
}))
vi.mock('~/components/shared/multi-relation-input', () => ({
  MultiRelationInput: () => null,
}))
vi.mock('~/components/pickers/actor-picker/actor-picker', () => ({
  ActorPicker: () => null,
}))
vi.mock('~/components/pickers/participant-picker', () => ({
  ParticipantPicker: () => null,
}))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ canEditEntity: () => true }),
}))

const { MultiValueInputField } = await import('./multi-value-input-field')
const { FieldInputAdapter } = await import('./field-input-adapter')

function makePropertyContext(value: unknown) {
  return {
    value,
    field: {
      id: 'field-email',
      key: 'primaryEmail',
      name: 'Email',
      type: 'string',
      fieldType: 'EMAIL',
      options: { multi: true },
      readOnly: false,
    },
    recordId: 'widget:inst-1',
    commitValue: vi.fn(),
    close: vi.fn(),
    onBeforeClose: { current: undefined as (() => void) | undefined },
  }
}

describe('MultiValueInputField (panel popover)', () => {
  it('flushes the pending debounced save through onBeforeClose on dismiss', async () => {
    h.ctx = makePropertyContext(['a@x.com'])
    render(<MultiValueInputField />)

    await userEvent.type(screen.getByPlaceholderText('Search or add email...'), 'b@x.com')
    await userEvent.click(screen.getByText(/^Add "/))

    // Debounced — nothing committed yet.
    expect(h.ctx.commitValue).not.toHaveBeenCalled()

    // Popover dismiss runs the registered onBeforeClose → immediate flush.
    act(() => {
      h.ctx.onBeforeClose.current?.()
    })
    expect(h.ctx.commitValue).toHaveBeenCalledTimes(1)
    expect(h.ctx.commitValue).toHaveBeenCalledWith(['a@x.com', 'b@x.com'])
  })

  it('commits the whole array after the debounce window without a dismiss', async () => {
    h.ctx = makePropertyContext(['a@x.com'])
    render(<MultiValueInputField />)

    await userEvent.type(screen.getByPlaceholderText('Search or add email...'), 'b@x.com')
    await userEvent.click(screen.getByText(/^Add "/))

    await vi.waitFor(() => {
      expect(h.ctx.commitValue).toHaveBeenCalledWith(['a@x.com', 'b@x.com'])
    })
  })

  it('set-as-primary inside the popover reorders before commit (move-to-front)', async () => {
    h.ctx = makePropertyContext(['a@x.com', 'b@x.com'])
    render(<MultiValueInputField />)

    await userEvent.click(screen.getByTitle('Set as primary'))
    act(() => {
      h.ctx.onBeforeClose.current?.()
    })
    expect(h.ctx.commitValue).toHaveBeenCalledWith(['b@x.com', 'a@x.com'])
  })

  // The server rewrites what it stores (E.164, lowercased email) and the
  // provider re-derives `value` from the store. Without this sync the popover
  // keeps showing what was TYPED until it is closed and reopened.
  it('adopts the server-normalized list into an open popover', async () => {
    h.ctx = makePropertyContext(['5102055536'])
    const { rerender } = render(<MultiValueInputField />)
    expect(screen.getByText('5102055536')).toBeInTheDocument()

    // Same field, server echo with the normalized value.
    h.ctx = { ...h.ctx, value: ['+15102055536'] }
    rerender(<MultiValueInputField />)

    await vi.waitFor(() => {
      expect(screen.getByText('+15102055536')).toBeInTheDocument()
    })
    expect(screen.queryByText('5102055536')).not.toBeInTheDocument()
  })

  it('a debounce that already fired does not block a later sync', async () => {
    h.ctx = makePropertyContext(['a@x.com'])
    const { rerender } = render(<MultiValueInputField />)

    await userEvent.type(screen.getByPlaceholderText('Search or add email...'), 'b@x.com')
    await userEvent.click(screen.getByText(/^Add "/))
    // Let the 300ms debounce fire on its own — this is what used to leave a
    // dead timer id in the ref forever.
    await vi.waitFor(() => {
      expect(h.ctx.commitValue).toHaveBeenCalledWith(['a@x.com', 'b@x.com'])
    })

    h.ctx = { ...h.ctx, value: ['a@x.com', 'b@x.com', 'c@x.com'] }
    rerender(<MultiValueInputField />)

    await vi.waitFor(() => {
      expect(screen.getByText('c@x.com')).toBeInTheDocument()
    })
  })
})

describe('FieldInputAdapter — multi EMAIL branch (create dialog path)', () => {
  it('routes options.multi EMAIL to the value-list input and writes WHOLE ARRAYS', async () => {
    const onChange = vi.fn()
    render(
      <FieldInputAdapter
        fieldType='EMAIL'
        fieldOptions={{ multi: true }}
        value={['a@x.com']}
        onChange={onChange}
      />
    )

    // Trigger shows the existing value as a chip; open the picker. (The
    // adapter threads its own placeholder default through to the picker.)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.type(screen.getByPlaceholderText('Enter value...'), 'b@x.com')
    await userEvent.click(screen.getByText(/^Add "/))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['a@x.com', 'b@x.com'])
  })

  it('keeps the scalar EMAIL branch (plain input) when options.multi is absent', () => {
    render(<FieldInputAdapter fieldType='EMAIL' value='a@x.com' onChange={vi.fn()} />)
    // The scalar branch renders a text input, not the picker trigger.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  // The trigger chips used to render the raw stored string, so a correctly
  // stored E.164 number ignored the field's own `phoneFormat` and read as
  // `+15102055536` — inconsistent with DisplayPhone and the table cell.
  it('display-formats multi PHONE chips per the field phoneFormat', () => {
    render(
      <FieldInputAdapter
        fieldType='PHONE_INTL'
        fieldOptions={{ multi: true, phoneFormat: 'international' }}
        value={['+15102055536']}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('+1 510 205 5536')).toBeInTheDocument()
    expect(screen.queryByText('+15102055536')).not.toBeInTheDocument()
  })
})
