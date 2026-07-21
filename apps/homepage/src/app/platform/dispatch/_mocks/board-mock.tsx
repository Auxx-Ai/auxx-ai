// apps/homepage/src/app/platform/dispatch/_mocks/board-mock.tsx

import { CalendarDays, Repeat } from 'lucide-react'
import { cn } from '~/lib/utils'

type WorkerTone = 'sky' | 'emerald' | 'amber' | 'violet'
type ChipTone = 'sky' | 'emerald' | 'amber' | 'violet' | 'muted'

/** Avatar tint per worker — matches the shared sample-data tone assignments. */
const WORKER_TONE_CLASS: Record<WorkerTone, string> = {
  sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
}

/** Job-chip fill per status/tone — `/15` bg + colored text, same pattern as status pills. */
const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-sky-500/20',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/20',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 ring-violet-500/20',
  muted: 'bg-muted text-muted-foreground ring-foreground/10',
}

/** First-name + last-initial avatar text, e.g. "Marcus T." -> "MT". */
function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

interface MiniChip {
  label: string
  start: number
  span: number
  tone: ChipTone
}

interface MiniRow {
  worker: string
  tone: WorkerTone
  chips: MiniChip[]
}

const DEFAULT_MINI_ROWS: MiniRow[] = [
  {
    worker: 'Marcus T.',
    tone: 'sky',
    chips: [
      { label: 'AC compressor swap', start: 1, span: 4, tone: 'sky' },
      { label: 'Panel inspection', start: 7, span: 3, tone: 'violet' },
    ],
  },
  {
    worker: 'Dana K.',
    tone: 'emerald',
    chips: [
      { label: 'Water heater install', start: 2, span: 4, tone: 'emerald' },
      { label: 'Drain clearing', start: 9, span: 3, tone: 'amber' },
    ],
  },
  {
    worker: 'Luis R.',
    tone: 'amber',
    chips: [
      { label: 'Quarterly treatment', start: 3, span: 3, tone: 'sky' },
      { label: 'Furnace tune-up', start: 8, span: 4, tone: 'emerald' },
    ],
  },
]

interface MockMiniBoardProps {
  className?: string
  rows?: MiniRow[]
}

/**
 * Compact 3-row dispatch board: worker avatar + name, 12-column hour timeline,
 * colored job chips. Used in the hero and reused (with custom `rows`) on
 * industry pages for trade-specific job labels.
 */
export function MockMiniBoard({ className, rows = DEFAULT_MINI_ROWS }: MockMiniBoardProps) {
  return (
    <div
      className={cn(
        'bg-card ring-foreground/10 overflow-hidden rounded-xl border border-transparent shadow-xl shadow-black/5 ring-1',
        className
      )}>
      <div className='divide-border/70 divide-y'>
        {rows.map((row) => (
          <div key={row.worker} className='flex items-center gap-2 px-3 py-2'>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium',
                WORKER_TONE_CLASS[row.tone]
              )}>
              {initials(row.worker)}
            </span>
            <span className='text-foreground w-16 shrink-0 truncate text-xs'>{row.worker}</span>
            <div className='grid flex-1 grid-cols-12 gap-1'>
              {row.chips.map((chip) => (
                <div
                  key={chip.label}
                  style={{ gridColumn: `${chip.start} / span ${chip.span}` }}
                  className={cn(
                    'truncate rounded-md px-1.5 py-1 text-[10px] font-medium ring-1 ring-inset',
                    CHIP_TONE_CLASS[chip.tone]
                  )}>
                  {chip.label}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MockDispatchBoard — the full showcase board
// ---------------------------------------------------------------------------

const HOURS = [
  '8:00',
  '9:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
]

type StatusTone = ChipTone | 'indigo'

const STATUS_CHIP_CLASS: Record<StatusTone, string> = {
  ...CHIP_TONE_CLASS,
  indigo: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 ring-indigo-500/20',
}

type Block =
  | { kind: 'off'; start: number; span: number; label?: string }
  | {
      kind: 'chip'
      start: number
      span: number
      label: string
      status: string
      tone: StatusTone
      recurring?: boolean
    }
  | {
      kind: 'ghost'
      start: number
      span: number
      label: string
      status: string
      tone: StatusTone
    }
  | { kind: 'dropTarget'; start: number; span: number }

interface FullRow {
  worker: string
  tone: WorkerTone
  blocks: Block[]
}

const FULL_ROWS: FullRow[] = [
  {
    worker: 'Marcus T.',
    tone: 'sky',
    blocks: [
      { kind: 'off', start: 1, span: 1 },
      {
        kind: 'chip',
        start: 2,
        span: 3,
        label: 'AC compressor swap — Lakeside Dental',
        status: 'Scheduled',
        tone: 'sky',
      },
      { kind: 'dropTarget', start: 6, span: 3 },
      {
        kind: 'ghost',
        start: 9,
        span: 3,
        label: 'Panel inspection — Mercer St Bakery',
        status: 'Dispatched',
        tone: 'indigo',
      },
    ],
  },
  {
    worker: 'Dana K.',
    tone: 'emerald',
    blocks: [
      { kind: 'off', start: 1, span: 1 },
      {
        kind: 'chip',
        start: 3,
        span: 4,
        label: 'Water heater install — Nguyen residence',
        status: 'En route',
        tone: 'amber',
      },
      {
        kind: 'chip',
        start: 8,
        span: 2,
        label: 'Drain clearing — Hilltop Cafe',
        status: 'Done',
        tone: 'emerald',
      },
      { kind: 'off', start: 12, span: 1 },
    ],
  },
  {
    worker: 'Luis R.',
    tone: 'amber',
    blocks: [
      { kind: 'off', start: 1, span: 1 },
      {
        kind: 'chip',
        start: 2,
        span: 3,
        label: 'Quarterly treatment — Hawthorne Apartments',
        status: 'On site',
        tone: 'violet',
        recurring: true,
      },
      {
        kind: 'chip',
        start: 9,
        span: 3,
        label: 'Furnace tune-up — Alder Grove HOA',
        status: 'New',
        tone: 'muted',
      },
      { kind: 'off', start: 12, span: 1 },
    ],
  },
  {
    worker: 'Priya S.',
    tone: 'violet',
    blocks: [
      { kind: 'off', start: 1, span: 1 },
      { kind: 'off', start: 4, span: 6, label: 'Time off' },
      { kind: 'off', start: 12, span: 1 },
    ],
  },
]

function BoardBlock({ block }: { block: Block }) {
  if (block.kind === 'off') {
    return (
      <div
        style={{ gridColumn: `${block.start} / span ${block.span}` }}
        className='bg-muted/50 relative z-0 overflow-hidden rounded-md'>
        <div
          aria-hidden
          className='absolute inset-0 bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_6px)] opacity-5'
        />
        {block.label ? (
          <span className='text-muted-foreground relative z-10 flex h-full items-center justify-center text-[9px] font-medium'>
            {block.label}
          </span>
        ) : null}
      </div>
    )
  }

  if (block.kind === 'dropTarget') {
    return (
      <div
        style={{ gridColumn: `${block.start} / span ${block.span}` }}
        className='border-sky-500/40 bg-sky-500/5 z-0 rounded-md border border-dashed'
      />
    )
  }

  const isGhost = block.kind === 'ghost'

  return (
    <div
      style={{ gridColumn: `${block.start} / span ${block.span}` }}
      className={cn(
        'flex min-w-0 flex-col justify-center gap-0.5 rounded-md px-1.5 py-1 ring-1 ring-inset',
        STATUS_CHIP_CLASS[block.tone],
        isGhost ? 'z-20 -rotate-2 opacity-60 ring-2 ring-sky-500/50' : 'z-10'
      )}>
      <span className='flex items-center gap-1 truncate text-[10px] font-medium'>
        {'recurring' in block && block.recurring ? <Repeat className='size-3 shrink-0' /> : null}
        <span className='truncate'>{block.label}</span>
      </span>
      <span className='bg-background/60 w-fit rounded-full px-1 text-[9px] font-medium leading-tight'>
        {block.status}
      </span>
    </div>
  )
}

interface MockDispatchBoardProps {
  className?: string
}

/**
 * Full dispatch-board showcase: view toggle + date, 4 workers, a 12-column
 * hour timeline with availability/time-off shading, status-toned job chips,
 * a mid-drag ghost chip with drop target, and one recurring job.
 */
export function MockDispatchBoard({ className }: MockDispatchBoardProps) {
  return (
    <div
      className={cn(
        'bg-card ring-foreground/10 overflow-hidden rounded-xl border border-transparent shadow-xl shadow-black/5 ring-1',
        className
      )}>
      <div className='flex items-center justify-between gap-3 border-b px-4 py-3'>
        <div className='bg-muted flex items-center gap-1 rounded-lg p-0.5 text-[10px] font-medium'>
          <span className='bg-background text-foreground rounded-md px-2 py-1 shadow-sm'>Day</span>
          <span className='text-muted-foreground px-2 py-1'>Week</span>
          <span className='text-muted-foreground px-2 py-1'>Month</span>
        </div>
        <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
          <CalendarDays className='size-3.5' />
          Mon, Jul 20
        </div>
      </div>

      <div className='flex items-center border-b px-4 py-2'>
        <div className='w-24 shrink-0 sm:w-32' />
        <div className='text-muted-foreground grid flex-1 grid-cols-12 text-[10px]'>
          {HOURS.map((hour, i) => (
            <span key={hour} className={cn(i % 2 === 1 && 'hidden sm:inline')}>
              {hour}
            </span>
          ))}
        </div>
      </div>

      <div className='divide-border/70 divide-y'>
        {FULL_ROWS.map((row) => (
          <div key={row.worker} className='flex items-stretch gap-0 px-4 py-2.5'>
            <div className='flex w-24 shrink-0 items-center gap-2 sm:w-32'>
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium',
                  WORKER_TONE_CLASS[row.tone]
                )}>
                {initials(row.worker)}
              </span>
              <span className='text-foreground truncate text-xs font-medium'>{row.worker}</span>
            </div>
            <div className='grid min-h-14 flex-1 grid-cols-12 gap-1'>
              {row.blocks.map((block) => (
                <BoardBlock key={`${row.worker}-${block.kind}-${block.start}`} block={block} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
