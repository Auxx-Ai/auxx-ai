// packages/lib/src/utils/functions.ts

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 *
 * The constraint uses `never[]` rather than `unknown[]`: parameters are
 * contravariant, so `(...args: unknown[]) => unknown` only accepts callbacks
 * whose parameters accept `unknown` — i.e. zero-arg ones. `never[]` accepts any
 * signature while still letting `Parameters<T>` recover the real argument list.
 */
export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, wait)
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
}

/**
 * Creates a throttled version of a function that limits execution
 * to at most once per the specified interval.
 *
 * The constraint uses `never[]` for the same contravariance reason as
 * `debounce` above — `unknown[]` would only accept zero-arg callbacks.
 */
export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    const now = Date.now()
    const remaining = ms - (now - last)
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      last = now
      fn(...args)
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now()
        timer = null
        fn(...args)
      }, remaining)
    }
  }
}
