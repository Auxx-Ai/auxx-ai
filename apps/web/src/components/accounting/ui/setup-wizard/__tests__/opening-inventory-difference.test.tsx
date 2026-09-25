// apps/web/src/components/accounting/ui/setup-wizard/__tests__/opening-inventory-difference.test.tsx

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  confirm: vi.fn(async () => true),
  setInBooks: vi.fn(),
  post: vi.fn(),
  adopt: vi.fn(async () => ({ results: [{ partId: 'motor', ok: true }] })),
  invalidate: vi.fn(),
}))

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('~/hooks/use-settings', () => ({
  useSettings: () => ({
    getSetting: (key: string) => (key === 'organization.currency' ? 'USD' : null),
  }),
}))
vi.mock('~/hooks/use-confirm', () => ({ useConfirm: () => [h.confirm, () => null] }))
vi.mock('~/components/global/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: ({
    value,
    onChange,
    placeholder,
  }: {
    value: number | null
    onChange: (value: unknown) => void
    placeholder?: string
  }) => (
    <input
      type='number'
      aria-label='count'
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  ),
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ ledger: { openingInventory: { read: { invalidate: h.invalidate } } } }),
    ledger: {
      openingInventory: {
        read: { useQuery: () => ({ data: h.data, isPending: false, isError: false }) },
        setInBooks: { useMutation: () => ({ mutate: h.setInBooks, isPending: false }) },
        post: { useMutation: () => ({ mutate: h.post, isPending: false }) },
        adoptChannelCounts: { useMutation: () => ({ mutateAsync: h.adopt, isPending: false }) },
      },
    },
  },
}))

import {
  adjustDisabledReason,
  creditAccountLabel,
  dayAfter,
  OpeningInventoryDifference,
} from '../opening-inventory-difference'

function difference(overrides: Record<string, unknown> = {}) {
  return {
    cutoverDate: '2025-12-31',
    inBooks: null,
    needsAnswer: true,
    providerOpeningMinor: 5_000_000,
    postedDifferencesMinor: 0,
    postedDifferenceCount: 0,
    partsValueAtCutoverMinor: 4_800_000,
    deltaMinor: -200_000,
    rows: [],
    byPart: [{ partId: 'lift', name: 'Attic Lift', qtyAtCutover: 42, valueMinor: 4_800_000 }],
    uncounted: [{ partId: 'motor', name: 'Motor', throughputAtCutover: 830 }],
    pendingRows: 0,
    ...overrides,
  }
}

beforeEach(() => {
  h.data = difference()
})

function renderScreen() {
  return render(
    <TooltipProvider>
      <OpeningInventoryDifference />
    </TooltipProvider>
  )
}

describe('OpeningInventoryDifference', () => {
  it('asks the in-books question once and holds the press until it is answered', () => {
    renderScreen()
    expect(screen.getByTestId('difference-headline').textContent).toContain('Books say $50,000.00')
    expect(screen.getByText('Was this inventory on your old books?')).toBeTruthy()
    const adjust = screen.getByText('Adjust the books').closest('button') as HTMLButtonElement
    expect(adjust.disabled).toBe(true)
    expect(screen.getByText(/Answer whether this inventory was on your old books/)).toBeTruthy()

    fireEvent.click(screen.getByText('Never on my books'))
    expect(h.setInBooks).toHaveBeenCalledWith({ inBooks: 'opening_equity' })
  })

  it('lists uncounted parts and adopts the typed channel counts', async () => {
    renderScreen()
    expect(screen.getByText('Motor')).toBeTruthy()
    expect(screen.getByText('830')).toBeTruthy()

    fireEvent.click(screen.getAllByText('Adopt channel count')[0]!)
    const input = await screen.findByLabelText('count')
    fireEvent.change(input, { target: { value: '120' } })
    fireEvent.click(screen.getByText(/^Adopt 1 count/))

    await waitFor(() =>
      expect(h.adopt).toHaveBeenCalledWith({ counts: [{ partId: 'motor', quantity: 120 }] })
    )
    await waitFor(() => expect(h.invalidate).toHaveBeenCalled())
  })

  it('posts the delta after a confirm that names the entry', async () => {
    h.data = difference({ inBooks: 'revaluation', needsAnswer: false })
    renderScreen()
    expect(screen.getByText('5092 Inventory Revaluation')).toBeTruthy()

    const adjust = screen.getByText('Adjust the books').closest('button') as HTMLButtonElement
    expect(adjust.disabled).toBe(false)
    fireEvent.click(adjust)
    await waitFor(() => expect(h.post).toHaveBeenCalled())
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          'Cr Inventory $2,000.00 against 5092 Inventory Revaluation, dated 2026-01-01, exported'
        ),
      })
    )
  })

  it('holds the press when the books and the parts agree', () => {
    h.data = difference({ inBooks: 'opening_equity', needsAnswer: false, deltaMinor: 0 })
    renderScreen()
    expect(screen.getByText(/nothing to post/)).toBeTruthy()
  })
})

describe('helpers', () => {
  it('names the credit account per answer', () => {
    expect(creditAccountLabel('revaluation')).toBe('5092 Inventory Revaluation')
    expect(creditAccountLabel('opening_equity')).toBe('3900 Opening Balance Equity')
  })

  it('dates the entry the day after the cutover', () => {
    expect(dayAfter('2025-12-31')).toBe('2026-01-01')
    expect(dayAfter('2026-02-28')).toBe('2026-03-01')
  })

  it('gives the reason the press is held', () => {
    expect(adjustDisabledReason(difference() as never)).toMatch(/Answer/)
    expect(
      adjustDisabledReason(difference({ needsAnswer: false, deltaMinor: 0 }) as never)
    ).toMatch(/agree/)
    expect(adjustDisabledReason(difference({ needsAnswer: false }) as never)).toBeNull()
  })
})
