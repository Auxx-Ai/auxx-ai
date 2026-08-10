// apps/homepage/src/app/platform/ai/agents/_components/eval-loop-illustration.tsx
'use client'

import { ArrowDown, ArrowRight, ArrowUp, Check, Sparkles, TriangleAlert, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { cn } from '~/lib/utils'
import { agentById } from './agent-cast'
import { AgentPortrait } from './agent-portrait'
import { type CaseStatus, EVAL_CASES, KOPILOT_FIX, RUN_LABELS, SUITE_DIFF } from './eval-scripts'

type Phase = 'before' | 'fix' | 'after'

const RESOLVE_MS = { before: 420, after: 220 }
const HOLD_MS = { before: 1900, fix: 3400, after: 4200 }
const TOTAL_CASES = EVAL_CASES.length

/* -------------------------------------------------------------------------- */

function useSuitePlayback() {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('before')
  const [resolved, setResolved] = useState(0)
  const [scrubbed, setScrubbed] = useState(false)
  const [paused, setPaused] = useState(false)

  const frozen = reduceMotion || scrubbed

  useEffect(() => {
    if (frozen || paused) return

    if (phase === 'fix') {
      const timer = setTimeout(() => {
        setPhase('after')
        setResolved(0)
      }, HOLD_MS.fix)
      return () => clearTimeout(timer)
    }

    if (resolved < TOTAL_CASES) {
      const timer = setTimeout(() => setResolved((r) => r + 1), RESOLVE_MS[phase])
      return () => clearTimeout(timer)
    }

    const timer = setTimeout(
      () => {
        if (phase === 'before') {
          setPhase('fix')
        } else {
          setPhase('before')
          setResolved(0)
        }
      },
      phase === 'before' ? HOLD_MS.before : HOLD_MS.after
    )
    return () => clearTimeout(timer)
  }, [phase, resolved, frozen, paused])

  /** Clicking a run tab pins that board and stops the loop. */
  const scrubTo = (next: Phase) => {
    setScrubbed(true)
    setPhase(next)
    setResolved(TOTAL_CASES)
  }

  return {
    phase,
    resolved: frozen ? TOTAL_CASES : resolved,
    reduceMotion,
    scrubTo,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  }
}

/* -------------------------------------------------------------------------- */

function StatusChip({ status, errorCode }: { status: CaseStatus; errorCode?: string }) {
  if (status === 'passed') {
    return (
      <span className='inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400'>
        <Check className='size-3' />
        passed
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className='inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400'>
        <X className='size-3' />
        failed
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400'>
      <TriangleAlert className='size-3' />
      error
      {errorCode && <span className='font-mono text-[10px] opacity-80'>· {errorCode}</span>}
    </span>
  )
}

function CaseRow({
  name,
  assertions,
  status,
  errorCode,
  resolved,
  reduceMotion,
}: {
  name: string
  assertions: { label: string; judged?: boolean }[]
  status: CaseStatus
  errorCode?: string
  resolved: boolean
  reduceMotion: boolean | null
}) {
  return (
    <div className='flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3'>
      <span className='min-w-0 flex-1 truncate text-xs font-medium text-foreground'>{name}</span>

      <span className='flex flex-wrap items-center gap-1'>
        {assertions.map((assertion) => (
          <span
            key={assertion.label}
            className={cn(
              'rounded-md px-1.5 py-0.5 font-mono text-[10px]',
              assertion.judged
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
            )}>
            {assertion.label}
          </span>
        ))}
      </span>

      {/* `h-5` is the resolved chip's height. Stacked on a phone the row is a
          column, so without it the row grew as each case resolved and swapped a
          6px pending bar for the chip — five separate nudges per loop. */}
      <span className='flex h-5 w-[150px] shrink-0 items-center'>
        <AnimatePresence mode='wait' initial={false}>
          {resolved ? (
            <motion.span
              key='resolved'
              initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 20 }}>
              <StatusChip status={status} errorCode={errorCode} />
            </motion.span>
          ) : (
            <motion.span
              key='pending'
              exit={{ opacity: 0 }}
              className='h-1.5 w-16 overflow-hidden rounded-full bg-muted'>
              <motion.span
                className='block h-full w-1/2 rounded-full bg-foreground/20'
                animate={reduceMotion ? undefined : { x: ['-100%', '200%'] }}
                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.1, ease: 'linear' }}
              />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  )
}

function DiffHeader({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[11px] transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}>
      <span className='inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400'>
        <ArrowUp className='size-3' />
        {SUITE_DIFF.fixed} fixed
      </span>
      <span className='inline-flex items-center gap-1 text-muted-foreground'>
        <ArrowRight className='size-3' />
        {SUITE_DIFF.stillPassing} still passing
      </span>
      <span className='inline-flex items-center gap-1 text-muted-foreground'>
        <ArrowDown className='size-3' />
        {SUITE_DIFF.regressed} regressed
      </span>
      <span className='ml-auto text-muted-foreground'>
        Pass rate {SUITE_DIFF.passRateBefore}% → {SUITE_DIFF.passRateAfter}%
      </span>
    </div>
  )
}

/**
 * Stays mounted and fades, rather than entering and leaving. Mounting it added
 * its whole height to the board mid-loop; animating a permanent element gets
 * the same motion out of a slot whose size never changes. The stagger still
 * replays on every pass, because the chips animate toward a target that flips
 * with `active`.
 */
function KopilotCard({ active, reduceMotion }: { active: boolean; reduceMotion: boolean | null }) {
  return (
    <motion.div
      aria-hidden={!active}
      initial={false}
      animate={
        reduceMotion
          ? { opacity: active ? 1 : 0 }
          : {
              opacity: active ? 1 : 0,
              y: active ? 0 : 12,
              filter: active ? 'blur(0px)' : 'blur(6px)',
            }
      }
      transition={{ duration: 0.35 }}
      className='col-start-1 row-start-1 m-3 self-start rounded-xl border bg-muted/40 p-3'>
      <div className='flex items-center gap-1.5 text-xs font-medium text-foreground'>
        <Sparkles className='size-3.5 text-amber-500' />
        Kopilot
      </div>
      <p className='mt-1.5 text-xs leading-relaxed text-muted-foreground'>{KOPILOT_FIX.message}</p>
      <div className='mt-2.5 flex flex-wrap gap-1'>
        {KOPILOT_FIX.tools.map((toolName, i) => (
          <motion.span
            key={toolName}
            initial={false}
            animate={{ opacity: active ? 1 : 0, scale: active ? 1 : 0.9 }}
            transition={{ delay: reduceMotion || !active ? 0 : 0.5 + i * 0.4, duration: 0.25 }}
            className='inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'>
            <Check className='size-2.5 text-emerald-500' />
            {toolName}
          </motion.span>
        ))}
      </div>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * A suite that runs, fails, gets fixed by Kopilot, and re-runs into a diff.
 *
 * The `Run 12 / Run 13` tabs are the point of making this interactive rather
 * than a looping video: they let you hold the before and after side by side.
 *
 * Nothing in the board mounts or unmounts across the three phases — the two
 * footers share a grid cell and the status cell is a fixed height — so its
 * height is the same in every phase and the page below never moves. The
 * `min-h` is only a floor for the short desktop state, not what holds the
 * layout still.
 */
export default function EvalLoopIllustration() {
  const { phase, resolved, reduceMotion, scrubTo, pause, resume } = useSuitePlayback()
  const agent = agentById('refund')
  const showingAfter = phase === 'after'
  const showNote = phase === 'before' && resolved === EVAL_CASES.length

  return (
    <div onMouseEnter={pause} onMouseLeave={resume} className='mx-auto w-full max-w-3xl text-left'>
      <div className='mb-4 flex justify-center'>
        <div className='inline-flex rounded-lg border bg-card p-0.5'>
          {(['before', 'after'] as const).map((key) => (
            <button
              key={key}
              type='button'
              onClick={() => scrubTo(key)}
              aria-pressed={phase === key}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                phase === key
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              {RUN_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className='flex min-h-[440px] flex-col overflow-hidden rounded-2xl border bg-card ring-1 ring-foreground/5'>
        <div className='flex items-center gap-2 border-b px-3 py-2.5'>
          <AgentPortrait agent={agent} size={28} ring />
          <span className='text-xs font-medium text-foreground'>{agent.name}</span>
          <span className='truncate text-[11px] text-muted-foreground'>
            · Refund requests v4 · {EVAL_CASES.length} cases
          </span>
          <span className='ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'>
            {phase === 'fix' ? RUN_LABELS.before : RUN_LABELS[phase]}
          </span>
        </div>

        <DiffHeader visible={showingAfter && resolved === EVAL_CASES.length} />

        <div className='divide-y'>
          {EVAL_CASES.map((evalCase, index) => (
            <CaseRow
              key={evalCase.id}
              name={evalCase.name}
              assertions={evalCase.assertions}
              status={showingAfter ? evalCase.after : evalCase.before}
              errorCode={showingAfter ? undefined : evalCase.errorCode}
              resolved={phase === 'fix' ? true : index < resolved}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>

        {/*
         * One slot for both phase footers, stacked in the same grid cell and
         * crossfaded — the same trick `DiffHeader` uses. The cell is as tall as
         * the taller of the two at whatever width it lands on, so the board
         * measures the same in all three phases without pinning a height that
         * would have to be re-measured per breakpoint. `self-start` keeps each
         * at its natural height instead of stretching to the cell.
         */}
        <div className='grid grid-cols-1 grid-rows-1'>
          <KopilotCard active={phase === 'fix'} reduceMotion={reduceMotion} />

          <p
            aria-hidden={!showNote}
            className={cn(
              'col-start-1 row-start-1 m-3 self-start rounded-lg bg-amber-500/[0.07] px-3 py-2 text-[11px] italic text-muted-foreground transition-opacity duration-300',
              showNote ? 'opacity-100' : 'opacity-0'
            )}>
            The last one didn&apos;t fail, it errored: a tool call had no stub, so the run
            couldn&apos;t finish. Nothing passes on a technicality here.
          </p>
        </div>
      </div>
    </div>
  )
}
