// apps/homepage/src/app/platform/dispatch/_mocks/route-map-mock.tsx

import { ChevronDown, ChevronLeft, ChevronRight, Home, Minus, Plus } from 'lucide-react'
import { MockBrowserChrome, MockMainPage } from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'

/** Teardrop pin path copied from the real planner map (`planner-map.tsx` §2.2): 28×38, head
 * circle radius 14 centered at (14,14), tip at (14,38). */
const TEARDROP_PATH_D =
  'M14 0C6.268 0 0 6.268 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.268 21.732 0 14 0z'
const PIN_OUTLINE_COLOR = 'rgba(0,0,0,0.45)'

interface Stop {
  number: string
  eta: string
  left: number
  top: number
}

interface Worker {
  name: string
  /** Route/pin fill — full-saturation hex, matching the real planner's worker colors. */
  hex: string
  /** Sidebar color-dot class for the same tone. */
  dot: string
  /** Amber "times not applied" drift dot on the Routes row (plan 20 §3.2). */
  drift?: boolean
  /** Street-following polyline in the map's 0–100 coordinate space. */
  line: string
  stops: Stop[]
}

const WORKERS: Worker[] = [
  {
    name: 'Marcus T.',
    hex: '#0ea5e9',
    dot: 'bg-sky-500',
    drift: true,
    line: '14,72 14,46 38,46 38,22 62,22 84,22 84,34',
    stops: [
      { number: 'WO-1042', eta: '9:00 AM', left: 38, top: 46 },
      { number: 'WO-1038', eta: '10:45 AM', left: 62, top: 22 },
      { number: 'WO-1051', eta: '1:15 PM', left: 84, top: 34 },
    ],
  },
  {
    name: 'Dana K.',
    hex: '#10b981',
    dot: 'bg-emerald-500',
    line: '14,72 48,72 48,58 70,58',
    stops: [
      { number: 'WO-1047', eta: '8:30 AM', left: 48, top: 72 },
      { number: 'WO-1044', eta: '11:20 AM', left: 70, top: 58 },
    ],
  },
]

/** Unscheduled work orders — neutral, unnumbered pins on the map (like the real backlog pins). */
const BACKLOG = [
  { number: 'WO-1056', title: 'Gutter repair', left: 26, top: 58 },
  { number: 'WO-1058', title: 'Filter replacement', left: 66, top: 86 },
]

// July 2026, Monday start; negative = outside the displayed month.
const MINI_WEEKS = [
  [-29, -30, 1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10, 11, 12],
  [13, 14, 15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24, 25, 26],
  [27, 28, 29, 30, 31, -1, -2],
]
const MINI_SELECTED_DAY = 20
const MINI_DENSITY_DAYS = new Set([21, 22, 24])
const MINI_WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The dispatch route planner as a full app window: browser chrome, the dispatch module
 * sidebar (mini calendar, Backlog, Routes stop lists), and the planner map with numbered
 * teardrop pins, per-worker route polylines, and the home-base marker — a static facsimile
 * of `apps/web/src/components/dispatch/ui/route-planner/` built from the shared homepage
 * mock primitives.
 */
export function MockRoutePlanner({ className }: { className?: string }) {
  return (
    <MockBrowserChrome variant='regular' url='app.auxx.ai/app/dispatch' className={className}>
      <div className='flex h-[440px] md:h-[540px]'>
        <MockDispatchSidebar className='hidden md:flex' />
        <MockMainPage>
          <PlannerToolbar />
          <MockPlannerMap />
        </MockMainPage>
      </div>
    </MockBrowserChrome>
  )
}

// ---------------------------------------------------------------------------
// Sidebar — facsimile of `dispatch/ui/sidebar/dispatch-sidebar.tsx` (map mode)
// ---------------------------------------------------------------------------

function MockDispatchSidebar({ className }: { className?: string }) {
  return (
    <aside
      style={{ width: 220 }}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-r border-mock-sidebar-border bg-mock-sidebar text-mock-sidebar-foreground',
        className
      )}>
      <MiniMonthMock />
      <div className='flex-1 space-y-2 overflow-hidden px-2 pb-2'>
        <BacklogGroupMock />
        <RoutesGroupMock />
      </div>
    </aside>
  )
}

function MiniMonthMock() {
  return (
    <div className='px-3 pb-2 pt-3'>
      <div className='flex items-center justify-between px-1 pb-1.5'>
        <span className='text-xs font-medium'>July 2026</span>
        <span className='flex items-center gap-1 text-mock-sidebar-muted'>
          <ChevronLeft className='size-3' />
          <ChevronRight className='size-3' />
        </span>
      </div>
      <div className='grid grid-cols-7 text-center text-[9px] text-mock-sidebar-muted'>
        {MINI_WEEKDAYS.map((day, i) => (
          <span key={`${day}-${i}`} className='flex h-4 items-center justify-center'>
            {day}
          </span>
        ))}
      </div>
      <div className='grid grid-cols-7'>
        {MINI_WEEKS.flat().map((value, i) => {
          const day = Math.abs(value)
          const outside = value < 0
          const selected = !outside && day === MINI_SELECTED_DAY
          return (
            <span
              key={i}
              className={cn(
                'relative flex h-5 items-center justify-center rounded-md text-[10px] tabular-nums',
                outside ? 'text-mock-sidebar-muted/50' : 'text-mock-sidebar-foreground',
                selected && 'bg-foreground font-medium text-background'
              )}>
              {day}
              {!outside && !selected && MINI_DENSITY_DAYS.has(day) && (
                <span className='absolute bottom-px left-1/2 size-[3px] -translate-x-1/2 rounded-full bg-mock-sidebar-muted' />
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function GroupLabel({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <div className='flex h-6 items-center justify-between rounded-md px-2 text-xs font-medium text-mock-sidebar-muted'>
      <span>{title}</span>
      {trailing ?? <ChevronDown className='size-3' />}
    </div>
  )
}

function BacklogGroupMock() {
  return (
    <div>
      <GroupLabel
        title='Backlog'
        trailing={<span className='tabular-nums'>{BACKLOG.length}</span>}
      />
      <div className='px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-mock-sidebar-muted/80'>
        Unscheduled
      </div>
      <ul className='flex flex-col gap-px'>
        {BACKLOG.map((item) => (
          <li key={item.number} className='flex h-7 items-center gap-2 rounded-md px-2 text-xs'>
            <span className='size-1.5 shrink-0 rounded-full bg-mock-sidebar-muted/60' />
            <span className='shrink-0'>{item.number}</span>
            <span className='truncate text-mock-sidebar-muted'>{item.title}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RoutesGroupMock() {
  return (
    <div>
      <GroupLabel title='Routes' />
      <ul className='flex flex-col gap-px'>
        {WORKERS.map((worker) => (
          <li key={worker.name}>
            <div className='flex h-7 items-center rounded-md px-2 text-xs'>
              <span className={cn('mr-2 size-2 shrink-0 rounded-full', worker.dot)} />
              <span className='truncate font-medium'>{worker.name}</span>
              {worker.drift && (
                <span className='ml-1.5 size-1.5 shrink-0 rounded-full bg-amber-500' />
              )}
              <ChevronDown className='ml-1 size-3 shrink-0 text-mock-sidebar-muted' />
              <span className='ml-auto text-mock-sidebar-muted tabular-nums'>
                {worker.stops.length}
              </span>
            </div>
            <ul className='flex flex-col gap-px'>
              {worker.stops.map((stop, index) => (
                <li key={stop.number} className='flex h-7 items-center rounded-md px-2 text-xs'>
                  <span className='mr-2 text-mock-sidebar-muted tabular-nums'>{index + 1}.</span>
                  <span className='truncate'>{stop.number}</span>
                  <span className='ml-auto text-mock-sidebar-muted'>{stop.eta}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel — toolbar + map facsimile of `route-planner/planner-map.tsx`
// ---------------------------------------------------------------------------

function PlannerToolbar() {
  return (
    <div className='flex items-center justify-between border-b border-mock-window-border px-3 py-2'>
      <div className='flex items-center gap-1 rounded-lg bg-muted p-0.5 text-[10px] font-medium'>
        <span className='px-2 py-1 text-muted-foreground'>Calendar</span>
        <span className='rounded-md bg-background px-2 py-1 text-foreground shadow-sm'>Map</span>
      </div>
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <ChevronLeft className='size-3.5' />
        <span className='font-medium text-foreground'>Mon, Jul 20</span>
        <ChevronRight className='size-3.5' />
      </div>
    </div>
  )
}

interface TeardropPinProps {
  left: number
  top: number
  /** Worker hex fill; omit for the neutral backlog pin (fills with `currentColor`). */
  fill?: string
  order?: number
}

function TeardropPin({ left, top, fill, order }: TeardropPinProps) {
  return (
    <div
      className={cn(
        'absolute -translate-x-1/2 -translate-y-full',
        !fill && 'text-slate-600 dark:text-slate-400'
      )}
      style={{ left: `${left}%`, top: `${top}%` }}>
      <svg
        width='28'
        height='38'
        viewBox='0 0 28 38'
        className='block drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]'>
        <path
          d={TEARDROP_PATH_D}
          fill={fill ?? 'currentColor'}
          stroke={PIN_OUTLINE_COLOR}
          strokeWidth='1.5'
        />
      </svg>
      {order != null && (
        <span className='absolute left-0 top-0 flex size-7 items-center justify-center text-[13px] font-extrabold text-white'>
          {order}
        </span>
      )}
    </div>
  )
}

function MockPlannerMap() {
  return (
    <div className='relative flex-1 overflow-hidden bg-[#f2efe9] dark:bg-[#1a1f27]'>
      {/* Minor street grid */}
      <div
        aria-hidden
        className='absolute inset-0 bg-[repeating-linear-gradient(0deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_28px),repeating-linear-gradient(90deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_28px)] opacity-[0.05]'
      />
      {/* Park + water blocks */}
      <div
        aria-hidden
        className='absolute rounded-xl bg-emerald-600/15 dark:bg-emerald-400/10'
        style={{ left: '17%', top: '26%', width: '18%', height: '16%' }}
      />
      <div
        aria-hidden
        className='absolute bottom-0 right-0 h-1/5 w-1/4 rounded-tl-[48px] bg-sky-600/15 dark:bg-sky-400/10'
      />
      {/* Major roads + route polylines */}
      <svg
        aria-hidden
        viewBox='0 0 100 100'
        preserveAspectRatio='none'
        className='absolute inset-0 h-full w-full'>
        {[22, 46, 72].map((y) => (
          <line
            key={`h-${y}`}
            x1='0'
            y1={y}
            x2='100'
            y2={y}
            className='stroke-white dark:stroke-[#2a3140]'
            strokeWidth='5'
            vectorEffect='non-scaling-stroke'
          />
        ))}
        {[14, 38, 62, 84].map((x) => (
          <line
            key={`v-${x}`}
            x1={x}
            y1='0'
            x2={x}
            y2='100'
            className='stroke-white dark:stroke-[#2a3140]'
            strokeWidth='4'
            vectorEffect='non-scaling-stroke'
          />
        ))}
        {WORKERS.map((worker) => (
          <polyline
            key={worker.name}
            points={worker.line}
            fill='none'
            stroke={worker.hex}
            strokeWidth='3'
            strokeLinejoin='round'
            strokeLinecap='round'
            vectorEffect='non-scaling-stroke'
            opacity='0.9'
          />
        ))}
      </svg>

      {/* Home-base marker at the depot */}
      <div
        className='absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-slate-800 shadow-md dark:border-slate-800 dark:bg-slate-200'
        style={{ left: '14%', top: '72%' }}
        title='Home base'>
        <Home className='size-4 text-white dark:text-slate-800' />
      </div>

      {/* Numbered worker pins + neutral backlog pins */}
      {WORKERS.flatMap((worker) =>
        worker.stops.map((stop, index) => (
          <TeardropPin
            key={stop.number}
            left={stop.left}
            top={stop.top}
            fill={worker.hex}
            order={index + 1}
          />
        ))
      )}
      {BACKLOG.map((item) => (
        <TeardropPin key={item.number} left={item.left} top={item.top} />
      ))}

      {/* Zoom control (MapLibre NavigationControl, no compass) */}
      <div className='absolute right-2 top-2 flex flex-col overflow-hidden rounded-md bg-white text-slate-700 shadow-md ring-1 ring-black/10 dark:bg-[#23272e] dark:text-slate-300 dark:ring-white/10'>
        <span className='flex size-7 items-center justify-center'>
          <Plus className='size-3.5' />
        </span>
        <span className='h-px bg-black/10 dark:bg-white/10' />
        <span className='flex size-7 items-center justify-center'>
          <Minus className='size-3.5' />
        </span>
      </div>

      <span className='absolute bottom-1 right-1.5 text-[8px] text-black/40 dark:text-white/30'>
        © OpenFreeMap
      </span>
    </div>
  )
}
