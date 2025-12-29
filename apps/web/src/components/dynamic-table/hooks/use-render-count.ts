// apps/web/src/components/dynamic-table/hooks/use-render-count.ts
'use client'

import { useRef, useEffect } from 'react'

/**
 * Debug hook to count component renders
 * Usage: const renderCount = useRenderCount('ComponentName')
 *
 * Enable by setting window.__TABLE_PERF_DEBUG__ = true in console
 */
export function useRenderCount(componentName: string): number {
  const renderCount = useRef(0)
  renderCount.current += 1

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).__TABLE_PERF_DEBUG__) {
      console.log(`[RENDER] ${componentName}: ${renderCount.current}`)
    }
  })

  return renderCount.current
}

/**
 * Performance measurement utilities
 *
 * Run these in browser console:
 *
 * // Enable render counting
 * window.__TABLE_PERF_DEBUG__ = true
 *
 * // Measure scroll performance
 * window.__measureTablePerf__ = () => {
 *   const metrics = { renders: 0, scrollEvents: 0, startTime: performance.now() }
 *   const observer = new PerformanceObserver((list) => {
 *     for (const entry of list.getEntries()) {
 *       if (entry.entryType === 'longtask') {
 *         console.warn(`Long task: ${entry.duration}ms`)
 *       }
 *     }
 *   })
 *   observer.observe({ entryTypes: ['longtask'] })
 *
 *   setTimeout(() => {
 *     observer.disconnect()
 *     console.log(`Test duration: ${performance.now() - metrics.startTime}ms`)
 *   }, 10000)
 *
 *   return metrics
 * }
 */
