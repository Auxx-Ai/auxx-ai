// apps/homepage/src/app/platform/sequences/_components/sequence-rail-illustration.tsx
'use client'

import { Ban, Check, Clock, MailX, Reply, Send, UserRoundPlus, Zap } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { cn } from '~/lib/utils'

const CYCLE_DURATION = 5200

/** Desktop container width. Fixed so the branch geometry below is exact pixel math. */
const RAIL_WIDTH = 600
const CENTER = RAIL_WIDTH / 2

/** Exit reasons — colors match the run-status vocabulary the hero mock uses. */
const EXITS = {
  replied: {
    label: 'Replied',
    icon: Reply,
    dot: 'var(--color-emerald-400)',
    chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    ring: 'ring-emerald-500/20',
  },
  unsubscribed: {
    label: 'Unsubscribed',
    icon: Ban,
    dot: 'var(--color-amber-400)',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-500/20',
  },
  bounced: {
    label: 'Bounced',
    icon: MailX,
    dot: 'var(--color-rose-400)',
    chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    ring: 'ring-rose-500/20',
  },
} as const

type ExitKey = keyof typeof EXITS

/**
 * The two seeded three-step templates, transcribed from
 * `packages/lib/src/sequences/seed-templates.ts`. The whole story cycles
 * together — trigger, subjects, and timings — because a `visit:scheduled`
 * trigger above a run of invoice emails would be a lie. Both have exactly
 * three steps, which keeps the rail height fixed across the swap.
 */
const TEMPLATES = [
  {
    event: 'invoice:sent',
    trigger: 'Invoice sent',
    steps: [
      { subject: 'Your invoice is due soon', timing: '2 days before the due date at 9:00 AM' },
      { subject: 'Your invoice is overdue', timing: '3 days after the due date at 9:00 AM' },
      { subject: 'Invoice still outstanding', timing: '10 days after the due date at 9:00 AM' },
    ],
  },
  {
    event: 'visit:scheduled',
    trigger: 'Visit scheduled',
    steps: [
      { subject: 'Your visit is booked', timing: 'Right away' },
      {
        subject: 'Reminder: your visit is coming up',
        timing: '2 days before the visit at 9:00 AM',
      },
      { subject: "We'll see you today", timing: 'Same day as the visit at 7:30 AM' },
    ],
  },
] as const

type Template = (typeof TEMPLATES)[number]

/** Fades new copy in when the template swaps. */
function Swap({ id, children }: { id: number; children: React.ReactNode }) {
  return (
    <motion.span
      key={id}
      initial={{ opacity: 0, filter: 'blur(5px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.4 }}
      className='block truncate'>
      {children}
    </motion.span>
  )
}

/* -------------------------------------------------------------------------- */
/* Nodes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which template the whole rail is currently telling. Cycling the head instead
 * of fanning several static sources into a hub is what keeps this from being a
 * re-skin of `mcp-flow-illustration`.
 */
function useTemplateCycle() {
  const reduceMotion = useReducedMotion()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (reduceMotion) return
    const interval = setInterval(() => {
      setActive((prev) => (prev + 1) % TEMPLATES.length)
    }, CYCLE_DURATION)
    return () => clearInterval(interval)
  }, [reduceMotion])

  return { active, template: TEMPLATES[active] ?? TEMPLATES[0]! }
}

function TriggerNode({
  active,
  template,
  compact = false,
}: {
  active: number
  template: Template
  compact?: boolean
}) {
  return (
    <div className='relative'>
      <div aria-hidden className='absolute inset-0 opacity-50 dark:opacity-20'>
        <div className='absolute inset-1 animate-pulse rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 blur-md' />
      </div>
      <div
        className={cn(
          'relative overflow-hidden rounded-xl bg-card shadow-md shadow-black/[.065] ring-1 ring-foreground/15 backdrop-blur',
          compact ? 'w-52' : 'w-56'
        )}>
        <AnimatePresence initial={false} mode='popLayout'>
          <motion.div
            key={active}
            initial={{ opacity: 0, filter: 'blur(10px)', y: -28 }}
            animate={{ opacity: 1, filter: 'blur(0)', y: 0 }}
            exit={{ opacity: 0, filter: 'blur(10px)', y: 28 }}
            transition={{ duration: 0.45, type: 'spring', bounce: 0.15 }}
            className='flex items-center gap-2 p-2.5'>
            <span className='flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10'>
              <Zap className='size-3.5 text-amber-500' />
            </span>
            <div className='min-w-0'>
              <div className='truncate text-[11px] font-semibold'>{template.trigger}</div>
              <code className='block truncate font-mono text-[9px] text-foreground/60'>
                {template.event}
              </code>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function EnrollNode({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl bg-illustration p-2.5 shadow-md shadow-black/[.065] ring-1 ring-border-illustration',
        compact ? 'w-52' : 'w-56'
      )}>
      <span className='flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-500/10'>
        <UserRoundPlus className='size-3.5 text-blue-500' />
      </span>
      <div className='min-w-0 flex-1'>
        <div className='truncate text-[11px] font-semibold'>Contact enrolled</div>
        <div className='text-[9px] text-foreground/60'>Filters checked once, at enrollment</div>
      </div>
    </div>
  )
}

function StepNode({
  n,
  subject,
  active,
  compact = false,
}: {
  n: number
  subject: string
  active: number
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl bg-card shadow-md shadow-black/[.065] ring-1 ring-border-illustration',
        compact ? 'w-60' : 'w-72'
      )}>
      <div className='flex items-center gap-2 px-2.5 py-2'>
        <span className='flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground text-[9px] font-semibold text-background'>
          {n}
        </span>
        <Send className='size-3 shrink-0 text-foreground/50' />
        <span className='min-w-0 flex-1 text-[11px] font-semibold'>
          <Swap id={active}>{subject}</Swap>
        </span>
      </div>
    </div>
  )
}

function CompletedNode() {
  return (
    <div className='inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-400'>
      <Check className='size-3' />
      Completed
    </div>
  )
}

function DelayPill({ children }: { children: React.ReactNode }) {
  return (
    <span className='inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-foreground/20 bg-background px-2.5 py-1 text-[10px] text-muted-foreground'>
      <Clock className='size-2.5' />
      {children}
    </span>
  )
}

function ExitPill({ exit }: { exit: ExitKey }) {
  const meta = EXITS[exit]
  return (
    <span
      className={cn(
        'inline-flex w-32 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-medium ring-1',
        meta.chip,
        meta.ring
      )}>
      <meta.icon className='size-3 shrink-0' />
      <span className='truncate'>{meta.label}</span>
      <span className='ml-auto text-[9px] opacity-70'>exit</span>
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Desktop connector — vertical rail + optional side branch                     */
/* -------------------------------------------------------------------------- */

interface ConnectorProps {
  height: number
  delay?: string
  /** Active template index — drives the delay pill's crossfade on swap. */
  active?: number
  exit?: ExitKey
  side?: 'left' | 'right'
  /** Beam start offset so the pulses cascade down the spine. */
  beamDelay?: number
}

/**
 * One segment of the spine. The container is a fixed {@link RAIL_WIDTH} on
 * desktop, so the branch curve can terminate exactly at the exit pill's inner
 * edge (pills are `w-32` = 128px) with no responsive guesswork.
 */
function Connector({
  height,
  delay,
  active = 0,
  exit,
  side = 'left',
  beamDelay = 0,
}: ConnectorProps) {
  const reduceMotion = useReducedMotion()
  const branchY = height - 26
  const branchEndX = side === 'left' ? 140 : RAIL_WIDTH - 140
  const branchPath = `M ${CENTER} ${height * 0.34} C ${CENTER} ${branchY}, ${
    side === 'left' ? CENTER - 110 : CENTER + 110
  } ${branchY}, ${branchEndX} ${branchY}`

  return (
    <div className='relative w-full' style={{ height }}>
      <svg
        aria-hidden
        width={RAIL_WIDTH}
        height={height}
        viewBox={`0 0 ${RAIL_WIDTH} ${height}`}
        fill='none'
        className='absolute inset-0'>
        <path
          d={`M ${CENTER} 0 V ${height}`}
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          className='text-foreground/15'
        />
        {!reduceMotion && (
          <motion.path
            d={`M ${CENTER} 0 V ${height}`}
            stroke='var(--color-foreground)'
            strokeLinecap='round'
            strokeWidth={1.5}
            strokeDasharray='0.18 0.82'
            pathLength='1'
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: -1 }}
            transition={{ duration: 2, ease: 'linear', delay: beamDelay, repeat: Infinity }}
          />
        )}

        {exit && (
          <>
            <path
              d={branchPath}
              stroke='currentColor'
              strokeLinecap='round'
              strokeDasharray='2 5'
              className='text-foreground/15'
            />
            {!reduceMotion && (
              <motion.path
                d={branchPath}
                stroke={EXITS[exit].dot}
                strokeLinecap='round'
                strokeWidth={1.5}
                strokeDasharray='0.2 0.8'
                pathLength='1'
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: -1 }}
                transition={{
                  duration: 2.6,
                  ease: 'linear',
                  delay: beamDelay + 0.4,
                  repeat: Infinity,
                }}
              />
            )}
          </>
        )}
      </svg>

      {delay && (
        <div
          className='absolute left-1/2 -translate-x-1/2 -translate-y-1/2'
          style={{ top: height * 0.34 }}>
          <DelayPill>
            <Swap id={active}>{delay}</Swap>
          </DelayPill>
        </div>
      )}

      {exit && (
        <div
          className={cn('absolute -translate-y-1/2', side === 'left' ? 'left-0' : 'right-0')}
          style={{ top: branchY }}>
          <ExitPill exit={exit} />
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function DesktopRail({ active, template }: { active: number; template: Template }) {
  const [one, two, three] = template.steps

  return (
    <div className='relative mx-auto flex flex-col items-center' style={{ width: RAIL_WIDTH }}>
      <TriggerNode active={active} template={template} />
      <Connector height={56} beamDelay={0} />
      <EnrollNode />
      <Connector height={104} delay={one.timing} active={active} beamDelay={0.2} />
      <StepNode n={1} subject={one.subject} active={active} />
      <Connector
        height={112}
        delay={two.timing}
        active={active}
        exit='replied'
        side='left'
        beamDelay={0.4}
      />
      <StepNode n={2} subject={two.subject} active={active} />
      <Connector
        height={112}
        delay={three.timing}
        active={active}
        exit='unsubscribed'
        side='right'
        beamDelay={0.6}
      />
      <StepNode n={3} subject={three.subject} active={active} />
      <Connector height={96} exit='bounced' side='left' beamDelay={0.8} />
      <CompletedNode />
    </div>
  )
}

/**
 * Mobile keeps the same spine — the composition is already vertical — but drops
 * the side branches, which have nowhere to go at phone width. The exits are
 * summarised in one row below instead.
 */
function MobileRail({ active, template }: { active: number; template: Template }) {
  const reduceMotion = useReducedMotion()
  const [one, two, three] = template.steps
  /** Drop the "at 9:00 AM" tail — the pill has no room for it at phone width. */
  const short = (timing: string) => timing.split(' at ')[0]!

  const rail = (key: string, height: number, delay?: string) => (
    <div key={key} className='relative w-full' style={{ height }}>
      <svg
        aria-hidden
        width='100%'
        height={height}
        viewBox={`0 0 2 ${height}`}
        preserveAspectRatio='none'
        fill='none'
        className='absolute inset-x-0 mx-auto'
        style={{ width: 2 }}>
        <path
          d={`M 1 0 V ${height}`}
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          className='text-foreground/15'
        />
        {!reduceMotion && (
          <motion.path
            d={`M 1 0 V ${height}`}
            stroke='var(--color-foreground)'
            strokeLinecap='round'
            strokeWidth={1.5}
            strokeDasharray='0.18 0.82'
            pathLength='1'
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: -1 }}
            transition={{ duration: 2, ease: 'linear', repeat: Infinity }}
          />
        )}
      </svg>
      {delay && (
        <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'>
          <DelayPill>
            <Swap id={active}>{delay}</Swap>
          </DelayPill>
        </div>
      )}
    </div>
  )

  return (
    <div className='flex flex-col items-center'>
      <TriggerNode active={active} template={template} compact />
      {rail('a', 48)}
      <EnrollNode compact />
      {rail('b', 64, short(one.timing))}
      <StepNode n={1} subject={one.subject} active={active} compact />
      {rail('c', 64, short(two.timing))}
      <StepNode n={2} subject={two.subject} active={active} compact />
      {rail('d', 64, short(three.timing))}
      <StepNode n={3} subject={three.subject} active={active} compact />
      {rail('e', 48)}
      <CompletedNode />

      <div className='mt-8 w-full border-t pt-5'>
        <div className='mb-2.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground'>
          A run can exit at any point
        </div>
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <ExitPill exit='replied' />
          <ExitPill exit='unsubscribed' />
          <ExitPill exit='bounced' />
        </div>
      </div>
    </div>
  )
}

/**
 * Trigger → enrollment → timed steps → exits, drawn as a spine rather than the
 * fan-in/hub/fan-out used by `mcp-flow-illustration` and
 * `ingestion-flow-illustration`. A sequence is linear, so the illustration is.
 */
export function SequenceRailIllustration() {
  const { active, template } = useTemplateCycle()

  return (
    <div aria-hidden>
      <div className='hidden md:block'>
        <DesktopRail active={active} template={template} />
      </div>
      <div className='md:hidden'>
        <MobileRail active={active} template={template} />
      </div>
    </div>
  )
}

export default SequenceRailIllustration
