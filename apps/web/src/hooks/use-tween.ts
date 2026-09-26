// apps/web/src/hooks/use-tween.ts
'use client'

import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

export interface Tween {
  /** The eased vector for this frame. */
  current: number[]
  /** The target before the one in flight; equals `to` once settled. */
  from: number[]
  to: number[]
  /** 0 → 1 over the tween, 1 when settled. */
  progress: number
}

/** Eases a numeric vector to `target` whenever it changes; the first target is taken as-is. */
export function useTween(target: number[], ms = 250): Tween {
  const reduced = useReducedMotion()
  const [state, setState] = useState<Tween>({
    current: target,
    from: target,
    to: target,
    progress: 1,
  })
  const latest = useRef(state)
  latest.current = state
  const key = target.join(',')

  // `key` is the trigger; the body reads `target` through it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger dep
  useEffect(() => {
    if (latest.current.to.join(',') === key) return
    const to = target
    if (reduced || ms <= 0) {
      setState({ current: to, from: to, to, progress: 1 })
      return
    }
    // A retarget mid-flight eases on from where it is, but fades relative to the old target.
    const start = latest.current.current
    const from = latest.current.to
    const controls = animate(0, 1, {
      duration: ms / 1000,
      ease: 'easeOut',
      onUpdate: (p) =>
        setState({
          current: start.map((s, i) => s + ((to[i] ?? s) - s) * p),
          from,
          to,
          progress: p,
        }),
      onComplete: () => setState({ current: to, from: to, to, progress: 1 }),
    })
    return () => controls.stop()
  }, [key])

  return state
}
