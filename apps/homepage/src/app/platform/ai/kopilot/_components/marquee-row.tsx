// apps/homepage/src/app/platform/ai/kopilot/_components/marquee-row.tsx

'use client'

import { type ReactNode, useEffect, useRef } from 'react'

const RAMP_MS = 2000

export function MarqueeRow({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let frame = 0
    let rampStart = 0
    let from = 1
    let to = 1

    const getAnimation = () => el.getAnimations()[0]

    const tick = (now: number) => {
      const anim = getAnimation()
      if (!anim) return
      const t = Math.min(1, (now - rampStart) / RAMP_MS)
      const eased = 1 - (1 - t) * (1 - t)
      anim.playbackRate = from + (to - from) * eased
      if (t < 1) frame = requestAnimationFrame(tick)
    }

    const rampTo = (target: number) => {
      const anim = getAnimation()
      if (!anim) return
      cancelAnimationFrame(frame)
      from = anim.playbackRate
      to = target
      rampStart = performance.now()
      frame = requestAnimationFrame(tick)
    }

    const onEnter = () => rampTo(0)
    const onLeave = () => rampTo(1)

    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <ul ref={ref} className={className}>
      {children}
    </ul>
  )
}
