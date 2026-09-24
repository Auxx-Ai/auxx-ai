// packages/ui/src/components/phase-list.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

/** A phase's outcome when it is known, overriding the position-derived state. */
export type PhaseStatus = 'done' | 'skipped' | 'failed'

interface PhaseListProps<T extends string> {
  /** Every phase, in order; the whole list renders up front. */
  phases: readonly T[]
  labels: Record<T, ReactNode>
  /** The phase in progress; the ones before it show as done. */
  current: T | null
  /** Everything finished: every phase shows as done. */
  done?: boolean
  /** Stops the spinner on the current phase. */
  failed?: boolean
  /** Per-phase outcomes, for a job that reports each step's result. */
  statuses?: Partial<Record<T, PhaseStatus>>
  className?: string
}

/** A checklist of a long job's phases: done ones ticked, the current one spinning. */
export function PhaseList<T extends string>({
  phases,
  labels,
  current,
  done = false,
  failed = false,
  statuses,
  className,
}: PhaseListProps<T>) {
  const currentIndex = current ? phases.indexOf(current) : -1
  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {phases.map((phase, index) => {
        const status = statuses?.[phase]
        const isDone = status ? status === 'done' : done || index < currentIndex
        const isActive = !status && !done && index === currentIndex
        return (
          <li key={phase} className='flex items-center gap-2.5 text-sm'>
            <span className='flex size-5 items-center justify-center'>
              {status === 'failed' ? (
                <AlertTriangle className='size-4 text-amber-500' />
              ) : isDone ? (
                <Check className='size-4 text-green-600' />
              ) : isActive && !failed ? (
                <Loader2 className='size-4 animate-spin text-muted-foreground' />
              ) : (
                <span className='size-1.5 rounded-full bg-muted-foreground/40' />
              )}
            </span>
            <span className={isDone || isActive ? '' : 'text-muted-foreground'}>
              {labels[phase]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Simulated progress for a job that reports none: steps through `phases` every `intervalMs` while
 * `active`, starting over after the last. Returns null when inactive.
 */
export function useCyclingPhase<T extends string>(
  phases: readonly T[],
  active: boolean,
  intervalMs = 1500
): T | null {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!active) return
    setIndex(0)
    const timer = setInterval(() => setIndex((prev) => (prev + 1) % phases.length), intervalMs)
    return () => clearInterval(timer)
  }, [active, intervalMs, phases.length])
  return active ? (phases[index] ?? null) : null
}
