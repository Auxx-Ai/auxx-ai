// apps/web/src/components/dynamic-table/utils/cell-renderers.test.tsx
//
// C6 (multi-email plan): the EMAIL/PHONE/URL cell renderers' array branches,
// and the `unwrapValue` options hop above them — `renderCellValue` must thread
// `config.options` into `formatToRawValue`, or a multi field whose store value
// is a SINGLE TypedFieldValue unwraps to a scalar and the array branch never
// fires (shape flip-flops between one value and two).

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderCellValue } from './cell-renderers'

/** TypedFieldValue in store shape (only the fields the converters read). */
function typed(value: string) {
  return { id: `fv-${value}`, type: 'text', value }
}

describe('renderCellValue — EMAIL array branch', () => {
  it('renders every address of a TypedFieldValue[] as chips (primary first)', () => {
    render(
      <>
        {renderCellValue([typed('a@x.com'), typed('b@x.com')], 'EMAIL', undefined, {
          options: { multi: true },
        })}
      </>
    )
    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    expect(screen.getByText('b@x.com')).toBeInTheDocument()
  })

  it('the :740 options hop — a SINGLE TypedFieldValue on a multi field still renders through the array branch', () => {
    const { container } = render(
      <>{renderCellValue(typed('a@x.com'), 'EMAIL', undefined, { options: { multi: true } })}</>
    )
    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    // The array branch renders ItemsCellView (ExpandableCell mode='items'),
    // never the scalar branch's mode='horizontal' wrapper.
    expect(container.querySelector('[data-expand="items"]')).toBeTruthy()
    expect(container.querySelector('[data-expand="horizontal"]')).toBeNull()
  })

  it('collapses overflow into +N', () => {
    const values = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'].map(typed)
    render(<>{renderCellValue(values, 'EMAIL', undefined, { options: { multi: true } })}</>)
    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    expect(screen.getByText('c@x.com')).toBeInTheDocument()
    expect(screen.queryByText('d@x.com')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('keeps the scalar branch for non-multi fields', () => {
    render(<>{renderCellValue(typed('a@x.com'), 'EMAIL')}</>)
    expect(screen.getByText('a@x.com')).toBeInTheDocument()
  })
})

describe('renderCellValue — PHONE/URL array branches', () => {
  it('renders every phone value, display-formatted', () => {
    render(
      <>
        {renderCellValue([typed('+12125551234'), typed('+13105556789')], 'PHONE_INTL', undefined, {
          options: { multi: true },
        })}
      </>
    )
    // Formatted display (national grouping) — assert on raw fragments that
    // survive any format: last four digits of each number.
    expect(screen.getByText(/1234/)).toBeInTheDocument()
    expect(screen.getByText(/6789/)).toBeInTheDocument()
  })

  it('renders every URL value', () => {
    render(
      <>
        {renderCellValue([typed('https://a.com'), typed('https://b.com')], 'URL', undefined, {
          options: { multi: true },
        })}
      </>
    )
    expect(screen.getByText('https://a.com')).toBeInTheDocument()
    expect(screen.getByText('https://b.com')).toBeInTheDocument()
  })
})
