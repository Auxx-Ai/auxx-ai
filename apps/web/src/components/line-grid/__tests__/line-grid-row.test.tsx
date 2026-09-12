// apps/web/src/components/line-grid/__tests__/line-grid-row.test.tsx
//
// Pins money/tasks/56 §3.2's hazard: `LineGridRow`'s `data-line-col` is the
// cell's position AMONG NAVIGABLE CELLS, not its position in the `cells`
// array. A `navigable: false` cell (money's read-only amount column on four
// of six documents) must not consume a column number, or every navigable
// cell after it would shift and break Tab order.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LineGridRow } from '../ui/line-grid-row'

describe('LineGridRow', () => {
  it('numbers data-line-col by position among navigable cells only', () => {
    render(
      <LineGridRow
        rowIndex={2}
        cols='1fr 1fr 1fr 1fr'
        grip={null}
        cells={[
          { node: <span>name</span> },
          { node: <span>qty</span>, navigable: false },
          { node: <span>price</span> },
          { node: <span>total</span> },
        ]}
      />
    )

    const name = screen.getByText('name').parentElement
    const qty = screen.getByText('qty').parentElement
    const price = screen.getByText('price').parentElement
    const total = screen.getByText('total').parentElement

    expect(name).toHaveAttribute('data-line-row', '2')
    expect(name).toHaveAttribute('data-line-col', '0')

    // The non-navigable cell carries neither attribute at all.
    expect(qty).not.toHaveAttribute('data-line-row')
    expect(qty).not.toHaveAttribute('data-line-col')

    // `price` is the SECOND navigable cell (array index 2), so its nav column
    // is 1 - not 2, which is what a naive array-index mapping would produce.
    expect(price).toHaveAttribute('data-line-row', '2')
    expect(price).toHaveAttribute('data-line-col', '1')

    expect(total).toHaveAttribute('data-line-row', '2')
    expect(total).toHaveAttribute('data-line-col', '2')
  })

  it('renders every cell as navigable by default', () => {
    render(
      <LineGridRow
        rowIndex={0}
        cols='1fr 1fr'
        grip={null}
        cells={[{ node: <span>a</span> }, { node: <span>b</span> }]}
      />
    )

    expect(screen.getByText('a').parentElement).toHaveAttribute('data-line-col', '0')
    expect(screen.getByText('b').parentElement).toHaveAttribute('data-line-col', '1')
  })
})
