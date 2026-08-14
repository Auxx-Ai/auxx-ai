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
})
