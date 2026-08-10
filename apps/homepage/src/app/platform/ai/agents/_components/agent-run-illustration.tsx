// apps/homepage/src/app/platform/ai/agents/_components/agent-run-illustration.tsx
'use client'

import {
  ArrowRight,
  Code2,
  Flag,
  GitBranch,
  Hand,
  Info,
  ListChecks,
  Pause,
  Square,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MockAssistantSlot,
  MockToolStatusPill,
  MockUserMessage,
  type ToolPillIcon,
} from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'
import { MockAgentPanel } from '../_mocks'
import { type AgentCastMember, agentById } from './agent-cast'
import { AgentPortrait } from './agent-portrait'
import { AGENT_SCRIPTS, type AgentScript, type RunEntry } from './agent-scripts'

/**
 * Fixed heights, so revealing an entry or opening a procedure never moves the
 * page below. Side by side the two columns share one box; stacked they need one
 * each, and a phone-width column wraps far more, so its box is taller.
 *
 * The stacked pins are deliberately under the tallest agent rather than over
 * it: measured at 314px — what a 390px viewport leaves inside the section's
 * rails — the four scripts span 79–570px of run and 445–710px of panel, so
 * pinning to the maximum left the short agents as a half-empty box. Both lists
 * scroll instead, and both keep the part that matters in view: the run sticks
 * to its newest entry, the panel to its active line.
 */
const GRID_H = 'lg:h-[640px]'
const RUN_H = 'h-[420px] lg:h-full'
const PANEL_H = 'h-[560px] lg:h-full'

/** Default per-entry dwell. Individual entries can override it. */
const STEP_MS = 950
/** Hold on the terminal entry before moving to the next agent. */
const AGENT_HOLD_MS = 1900

/** Maps our registered tool names onto the pill icon set the Kopilot mocks ship. */
const TOOL_ICONS: Record<string, ToolPillIcon> = {
  get_entity: 'Database',
  search_entities: 'Search',
  search_knowledge: 'BookOpen',
  update_entity: 'Pencil',
  reply_to_thread: 'Mail',
  create_task: 'Plus',
  create_note: 'FileText',
}

/* -------------------------------------------------------------------------- */
/* Playback                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Playback starts with the first entry already on screen. `step` is a count of
 * revealed entries, so starting at 0 leaves the run column blank for a whole
 * dwell after every chip click — the switch reads as a stall. Every script
 * opens on its trigger (a user message or a system line), which is exactly the
 * thing that should be there the instant you pick an agent.
 */
const FIRST_STEP = 1

function useRunPlayback(scripts: AgentScript[]) {
  const reduceMotion = useReducedMotion()
  const [agentIndex, setAgentIndex] = useState(0)
  const [step, setStep] = useState(FIRST_STEP)
  const [paused, setPaused] = useState(false)

  const script = scripts[agentIndex] ?? scripts[0]!
  const total = script.run.length
  const revealed = reduceMotion ? total : step

  useEffect(() => {
    if (reduceMotion || paused) return

    if (step < total) {
      const entry = script.run[step]
      const timer = setTimeout(() => setStep((s) => s + 1), entry?.dwell ?? STEP_MS)
      return () => clearTimeout(timer)
    }

    const timer = setTimeout(() => {
      setAgentIndex((i) => (i + 1) % scripts.length)
      setStep(FIRST_STEP)
    }, AGENT_HOLD_MS)
    return () => clearTimeout(timer)
  }, [step, total, paused, reduceMotion, script, scripts.length])

  /**
   * Picking an agent also lifts the hover pause. The cursor is inside the
   * illustration by definition when you click a chip, so `onMouseEnter` has
   * already paused playback — without this the run you just asked for sits on
   * its first entry until you move the mouse back out of the section.
   */
  const selectAgent = useCallback((index: number) => {
    setAgentIndex(index)
    setStep(FIRST_STEP)
    setPaused(false)
  }, [])

  /** Scrub to the last entry belonging to a procedure line. */
  const scrubToLine = useCallback(
    (lineId: string) => {
      const last = script.run.reduce((acc, entry, i) => (entry.line === lineId ? i : acc), -1)
      if (last >= 0) setStep(last + 1)
    },
    [script]
  )

  return {
    agentIndex,
    script,
    revealed,
    reduceMotion,
    selectAgent,
    scrubToLine,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  }
}

/* -------------------------------------------------------------------------- */
/* Run column                                                                  */
/* -------------------------------------------------------------------------- */

function RunRow({ entry, agent }: { entry: RunEntry; agent: AgentCastMember }) {
  switch (entry.kind) {
    case 'user':
      return <MockUserMessage text={entry.text} />
    case 'assistant':
      return (
        <MockAssistantSlot
          thinking={null}
          blocks={<AgentByline agent={agent} />}
          content={entry.text}
          streaming={false}
        />
      )
    case 'tool':
      return (
        <MockToolStatusPill
          step={{
            status: 'completed',
            icon: TOOL_ICONS[entry.name] ?? 'Wrench',
            runningLabel: entry.name,
            completedLabel: `${entry.name} · ${entry.detail}`,
          }}
        />
      )
    case 'signal':
      return (
        <div className='inline-flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1 text-xs text-muted-foreground'>
          <Flag className='size-3 shrink-0' />
          <span className='font-mono text-[11px]'>{entry.name}</span>
        </div>
      )
    case 'select':
      return (
        <div className='flex flex-col gap-1'>
          <div
            className={cn(
              'inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium',
              agent.accent.chip
            )}>
            <ListChecks className='size-3 shrink-0' />
            Procedure selected
          </div>
          <p className='pl-1 text-[11px] italic text-muted-foreground'>{entry.note}</p>
        </div>
      )
    case 'branch':
      return (
        <div className='inline-flex items-center gap-1.5 rounded-lg border bg-mock-window px-2 py-1 text-xs text-mock-window-foreground'>
          <GitBranch className='size-3 shrink-0 text-muted-foreground' />
          {entry.text}
        </div>
      )
    case 'code':
      return (
        <div className='inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-700 dark:text-indigo-300'>
          <Code2 className='size-3 shrink-0 opacity-70' />
          {entry.text}
        </div>
      )
    case 'approval':
      return (
        <div className='inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300'>
          <Pause className='size-3 shrink-0' />
          {entry.text}
        </div>
      )
    case 'note':
      return (
        <div className='flex items-start gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] italic text-muted-foreground'>
          <Info className='mt-px size-3 shrink-0' />
          {entry.text}
        </div>
      )
    case 'system':
      return (
        <div className='inline-flex items-center gap-1.5 text-[11px] text-muted-foreground'>
          <Zap className='size-3 shrink-0' />
          {entry.text}
        </div>
      )
    case 'terminal':
      return (
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium',
            entry.tone === 'handoff'
              ? 'bg-red-500/10 text-red-700 dark:text-red-300'
              : 'bg-foreground/10 text-foreground'
          )}>
          {entry.tone === 'handoff' ? (
            <Hand className='size-3 shrink-0' />
          ) : (
            <Square className='size-3 shrink-0' />
          )}
          {entry.text}
        </div>
      )
  }
}

/**
 * The agent's face + name above its reply. `MockAssistantSlot` renders the
 * generic Kopilot sparkle in its icon column; this says *which* agent is
 * talking, which is the whole point of casting portraits in the chips.
 */
function AgentByline({ agent }: { agent: AgentCastMember }) {
  return (
    <div className='flex items-center gap-1.5 pb-0.5'>
      <AgentPortrait agent={agent} size={18} ring />
      <span className='text-[11px] font-medium text-muted-foreground'>{agent.name}</span>
    </div>
  )
}

function RunColumn({
  script,
  agent,
  revealed,
  reduceMotion,
}: {
  script: AgentScript
  agent: AgentCastMember
  revealed: number
  reduceMotion: boolean | null
}) {
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * Keep the newest entry in view, the way a chat does. A no-op while the run
   * fits its box — it earns its keep on a phone, where the pinned height is
   * under the longest script and the terminal entry (the payoff) would
   * otherwise sit below the fold.
   *
   * Observing the content rather than reacting to `revealed`: an entry's
   * `layout` animation keeps growing the list for ~280ms after the render that
   * added it, so a scroll issued on the state change lands short. Scrolling
   * this box never moves the page, unlike `scrollIntoView`. Scrolling up
   * releases the pin, so reading back through a run isn't fought.
   */
  useEffect(() => {
    const el = listRef.current
    const content = el?.firstElementChild
    if (!el || !content) return

    let pinned = true
    const stick = () => {
      if (pinned) el.scrollTop = el.scrollHeight
    }
    const release = () => {
      pinned = el.scrollHeight - el.clientHeight - el.scrollTop < 24
    }

    const observer = new ResizeObserver(stick)
    observer.observe(content)
    el.addEventListener('scroll', release, { passive: true })
    stick()

    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', release)
    }
  }, [])

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-zinc-200/30 dark:bg-white/[0.03]'>
      <div className='flex items-center justify-between px-3 pt-1 pb-2'>
        <span className='text-xs font-semibold uppercase leading-4 text-zinc-500'>Run</span>
        <span className='inline-flex items-center gap-1 text-[11px] text-muted-foreground'>
          <span className='size-1.5 rounded-full bg-emerald-500' />
          live
        </span>
      </div>

      <div ref={listRef} className='flex min-h-0 flex-1 flex-col overflow-y-auto p-3'>
        {/* Stacked, the box is shorter than the longest script, so a short run
            settles at the bottom the way a chat does and the headroom above it
            reads as an empty transcript rather than a half-filled card. Side by
            side the box is tuned to hold every script, so entries stay top-
            aligned with the persona card opposite them.

            `mt-auto` rather than `justify-end`: once the run outgrows the box
            the margin collapses to zero and the top entries stay reachable,
            where `justify-end` would push them out of the scrollable area. */}
        <div className='mt-auto flex w-full flex-col items-start gap-1.5 lg:mt-0'>
          <AnimatePresence initial={false}>
            {script.run.slice(0, revealed).map((entry, i) => (
              <motion.div
                key={`${script.agentId}-${i}`}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, y: 6, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.28 }}
                className='w-full'>
                <RunRow entry={entry} agent={agent} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Chips                                                                       */
/* -------------------------------------------------------------------------- */

function AgentChips({
  activeIndex,
  onSelect,
}: {
  activeIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <div className='-mx-6 flex snap-x gap-2 overflow-x-auto px-6 pb-2 lg:mx-0 lg:flex-wrap lg:justify-center lg:overflow-visible lg:px-0'>
      {AGENT_SCRIPTS.map((script, index) => {
        const agent = agentById(script.agentId)
        const isActive = index === activeIndex
        return (
          <button
            key={script.agentId}
            type='button'
            onClick={() => onSelect(index)}
            aria-pressed={isActive}
            className={cn(
              'flex shrink-0 snap-start items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all',
              isActive
                ? 'border-foreground/15 bg-card shadow-sm'
                : 'border-transparent bg-transparent opacity-70 hover:opacity-100'
            )}>
            {/* The layout box is always 44px and the inactive state shrinks
                with a transform, so the growth is purely visual and the chip
                row's height never changes. It also keeps `sizes` stable, so
                activating a chip doesn't request a second image. */}
            <AgentPortrait
              agent={agent}
              size={44}
              ring={isActive}
              className={cn(
                'origin-center transition-transform duration-300',
                !isActive && 'scale-[0.818] grayscale-[0.35]'
              )}
            />
            <span className='flex flex-col'>
              <span className='text-sm font-medium text-foreground'>{agent.name}</span>
              <span className='text-[11px] text-muted-foreground'>{agent.trigger}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The authored procedure on the left, the live run on the right, stepping in
 * sync. Clicking a paragraph scrubs the run to that point; hovering pauses.
 *
 * Four agents, four trigger kinds, four procedure shapes. Knowledge keeper is
 * deliberately absent: it has no procedure, so it has nothing to show here.
 */
export default function AgentRunIllustration() {
  const { agentIndex, script, revealed, reduceMotion, selectAgent, scrubToLine, pause, resume } =
    useRunPlayback(AGENT_SCRIPTS)

  const agent = agentById(script.agentId)
  const shown = script.run.slice(0, revealed)
  // The procedure opens only once selection has actually been revealed, so the
  // list stays closed for the opening beat.
  const openedId = shown.some((e) => e.kind === 'select') ? script.selectedId : null
  const activeLine = shown[shown.length - 1]?.line

  return (
    <div onMouseEnter={pause} onMouseLeave={resume} className='mx-auto w-full max-w-4xl text-left'>
      <AgentChips activeIndex={agentIndex} onSelect={selectAgent} />

      {/*
       * Both columns are pinned. Without it the grid's height is driven by
       * whichever column is taller, and that swings ~180px every time a
       * procedure opens or collapses — which is what made the page below jump
       * when you clicked a chip (a click resets to step 0, closing the
       * procedure, and it then reopens a beat later).
       *
       * `min-w-0` on both: a grid item's automatic minimum is its min-content
       * width, and the procedure rows' `truncate` summaries are a single
       * unbreakable line ~480px wide. Stacked, that is the *only* column, so it
       * sized the track to 480px inside a 314px viewport and the run bubbles,
       * persona and procedure prose all ran off the right edge with no
       * horizontal scroll to recover them.
       */}
      <div className={cn('mt-6 grid gap-4 lg:grid-cols-2', GRID_H)}>
        <MockAgentPanel
          agent={agent}
          persona={script.persona}
          procedures={script.procedures}
          selectedId={script.selectedId}
          version={script.version}
          openedId={openedId}
          activeLine={activeLine}
          onSelectLine={scrubToLine}
          reduceMotion={reduceMotion}
          className={cn('order-2 min-w-0 lg:order-1', PANEL_H)}
        />

        {/* Run first on a phone: it is the payoff, the document is context. */}
        <div className={cn('order-1 min-h-0 min-w-0 lg:order-2', RUN_H)}>
          <RunColumn
            script={script}
            agent={agent}
            revealed={revealed}
            reduceMotion={reduceMotion}
          />
        </div>
      </div>

      <div className='mt-4 min-h-[44px]'>
        <AnimatePresence mode='wait'>
          {script.caption && (
            <motion.p
              key={script.agentId}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.3 }}
              className='text-balance text-center text-sm text-muted-foreground'>
              {script.caption.text}{' '}
              <Link
                href={script.caption.href}
                className='inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline'>
                {script.caption.linkLabel}
                <ArrowRight className='size-3' />
              </Link>
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
