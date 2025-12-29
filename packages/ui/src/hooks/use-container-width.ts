// packages/ui/src/hooks/use-container-width.ts

'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Hook to measure and track a container element's width using ResizeObserver
 * @returns Tuple of [ref to attach to element, current width in pixels]
 */
export function useContainerWidth<T extends HTMLElement = HTMLElement>(): [
  React.RefObject<T | null>,
  number,
] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === element) {
          setWidth(Math.floor(entry.contentRect.width))
        }
      }
    })

    observer.observe(element)

    // Initial measurement
    setWidth(Math.floor(element.getBoundingClientRect().width))

    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
