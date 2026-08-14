// apps/web/src/components/pickers/multi-value-picker.test.tsx
//
// C6 (multi-email plan): the tags-style value-list editor. The load-bearing
// behaviors: the Create row is gated on per-type client validation, hidden for
// duplicates and at the MAX_MULTI_VALUES cap; a bare row click is a NO-OP (it
// must never silently retarget outbound mail); set-as-primary is an explicit
// action that moves the value to index 0; and the panel input flushes its
// debounced whole-array save when the popover dismisses (`onBeforeClose`).

import { MAX_MULTI_VALUES } from '@auxx/lib/field-values/client'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiValuePicker } from './multi-value-picker'

// cmdk scrolls the selected row into view; jsdom has no scrollIntoView. And
// base-ui's ScrollArea (inside CommandList) does `new IntersectionObserver`,
// which the global vi.fn-based mock does not satisfy — use a real class.
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

function typeInto(input: HTMLElement, text: string) {
  return userEvent.type(input, text)
}

describe('MultiValuePicker — Create row gating', () => {
  it('shows the Add row only once the typed value passes EMAIL validation', async () => {
    const onChange = vi.fn()
    render(<MultiValuePicker fieldType='EMAIL' values={['a@x.com']} onChange={onChange} />)

    const input = screen.getByPlaceholderText('Search or add...')

    await typeInto(input, 'not-an-email')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()

    await userEvent.clear(input)
    await typeInto(input, 'b@x.com')
    expect(screen.getByText(/^Add "/)).toBeInTheDocument()

    await userEvent.click(screen.getByText(/^Add "/))
    expect(onChange).toHaveBeenCalledWith(['a@x.com', 'b@x.com'])
  })

  it('hides the Add row when the typed value already exists (case-insensitive)', async () => {
    render(<MultiValuePicker fieldType='EMAIL' values={['a@x.com']} onChange={vi.fn()} />)

    await typeInto(screen.getByPlaceholderText('Search or add...'), 'A@X.com')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()
  })

  it(`hides the Add row at the ${MAX_MULTI_VALUES}-value cap, even for valid input`, async () => {
    const values = Array.from({ length: MAX_MULTI_VALUES }, (_, i) => `v${i}@x.com`)
    render(<MultiValuePicker fieldType='EMAIL' values={values} onChange={vi.fn()} />)

    await typeInto(screen.getByPlaceholderText('Search or add...'), 'new@x.com')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()
  })

  it('lowercases a created email (matches the server hooks)', async () => {
    const onChange = vi.fn()
    render(<MultiValuePicker fieldType='EMAIL' values={[]} onChange={onChange} />)

    await typeInto(screen.getByPlaceholderText('Search or add...'), 'New@X.com')
    await userEvent.click(screen.getByText(/^Add "/))
    expect(onChange).toHaveBeenCalledWith(['new@x.com'])
  })

  it('validates URL input before offering the Add row', async () => {
    const onChange = vi.fn()
    render(<MultiValuePicker fieldType='URL' values={[]} onChange={onChange} />)

    const input = screen.getByPlaceholderText('Search or add...')
    await typeInto(input, 'not a url')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()

    await userEvent.clear(input)
    await typeInto(input, 'example.com')
    expect(screen.getByText(/^Add "/)).toBeInTheDocument()
  })
})

describe('MultiValuePicker — rows', () => {
  it('marks index 0 with the Primary badge', () => {
    render(
      <MultiValuePicker fieldType='EMAIL' values={['a@x.com', 'b@x.com']} onChange={vi.fn()} />
    )
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    expect(screen.getByText('b@x.com')).toBeInTheDocument()
  })

  it('a bare row click never fires onChange (must not retarget outbound mail)', async () => {
    const onChange = vi.fn()
    render(
      <MultiValuePicker fieldType='EMAIL' values={['a@x.com', 'b@x.com']} onChange={onChange} />
    )
    await userEvent.click(screen.getByText('b@x.com'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('"Set as primary" moves the value to the front', async () => {
    const onChange = vi.fn()
    render(
      <MultiValuePicker fieldType='EMAIL' values={['a@x.com', 'b@x.com']} onChange={onChange} />
    )
    // The primary row has no set-primary action, so there is exactly one.
    await userEvent.click(screen.getByTitle('Set as primary'))
    expect(onChange).toHaveBeenCalledWith(['b@x.com', 'a@x.com'])
  })

  it('"Remove" drops the value from the list', async () => {
    const onChange = vi.fn()
    render(
      <MultiValuePicker fieldType='EMAIL' values={['a@x.com', 'b@x.com']} onChange={onChange} />
    )
    const removeButtons = screen.getAllByTitle('Remove')
    expect(removeButtons).toHaveLength(2)
    await userEvent.click(removeButtons[1]!)
    expect(onChange).toHaveBeenCalledWith(['a@x.com'])
  })
})
