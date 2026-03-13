// apps/homepage/src/app/_components/sections/workflow-animation/use-workflow-animation.ts

'use client'

import { useEffect, useState } from 'react'

/**
 * Returns which nodes along the happy path are "active" (data has reached them).
 * Activates nodes sequentially after scroll triggers the animation.
 */
export function useWorkflowAnimation(inView: boolean) {
  const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!inView) return

    const happyPathTimeline: { nodeId: string; delay: number }[] = [
      { nodeId: 'message-received', delay: 2300 },
      { nodeId: 'text-classifier', delay: 2600 },
      { nodeId: 'if-else', delay: 2900 },
      { nodeId: 'ai', delay: 3200 },
      { nodeId: 'answer', delay: 3500 },
    ]

    const timers: ReturnType<typeof setTimeout>[] = []

    for (const { nodeId, delay } of happyPathTimeline) {
      const timer = setTimeout(() => {
        setActiveNodes((prev) => new Set([...prev, nodeId]))
      }, delay)
      timers.push(timer)
    }

    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [inView])

  return { activeNodes }
}
