// apps/homepage/src/app/platform/ai/_mocks/use-kopilot-story.ts

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { EntityColor } from './mock-app-sidebar'

/* ---------------------------------------------------------- script types */

export interface KopilotStoryScript {
  turns: ScriptTurn[]
  /** Multiplier on all timings. 1 = realistic, <1 speeds up, >1 slows down. */
  speed?: number
}

export interface ScriptTurn {
  /** Text the user "types" into the composer. */
  user: string
  thinking?: { steps: ThinkingStepInit[] }
  blocks?: ScriptBlock[]
  /** Assistant answer streamed char-by-char. Supports `**bold**` tokens. */
  assistant: string
}

export interface ThinkingStepInit {
  /** Tool icon key — Search | Wrench | Mail | BookOpen | PenTool | Pencil | Plus | Database. */
  icon?: ToolPillIcon
  runningLabel: string
  completedLabel: string
  /** Override per-step running duration. */
  runMs?: number
}

export type ToolPillIcon =
  | 'Search'
  | 'Wrench'
  | 'Mail'
  | 'BookOpen'
  | 'PenTool'
  | 'Pencil'
  | 'Plus'
  | 'Database'
  | 'FileText'

export type ScriptBlock =
  | { kind: 'thread-list'; rows: ThreadRow[] }
  | { kind: 'entity-list'; title?: string; rows: EntityRow[] }
  | { kind: 'plan-steps'; steps: PlanStepRow[] }
  | { kind: 'draft-approval'; recipient: string; subject: string; body: string }

export interface ThreadRow {
  subject: string
  status?: string
  sender?: string
  age?: string
  unread?: boolean
  messageCount?: number
}

export interface EntityRow {
  /** 2-letter code shown in the colored badge. */
  code: string
  color: EntityColor
  title: string
  subtitle?: string
  /** Right-side label (e.g. "VIP"). */
  badge?: string
  /** Below subtitle (e.g. "12 prior tickets"). */
  meta?: string
}

export interface PlanStepRow {
  status: 'completed' | 'running' | 'pending' | 'failed'
  label: string
  detail?: string
}

/* ---------------------------------------------------------- render state */

export type StoryStatus = 'idle' | 'typing' | 'thinking' | 'streaming'

export interface ThinkingStepState extends ThinkingStepInit {
  status: 'running' | 'completed'
}

export interface ThinkingState {
  steps: ThinkingStepState[]
  expanded: boolean
  running: boolean
}

/**
 * One conversation turn. Stays mounted from the moment the user bubble
 * commits through final settle, so motion entrance animations only fire once.
 */
export interface TurnState {
  user: string
  thinking: ThinkingState | null
  blocks: ScriptBlock[]
  /** Grows char-by-char while streaming; full content once settled. */
  assistant: string
  /** True once the turn has finished playing. Drives streaming-cursor visibility. */
  settled: boolean
}

export interface RenderState {
  composer: { typed: string }
  turns: TurnState[]
  status: StoryStatus
}

/* ---------------------------------------------------------- timing */

function constants(speed: number) {
  return {
    INITIAL_DELAY: 250,
    TYPE_MS_PER_CHAR: 30 * speed,
    PAUSE_BEFORE_SUBMIT_MS: 250 * speed,
    THINKING_OPEN_MS: 200 * speed,
    STEP_DEFAULT_RUN_MS: 750 * speed,
    STEP_GAP_MS: 200 * speed,
    BLOCK_REVEAL_GAP_MS: 200 * speed,
    STREAM_MS_PER_CHAR: 18 * speed,
    SETTLE_MS: 250 * speed,
    TURN_GAP_MS: 1500 * speed,
  }
}

/* ---------------------------------------------------------- event queue */

type Mutation = (state: RenderState) => RenderState

interface ScheduledEvent {
  delay: number
  apply: Mutation
}

/** Replace the last element of an array (immutably). */
function replaceLast<T>(arr: T[], updater: (prev: T) => T): T[] {
  if (arr.length === 0) return arr
  const next = arr.slice()
  next[arr.length - 1] = updater(arr[arr.length - 1]!)
  return next
}

function buildEvents(script: KopilotStoryScript, speed: number): ScheduledEvent[] {
  const events: ScheduledEvent[] = []
  const c = constants(speed)

  script.turns.forEach((turn, ti) => {
    // 1. typewriter
    for (let i = 0; i < turn.user.length; i++) {
      const ch = turn.user[i]!
      const delay = i === 0 ? (ti === 0 ? c.INITIAL_DELAY : c.TURN_GAP_MS) : c.TYPE_MS_PER_CHAR
      events.push({
        delay,
        apply: (state) => ({
          ...state,
          status: 'typing',
          composer: { typed: state.composer.typed + ch },
        }),
      })
    }

    // 2. submit — clear composer, push a new turn with user committed
    const userText = turn.user
    events.push({
      delay: c.PAUSE_BEFORE_SUBMIT_MS,
      apply: (state) => ({
        ...state,
        composer: { typed: '' },
        turns: [
          ...state.turns,
          { user: userText, thinking: null, blocks: [], assistant: '', settled: false },
        ],
      }),
    })

    // 3. thinking
    if (turn.thinking?.steps?.length) {
      const steps = turn.thinking.steps

      // Open with the first step running.
      const firstStep = steps[0]!
      events.push({
        delay: c.THINKING_OPEN_MS,
        apply: (state) => ({
          ...state,
          status: 'thinking',
          turns: replaceLast(state.turns, (t) => ({
            ...t,
            thinking: {
              steps: [{ ...firstStep, status: 'running' }],
              expanded: true,
              running: true,
            },
          })),
        }),
      })

      steps.forEach((step, si) => {
        const runMs = step.runMs ?? c.STEP_DEFAULT_RUN_MS

        // Flip this step from running → completed.
        events.push({
          delay: runMs,
          apply: (state) => ({
            ...state,
            turns: replaceLast(state.turns, (t) =>
              t.thinking
                ? {
                    ...t,
                    thinking: {
                      ...t.thinking,
                      steps: t.thinking.steps.map((s, i) =>
                        i === si ? { ...s, status: 'completed' as const } : s
                      ),
                    },
                  }
                : t
            ),
          }),
        })

        // If a next step exists, add it as running after a small gap.
        if (si < steps.length - 1) {
          const nextStep = steps[si + 1]!
          events.push({
            delay: c.STEP_GAP_MS,
            apply: (state) => ({
              ...state,
              turns: replaceLast(state.turns, (t) =>
                t.thinking
                  ? {
                      ...t,
                      thinking: {
                        ...t.thinking,
                        steps: [...t.thinking.steps, { ...nextStep, status: 'running' }],
                      },
                    }
                  : t
              ),
            }),
          })
        }
      })

      // Close thinking — collapse header to "N steps completed".
      events.push({
        delay: c.STEP_GAP_MS,
        apply: (state) => ({
          ...state,
          turns: replaceLast(state.turns, (t) =>
            t.thinking ? { ...t, thinking: { ...t.thinking, running: false, expanded: false } } : t
          ),
        }),
      })
    }

    // 4. blocks
    if (turn.blocks?.length) {
      turn.blocks.forEach((block) => {
        events.push({
          delay: c.BLOCK_REVEAL_GAP_MS,
          apply: (state) => ({
            ...state,
            turns: replaceLast(state.turns, (t) => ({ ...t, blocks: [...t.blocks, block] })),
          }),
        })
      })
    }

    // 5. streaming
    for (let i = 0; i < turn.assistant.length; i++) {
      const ch = turn.assistant[i]!
      events.push({
        delay: i === 0 ? c.BLOCK_REVEAL_GAP_MS : c.STREAM_MS_PER_CHAR,
        apply: (state) => ({
          ...state,
          status: 'streaming',
          turns: replaceLast(state.turns, (t) => ({ ...t, assistant: t.assistant + ch })),
        }),
      })
    }

    // 6. settle — mark turn complete, drop the streaming cursor.
    events.push({
      delay: c.SETTLE_MS,
      apply: (state) => ({
        ...state,
        status: 'idle',
        turns: replaceLast(state.turns, (t) => ({ ...t, settled: true })),
      }),
    })
  })

  return events
}

const initialState: RenderState = {
  composer: { typed: '' },
  turns: [],
  status: 'idle',
}

function buildFinalState(script: KopilotStoryScript): RenderState {
  return {
    composer: { typed: '' },
    turns: script.turns.map((t) => ({
      user: t.user,
      thinking: t.thinking
        ? {
            steps: t.thinking.steps.map((s) => ({ ...s, status: 'completed' as const })),
            expanded: false,
            running: false,
          }
        : null,
      blocks: t.blocks ?? [],
      assistant: t.assistant,
      settled: true,
    })),
    status: 'idle',
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * One-shot animated playback of a Kopilot story script. Returns the current
 * render state plus a ref to attach to a container — playback starts the
 * first time the container intersects the viewport. Honours
 * `prefers-reduced-motion`.
 */
export function useKopilotStory<T extends Element = HTMLDivElement>(
  script: KopilotStoryScript
): { state: RenderState; ref: React.RefObject<T | null> } {
  const speed = script.speed ?? 1
  const ref = useRef<T | null>(null)
  const reduced = useMemo(prefersReducedMotion, [])

  const [state, setState] = useState<RenderState>(() =>
    reduced ? buildFinalState(script) : initialState
  )

  const events = useMemo(
    () => (reduced ? [] : buildEvents(script, speed)),
    [script, speed, reduced]
  )

  const startedRef = useRef(false)
  const [armed, setArmed] = useState(false)

  // IntersectionObserver — start playback when ≥30% of container is visible.
  useEffect(() => {
    if (reduced) return
    if (startedRef.current) return
    const node = ref.current
    if (!node) return

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true
            setArmed(true)
            obs.disconnect()
          }
        }
      },
      { threshold: 0.3 }
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [reduced])

  // Event loop — chained setTimeout, single timer at a time.
  useEffect(() => {
    if (!armed) return
    if (events.length === 0) return

    let cancelled = false
    let cursor = 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const tick = () => {
      if (cancelled) return
      const ev = events[cursor]
      if (!ev) return
      cursor++
      setState((prev) => ev.apply(prev))
      const next = events[cursor]
      if (next) {
        timeoutId = setTimeout(tick, next.delay)
      }
    }

    timeoutId = setTimeout(tick, events[0]!.delay)
    return () => {
      cancelled = true
      if (timeoutId !== null) clearTimeout(timeoutId)
    }
  }, [armed, events])

  return { state, ref }
}
