// apps/web/src/components/manufacturing/builds/backflush-dialog.test.tsx

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  preview: {
    data: {
      range: { from: '2021-07-16', to: '2026-09-24' },
      kindConflicts: [] as Array<Record<string, unknown>>,
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
  previewInputs: [] as unknown[],
  run: { data: null as Record<string, unknown> | null, isPending: false },
  runInputs: [] as unknown[],
  start: vi.fn(async () => ({ runId: 'run_1' })),
  realtimeRunIds: [] as Array<string | null>,
  openBatchRun: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('./use-backflush-run-realtime', () => ({
  useBackflushRunRealtime: (runId: string | null) => h.realtimeRunIds.push(runId),
}))
vi.mock('./use-open-batch-run', () => ({ useOpenBatchRun: () => h.openBatchRun }))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      builds: {
        previewBackflush: { invalidate: h.invalidate },
        hasBackflushBuilds: { invalidate: h.invalidate },
      },
    }),
    builds: {
      previewBackflush: {
        useQuery: (input: unknown, options: { enabled?: boolean }) => {
          h.previewInputs.push(input)
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
import { BackflushPanel } from './backflush-panel'

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
  h.previewInputs = []
  h.run = { data: null, isPending: false }
  h.runInputs = []
  h.realtimeRunIds = []
  h.start.mockClear()
  h.openBatchRun.mockClear()
  h.invalidate.mockClear()
})

const confirmButton = () => screen.getByRole('button', { name: /Record past builds/ })

describe('BackflushDialog', () => {
  it('previews the server range per part and starts the run with no dates', async () => {
    render(<BackflushDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Record past builds' })).toBeTruthy()
    expect(screen.queryByText('From')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('backflush-summary').textContent).toContain(
        "We'll record 3 builds for 2 products from 16 Jul 2021 to yesterday"
      )
    )
    expect(screen.getByText("Uses today's parts list for every past day.")).toBeTruthy()
    expect(screen.getByText('Bench')).toBeTruthy()
    expect(h.previewInputs.at(-1)).toEqual({})

    fireEvent.click(confirmButton())
    await waitFor(() => expect(h.start).toHaveBeenCalledTimes(1))
    expect(h.start.mock.calls[0]).toEqual([{}])
    // The dialog now follows that run by id, live.
    await waitFor(() => expect(h.runInputs.at(-1)).toEqual({ runId: 'run_1' }))
    expect(h.realtimeRunIds.at(-1)).toBe('run_1')
  })

  it('reopens onto a live run instead of a new preview', async () => {
    h.run = { data: aRun({}), isPending: false }
    render(<BackflushDialog open onOpenChange={vi.fn()} />)

    const counts = await screen.findByTestId('backflush-run-counts')
    expect(counts.textContent).toContain('5,100 builds written')
    expect(counts.textContent).toContain('2 failed')
    expect(screen.getByText(/420 of 1,897 days walked/)).toBeTruthy()
    expect(screen.getByText(/period locked/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Record past builds/ })).toBeNull()
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
    // A finished run is not live, so a fresh open shows the preview; start one to follow it.
    expect(screen.queryByTestId('backflush-run')).toBeNull()
    fireEvent.click(confirmButton())
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
    expect(screen.getByText(/All past sales are covered/)).toBeTruthy()
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists kind conflicts and refuses to confirm until they are fixed', () => {
    h.preview = {
      ...h.preview,
      data: {
        ...h.preview.data,
        kindConflicts: [
          {
            partId: 'nut',
            partName: 'Square Nut M5',
            kind: 'finished_good',
            reason: 'finished_good_in_bom',
            usedIn: [{ partId: 'lift', partName: 'Attic Lift' }],
            suggestedKind: 'component',
          },
        ],
      },
    }
    render(<BackflushDialog open onOpenChange={vi.fn()} />)
    const alert = screen.getByTestId('backflush-kind-conflicts')
    expect(alert.textContent).toContain('Square Nut M5')
    expect(alert.textContent).toContain('Used inside Attic Lift, but marked Finished Good.')
    expect(screen.getByText('Check parts').getAttribute('href')).toBe(
      '/app/inventory/setup?step=kinds'
    )
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('BackflushPanel', () => {
  it('calls onFinished once when the run it follows completes, and refreshes the preview', async () => {
    const onFinished = vi.fn()
    h.run = { data: aRun({ status: 'COMPLETED', failures: [], failed: 0 }), isPending: false }
    const { rerender } = render(<BackflushPanel onFinished={onFinished} />)
    // A run already finished on open is not followed, so nothing fires yet.
    expect(onFinished).not.toHaveBeenCalled()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    rerender(<BackflushPanel onFinished={onFinished} />)
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(h.invalidate).toHaveBeenCalled()
  })

  it('does not call onFinished while the run is live', async () => {
    const onFinished = vi.fn()
    h.run = { data: aRun({ status: 'IN_PROGRESS' }), isPending: false }
    render(<BackflushPanel onFinished={onFinished} />)
    await screen.findByTestId('backflush-run')
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('never refetches the preview in the background', () => {
    render(<BackflushPanel />)
    expect(h.previewOptions).toMatchObject({ staleTime: 60_000, refetchOnWindowFocus: false })
  })
})
