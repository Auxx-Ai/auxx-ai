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

// ── PHONE_INTL entry: a real phone input, not a search box ──────────────────
//
// The picker's phone arm must normalize through `formatPhoneNumber` (the same
// libphonenumber call the write path runs), so the Add row can never offer a
// value the server would 400 on, and a national number typed without a `+`
// depends on `defaultCountry`.

describe('MultiValuePicker — PHONE_INTL entry', () => {
  it('normalizes a US national number to E.164 on add', async () => {
    const onChange = vi.fn()
    render(<MultiValuePicker fieldType='PHONE_INTL' values={[]} onChange={onChange} />)

    await typeInto(screen.getByPlaceholderText('Enter phone number'), '5102055536')
    await userEvent.click(screen.getByText(/^Add "/))

    expect(onChange).toHaveBeenCalledWith(['+15102055536'])
  })

  it('parses a national number against defaultCountry, not always US', async () => {
    const onChange = vi.fn()
    // Berlin landline in national form — valid as DE, not as US.
    render(
      <MultiValuePicker
        fieldType='PHONE_INTL'
        values={[]}
        onChange={onChange}
        defaultCountry='DE'
      />
    )

    await typeInto(screen.getByPlaceholderText('Enter phone number'), '030901820')
    await userEvent.click(screen.getByText(/^Add "/))

    expect(onChange).toHaveBeenCalledWith(['+4930901820'])
  })

  it('rejects the same national number when the country is US', async () => {
    render(
      <MultiValuePicker fieldType='PHONE_INTL' values={[]} onChange={vi.fn()} defaultCountry='US' />
    )

    await typeInto(screen.getByPlaceholderText('Enter phone number'), '030901820')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()
  })

  it('keeps an impossible number out of the list (isValid, not a length check)', async () => {
    render(<MultiValuePicker fieldType='PHONE_INTL' values={[]} onChange={vi.fn()} />)

    // 555-555-5555 is length-valid but not a real US number.
    await typeInto(screen.getByPlaceholderText('Enter phone number'), '5555555555')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()
  })

  it('treats a differently-formatted duplicate as a duplicate', async () => {
    render(<MultiValuePicker fieldType='PHONE_INTL' values={['+15102055536']} onChange={vi.fn()} />)

    await typeInto(screen.getByPlaceholderText('Enter phone number'), '(510) 205-5536')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()
  })

  it(`hides the Add row at the ${MAX_MULTI_VALUES}-value cap`, async () => {
    // Distinct, individually valid US numbers.
    const values = Array.from({ length: MAX_MULTI_VALUES }, (_, i) => `+1510205553${i}`)
    render(<MultiValuePicker fieldType='PHONE_INTL' values={values} onChange={vi.fn()} />)

    await typeInto(screen.getByPlaceholderText('Enter phone number'), '2136210001')
    expect(screen.queryByText(/^Add "/)).not.toBeInTheDocument()
  })

  it('keeps existing rows visible while a new number is typed', async () => {
    render(<MultiValuePicker fieldType='PHONE_INTL' values={['+15102055536']} onChange={vi.fn()} />)

    await typeInto(screen.getByPlaceholderText('Enter phone number'), '2136210001')
    // `searchValue` is ENTRY text on the phone arm — it must not filter the list.
    // No `phoneFormat` option here, so the converter's default (national) applies.
    expect(screen.getByText('(510) 205-5536')).toBeInTheDocument()
  })
})

describe('MultiValuePicker — entry control by type (scope boundary)', () => {
  it('EMAIL and URL keep the searchable CommandInput', () => {
    const { unmount } = render(
      <MultiValuePicker fieldType='EMAIL' values={[]} onChange={vi.fn()} />
    )
    expect(screen.getByPlaceholderText('Search or add...')).toHaveAttribute('cmdk-input', '')
    unmount()

    render(<MultiValuePicker fieldType='URL' values={[]} onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Search or add...')).toHaveAttribute('cmdk-input', '')
  })

  // The country-select button precedes the number field in the DOM, so a popover
  // focus scope grabs IT on open. Focusing the button here stands in for that —
  // `autoFocus` alone has already fired by this point, so this fails without the
  // picker's own reclaim-on-next-frame effect.
  it('claims the caret back from the country button', async () => {
    render(<MultiValuePicker fieldType='PHONE_INTL' values={[]} onChange={vi.fn()} />)

    const input = screen.getByPlaceholderText('Enter phone number')
    const countryButton = screen.getByLabelText('Select country')

    countryButton.focus()
    expect(document.activeElement).toBe(countryButton)

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(input)
    })
  })

  it('PHONE_INTL renders the flag input instead, with a country selector', () => {
    render(<MultiValuePicker fieldType='PHONE_INTL' values={[]} onChange={vi.fn()} />)

    expect(screen.getByPlaceholderText('Enter phone number')).not.toHaveAttribute('cmdk-input')
    expect(screen.getByLabelText('Select country')).toBeInTheDocument()
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
