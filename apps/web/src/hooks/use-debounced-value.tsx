import { useCallback, useEffect, useRef, useState } from 'react'

export function useDebouncedValue<T = any>(value: T, wait: number, options = { leading: false }) {
  const [_value, setValue] = useState(value)
  const mountedRef = useRef(false)
  const timeoutRef = useRef<number | null>(null)
  const cooldownRef = useRef(false)

  const cancel = () => window.clearTimeout(timeoutRef.current!)

  useEffect(() => {
    if (mountedRef.current) {
      if (!cooldownRef.current && options.leading) {
        cooldownRef.current = true
        setValue(value)
      } else {
        cancel()
        timeoutRef.current = window.setTimeout(() => {
          cooldownRef.current = false
          setValue(value)
        }, wait)
      }
    }
  }, [value, options.leading, wait])

  useEffect(() => {
    mountedRef.current = true
    return cancel
  }, [])

  return [_value, cancel] as const
}

/**
 * A hook that debounces a value to prevent excessive updates
 * @param value The value to debounce
 * @param delay The delay in milliseconds
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    // Set a timeout to update the debounced value after the specified delay
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    // Clean up the timeout if the value changes before the delay has elapsed
    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}

/**
 * A hook that debounces a callback function to prevent excessive calls
 * @param callback The callback function to debounce
 * @param delay The delay in milliseconds
 * @returns The debounced callback function with a cancel method
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): T & { cancel: () => void } {
  const callbackRef = useRef(callback)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const leadingCalledRef = useRef(false)

  const { leading = false, trailing = true } = options

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
    // Reset leading gate so next call can trigger again
    leadingCalledRef.current = false
  }, [])

  const debouncedCallback = useCallback(
    ((...args: Parameters<T>) => {
      // Leading edge execution
      if (leading && !leadingCalledRef.current) {
        leadingCalledRef.current = true
        callbackRef.current(...args)
      }

      // Trailing edge execution
      if (trailing) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(() => {
          // When trailing fires, allow a future leading call again
          leadingCalledRef.current = false
          callbackRef.current(...args)
        }, delay)
      } else if (leading) {
        // If only leading, set a cooldown timer to reset leading gate
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(() => {
          leadingCalledRef.current = false
        }, delay)
      }
    }) as T,
    [delay, leading, trailing]
  )

  // Add cancel method to the debounced callback
  ;(debouncedCallback as any).cancel = cancel

  return debouncedCallback as T & { cancel: () => void }
}
