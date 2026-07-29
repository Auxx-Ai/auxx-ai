// apps/homepage/src/app/platform/sequences/_components/tracking-grid.tsx

import { Pencil, Send, UserRoundX } from 'lucide-react'
import { cn } from '~/lib/utils'
import { MOCK_RUNS, MOCK_STATS, MockRunRow } from '../_mocks'

/** `[01]` — the monospace index this page uses for numbered lists. */
function Index({ n }: { n: number }) {
  return (
    <span className='font-mono text-xs text-muted-foreground'>[{String(n).padStart(2, '0')}]</span>
  )
}

function RunsPreview() {
  return (
    <div className='space-y-0.5 rounded-lg border bg-card p-2 ring-1 ring-foreground/5'>
      {MOCK_RUNS.slice(0, 4).map((run) => (
        <MockRunRow key={run.email} run={run} className='px-1.5 py-1.5' />
      ))}
    </div>
  )
}

function StatsPreview() {
  return (
    <div className='grid grid-cols-3 gap-1.5'>
      {MOCK_STATS.slice(0, 6).map((stat) => (
        <div key={stat.label} className='rounded-lg border bg-card p-2.5 ring-1 ring-foreground/5'>
          <div className='text-lg font-semibold leading-none'>{stat.value}</div>
          <div className='mt-1 truncate text-[10px] text-muted-foreground'>{stat.label}</div>
        </div>
      ))}
    </div>
  )
}

function RemovePreview() {
  return (
    <div className='space-y-2'>
      <div className='rounded-lg border bg-card p-2 ring-1 ring-foreground/5'>
        <MockRunRow run={MOCK_RUNS[0]!} className='px-1.5 py-1.5' />
      </div>
      <div className='flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground'>
        <UserRoundX className='size-3.5 shrink-0 text-red-500/70' />
        Remove from sequence — pending steps are cancelled immediately.
      </div>
    </div>
  )
}

function PublishPreview() {
  return (
    <div className='space-y-3 rounded-lg border bg-card p-3 ring-1 ring-foreground/5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400'>
          <Pencil className='size-3' />
          Unpublished changes
        </span>
        <span className='inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background'>
          <Send className='size-3' />
          Publish
        </span>
      </div>
      <div className='space-y-1.5 border-t pt-2.5 text-[11px] text-muted-foreground'>
        <div className='flex items-center justify-between'>
          <span>128 runs already in flight</span>
          <span className='text-foreground'>keep v3</span>
        </div>
        <div className='flex items-center justify-between'>
          <span>Enrolled after publish</span>
          <span className='text-foreground'>get v4</span>
        </div>
      </div>
    </div>
  )
}

const cells = [
  {
    title: 'Where everyone stands',
    description: 'Every enrollment, which step it reached, and how it ended.',
    preview: <RunsPreview />,
  },
  {
    title: 'The numbers, live',
    description: 'Enrolled, active, completed, exited, failed — plus reply and bounce rate.',
    preview: <StatsPreview />,
  },
  {
    title: 'Pull someone out',
    description: 'Remove a recipient and their run stops on the spot.',
    preview: <RemovePreview />,
  },
  {
    title: 'Publish when you mean it',
    description: 'Edit the draft freely — in-flight runs keep the version they started on.',
    preview: <PublishPreview />,
  },
]

/**
 * Attio-style numbered grid: mini illustration on top, index + title + one line
 * underneath, dashed cell separators over a dot grid.
 */
export default function TrackingGrid() {
  return (
    <section className='relative overflow-hidden border-b'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-foreground)_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.05]'
      />
      <div className='relative mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Every send, accounted for.
          </h2>
          <p className='mt-4 text-balance text-lg text-muted-foreground'>
            Who&apos;s in, where they got to, and why they left — without opening a single email
            client.
          </p>
        </div>

        <div className='mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border/60 sm:grid-cols-2'>
          {cells.map((cell, index) => (
            <div
              key={cell.title}
              className={cn('flex flex-col bg-background p-6 md:p-8', 'min-h-[300px]')}>
              <Index n={index + 1} />
              <div className='my-6 flex flex-1 items-center'>
                <div className='w-full'>{cell.preview}</div>
              </div>
              <h3 className='font-medium text-foreground'>{cell.title}</h3>
              <p className='mt-1 text-sm text-muted-foreground'>{cell.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
