// apps/web/src/lib/extensions/components/workflow/inputs/use-debounced-callback.ts

import { useCallback, useEffect, useRef } from 'react'

/**
 * Creates a debounced version of a callback function.
 * Delays execution until after the specified delay has elapsed since the last call.
 *
 * @param callback - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns Debounced version of the callback
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout>()
  const callbackRef = useRef(callback)

  // ✓ Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback(
    (...args: Parameters<T>) => {
      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args) // ✓ Use ref - always gets latest
      }, delay)
    },
    [delay] // ✓ Only delay in deps
  ) as T
}
