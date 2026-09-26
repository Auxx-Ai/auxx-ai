// apps/web/src/components/manufacturing/builds/backflush-dialog.test.tsx

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  preview: {
    data: {
      dayCount: 3,
      buildCount: 3,
      unitCount: 6,
      skipped: 4,
      failedDays: [],
      parts: [
        { partId: 'lift', partName: 'Attic Lift', builds: 2, units: 5 },
        { partId: 'bench', partName: 'Bench', builds: 1, units: 1 },
      ],
    },
    isPending: false,
    isError: false,
    error: null,
  },
  previewOptions: null as { enabled?: boolean } | null,
  run: { data: null as Record<string, unknown> | null, isPending: false },
  runInputs: [] as unknown[],
  start: vi.fn(async () => ({ runId: 'run_1' })),
  realtimeRunIds: [] as Array<string | null>,
  openBatchRun: vi.fn(),
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
vi.mock('./use-backflush-run-realtime', () => ({
  useBackflushRunRealtime: (runId: string | null) => h.realtimeRunIds.push(runId),
}))
vi.mock('./use-open-batch-run', () => ({ useOpenBatchRun: () => h.openBatchRun }))
vi.mock('~/trpc/react', () => ({
  api: {
    builds: {
      previewBackflush: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          h.previewOptions = options
          return h.preview
        },
      },
      getBackflushRun: {
        useQuery: (input: unknown) => {
          h.runInputs.push(input)
          return h.run
        },
      },
      runBackflush: { useMutation: () => ({ mutateAsync: h.start, isPending: false }) },
    },
  },
}))

import { BackflushDialog } from './backflush-dialog'

const FULL_PREVIEW = h.preview

function aRun(over: Record<string, unknown>) {
  return {
    runId: 'run_1',
    status: 'IN_PROGRESS',
    from: '2021-07-16',
    to: '2026-09-24',
    batchRun: 12,
    totalDays: 1897,
    processedDays: 420,
    written: 5100,
    failed: 2,
    failures: [{ day: '2022-01-03', partName: 'Strut', reason: 'period locked' }],
    error: null,
    startedAt: new Date(),
    endedAt: null,
    finalizedAt: null,
    ...over,
  }
}

beforeEach(() => {
  h.preview = FULL_PREVIEW
  h.previewOptions = null
  h.run = { data: null, isPending: false }
  h.runInputs = []
  h.realtimeRunIds = []
  h.start.mockClear()
  h.openBatchRun.mockClear()
})

describe('BackflushDialog', () => {
  it('previews per-part counts and starts the run on confirm', async () => {
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
    await waitFor(() => expect(h.start).toHaveBeenCalledTimes(1))
    // Days, never instants: an instant at UTC midnight reads as the day before west of UTC.
    expect(h.start.mock.calls[0]).toEqual([{ from: '2026-09-20', to: '2026-09-22' }])
    // The dialog now follows that run by id, live.
    await waitFor(() => expect(h.runInputs.at(-1)).toEqual({ runId: 'run_1' }))
    expect(h.realtimeRunIds.at(-1)).toBe('run_1')
  })

  it('reopens onto a live run instead of a new form', async () => {
    h.run = { data: aRun({}), isPending: false }
    render(<BackflushDialog open onOpenChange={vi.fn()} />)

    const counts = await screen.findByTestId('backflush-run-counts')
    expect(counts.textContent).toContain('5,100 builds written')
    expect(counts.textContent).toContain('2 failed')
    expect(screen.getByText(/420 of 1,897 days walked/)).toBeTruthy()
    expect(screen.getByText(/period locked/)).toBeTruthy()
    expect(screen.queryByText('From')).toBeNull()
    expect(screen.queryByText('Backflush')).toBeNull()
    expect(h.previewOptions?.enabled).toBe(false)
  })

  it('shows a finished run with its counts and the batch run', async () => {
    h.run = {
      data: aRun({
        status: 'COMPLETED',
        processedDays: 1897,
        written: 25073,
        failures: [],
        failed: 0,
      }),
      isPending: false,
    }
    render(<BackflushDialog open onOpenChange={vi.fn()} />)
    // A finished run is not live, so a fresh open shows the form; start one to follow it.
    expect(screen.queryByTestId('backflush-run')).toBeNull()
    fireEvent.click(screen.getByText('Backflush'))
    const counts = await screen.findByTestId('backflush-run-counts')
    expect(counts.textContent).toContain('25,073 builds written')
    expect(screen.getByText(/Finished: 1,897 days walked/)).toBeTruthy()
    expect(screen.getByText('Run 12')).toBeTruthy()
    fireEvent.click(screen.getByText(/Show the builds/))
    expect(h.openBatchRun).toHaveBeenCalledWith(12)
  })

  it('has nothing to confirm when the preview is empty', () => {
    h.preview = {
      ...h.preview,
      data: { ...h.preview.data, parts: [], buildCount: 0, unitCount: 0 },
    }
    render(<BackflushDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByText(/Nothing to build in this range/)).toBeTruthy()
    expect((screen.getByText('Backflush').closest('button') as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
