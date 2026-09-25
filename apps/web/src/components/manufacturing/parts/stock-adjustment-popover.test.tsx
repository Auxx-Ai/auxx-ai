// apps/web/src/components/manufacturing/parts/stock-adjustment-popover.test.tsx
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  standardCost: null as number | null,
  loading: false,
  readFor: null as string | null,
}))

vi.mock('~/trpc/react', () => ({
  api: {
    purchasing: {
      adjustStock: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}))
vi.mock('~/components/resources', () => ({
  toRecordId: (defId: string, id: string) => `${defId}:${id}`,
  useResourceProperty: (slug: string) => `def-${slug}`,
}))
vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: (recordId: string | null) => {
    state.readFor = recordId
    return { values: { part_standard_cost: state.standardCost }, isLoading: state.loading }
  },
}))
vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: () => <div />,
}))
vi.mock('~/components/global/forms/field-panel', () => ({
  FieldPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldPanelRow: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
}))
vi.mock('~/components/workflow/types', () => ({
  BaseType: { ENUM: 'enum', NUMBER: 'number', STRING: 'string' },
}))

import { StockAdjustmentForm } from './stock-adjustment-popover'

const NOTE = 'Valued when this part gets a cost.'

beforeEach(() => {
  state.standardCost = null
  state.loading = false
  state.readFor = null
})

describe('StockAdjustmentForm', () => {
  it('says the movement is valued later when the part has no standard cost', () => {
    render(<StockAdjustmentForm partId='p1' currentQoH={4} onDone={vi.fn()} />)
    expect(state.readFor).toBe('def-part:p1')
    expect(screen.getByText(NOTE)).toBeTruthy()
    // Save is gated on the delta alone (zero here), never on the standard: the server writes
    // the movement pending rather than refusing it.
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/cannot adjust|no standard cost/i)).toBeNull()
  })

  it('shows no note while the standard is loading, or once the part has one', () => {
    state.loading = true
    const { unmount } = render(<StockAdjustmentForm partId='p1' currentQoH={4} onDone={vi.fn()} />)
    expect(screen.queryByText(NOTE)).toBeNull()
    unmount()
    state.loading = false
    state.standardCost = 1250
    render(<StockAdjustmentForm partId='p1' currentQoH={4} onDone={vi.fn()} />)
    expect(screen.queryByText(NOTE)).toBeNull()
  })
})
