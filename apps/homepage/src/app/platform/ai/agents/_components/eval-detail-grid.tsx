// apps/homepage/src/app/platform/ai/agents/_components/eval-detail-grid.tsx

import { Check, ShieldOff, TriangleAlert, X } from 'lucide-react'
import { cn } from '~/lib/utils'

/** `[01]` — the monospace index this page shares with the sequences grid. */
function Index({ n }: { n: number }) {
  return (
    <span className='font-mono text-xs text-muted-foreground'>[{String(n).padStart(2, '0')}]</span>
  )
}

function LayersPreview() {
  return (
    <div className='space-y-1.5'>
      {['selection', 'stepper', 'engine'].map((layer) => (
        <div
          key={layer}
          className='rounded-lg border bg-card px-3 py-2 text-[11px] font-medium text-foreground ring-1 ring-foreground/5'>
          {layer}
        </div>
      ))}
      <div className='flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground'>
        <ShieldOff className='size-3.5 shrink-0 text-amber-500' />
        tools · stubbed, fail-closed
      </div>
    </div>
  )
}

function AssertionsPreview() {
  const deterministic = ['tool_called', 'terminal_outcome', 'crm_field', 'local_variable']
  return (
    <div className='flex flex-wrap gap-1.5'>
      {deterministic.map((assertion) => (
        <span
          key={assertion}
          className='rounded-md bg-muted px-1.5 py-1 font-mono text-[10px] text-muted-foreground'>
          {assertion}
        </span>
      ))}
      <span className='rounded-md bg-amber-500/10 px-1.5 py-1 font-mono text-[10px] text-amber-700 dark:text-amber-400'>
        response_criteria · judged
      </span>
    </div>
  )
}

function StatusPreview() {
  const rows = [
    {
      icon: Check,
      label: 'passed',
      detail: 'every assertion held',
      tone: 'text-emerald-700 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      icon: X,
      label: 'failed',
      detail: 'it ran, and got it wrong',
      tone: 'text-red-700 dark:text-red-400',
      bg: 'bg-red-500/10',
    },
    {
      icon: TriangleAlert,
      label: 'error',
      detail: 'UNMATCHED_MOCK',
      tone: 'text-amber-700 dark:text-amber-400',
      bg: 'bg-amber-500/10',
    },
  ]
  return (
    <div className='space-y-1.5'>
      {rows.map((row) => (
        <div key={row.label} className='flex items-center gap-2 text-[11px]'>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium',
              row.bg,
              row.tone
            )}>
            <row.icon className='size-3' />
            {row.label}
          </span>
          <span className='truncate text-muted-foreground'>{row.detail}</span>
        </div>
      ))}
    </div>
  )
}

function ModePreview() {
  return (
    <div className='space-y-2'>
      <div className='inline-flex rounded-lg border bg-card p-0.5 text-[11px]'>
        <span className='rounded-md bg-foreground px-2 py-1 font-medium text-background'>
          pinned v7
        </span>
        <span className='px-2 py-1 text-muted-foreground'>draft</span>
      </div>
      <div className='flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-2 text-[10px] text-muted-foreground'>
        <TriangleAlert className='size-3 shrink-0 text-amber-500' />
        <span className='font-mono'>SNAPSHOT_INCOMPATIBLE</span>
      </div>
    </div>
  )
}

const cells = [
  {
    title: 'The real loop, mocked at the edges',
    description:
      'Selection, stepper, and engine are the ones production runs. Only tools are stubbed, and an un-stubbed call errors the run instead of touching anything. No CRM writes, ever.',
    preview: <LayersPreview />,
  },
  {
    title: "Assertions that don't argue",
    description:
      'This tool with these arguments. This terminal outcome. This field ended up here. This variable equals that. Judged criteria only for prose.',
    preview: <AssertionsPreview />,
  },
  {
    title: 'error is not failed',
    description:
      "A judge that breaks, a mock that's missing, a run that times out: those are errors, not verdicts. Nothing passes quietly.",
    preview: <StatusPreview />,
  },
  {
    title: 'Pinned or draft',
    description:
      "Pin the published version and it's a regression gate. Point it at the draft and it's the iteration loop. A tool whose schema moved under a pinned run fails loudly.",
    preview: <ModePreview />,
  },
]

/**
 * The four things that make the simulations trustworthy, in the numbered-grid
 * shape `platform/sequences/_components/tracking-grid.tsx` established.
 */
export default function EvalDetailGrid() {
  return (
    <section className='relative overflow-hidden border-b'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-foreground)_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.05]'
      />
      <div className='relative mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>Not a vibe check.</h2>
          <p className='mt-4 text-balance text-lg text-muted-foreground'>
            Simulations run the real agent loop against a synthetic customer, with every tool
            stubbed at the edge.
          </p>
        </div>

        <div className='mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border/60 sm:grid-cols-2'>
          {cells.map((cell, index) => (
            <div key={cell.title} className='flex min-h-[300px] flex-col bg-background p-6 md:p-8'>
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
