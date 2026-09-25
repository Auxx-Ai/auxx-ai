// apps/web/src/components/manufacturing/builds/backflush-dialog.test.tsx

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  preview: {
    data: {
      days: ['2026-09-20', '2026-09-21', '2026-09-22'],
      builds: [
        { partId: 'lift', partName: 'Attic Lift', day: '2026-09-20', quantity: 3 },
        { partId: 'lift', partName: 'Attic Lift', day: '2026-09-21', quantity: 2 },
        { partId: 'bench', partName: 'Bench', day: '2026-09-22', quantity: 1 },
      ],
      buildCount: 3,
      unitCount: 6,
      skipped: 4,
      failedDays: [],
    },
    isPending: false,
    isError: false,
    error: null,
  },
  run: vi.fn(async () => ({ queued: true })),
  lastInput: null as unknown,
}))

vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: ({ value }: { value: unknown }) => (
    <input readOnly value={String(value ?? '')} />
  ),
}))
vi.mock('~/components/global/forms/field-panel', () => ({
  FieldPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldPanelRow: ({ title, children }: { title: string; children: ReactNode }) => (
    <label>
      {title}
      {children}
    </label>
  ),
}))
vi.mock('~/components/workflow/types', () => ({ BaseType: { DATE: 'date' } }))
vi.mock('~/trpc/react', () => ({
  api: {
    builds: {
      previewBackflush: {
        useQuery: (input: unknown) => {
          h.lastInput = input
          return h.preview
        },
      },
      runBackflush: { useMutation: () => ({ mutateAsync: h.run, isPending: false }) },
    },
  },
}))

import { BackflushDialog } from './backflush-dialog'

const FULL_PREVIEW = h.preview

beforeEach(() => {
  h.lastInput = null
  h.preview = FULL_PREVIEW
})

describe('BackflushDialog', () => {
  it('previews the builds the range would write and queues the run on confirm', async () => {
    const from = new Date('2026-09-20T12:00:00.000Z')
    const to = new Date('2026-09-22T12:00:00.000Z')
    render(
      <BackflushDialog open onOpenChange={vi.fn()} range={{ from, to, partName: 'Attic Lift' }} />
    )

    expect(screen.getByText('Backflush past sales for Attic Lift')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByTestId('backflush-summary').textContent).toContain(
        'Would write 3 builds across 2 parts (6 units over 3 days)'
      )
    )
    expect(screen.getByText('Bench')).toBeTruthy()

    fireEvent.click(screen.getByText('Backflush'))
    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(1))
    // Days, never instants: an instant at UTC midnight reads as the day before west of UTC.
    expect(h.run.mock.calls[0]).toEqual([{ from: '2026-09-20', to: '2026-09-22' }])
    expect(await screen.findByText(/Queued/)).toBeTruthy()
  })

  it('has nothing to confirm when the preview is empty', () => {
    h.preview = {
      ...h.preview,
      data: { ...h.preview.data, builds: [], buildCount: 0, unitCount: 0 },
    }
    render(<BackflushDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByText(/Nothing to build in this range/)).toBeTruthy()
    expect((screen.getByText('Backflush').closest('button') as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
