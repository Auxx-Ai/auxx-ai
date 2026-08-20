// packages/utils/src/functions.ts

/**
 * Options for {@link debounce}.
 */
export interface DebounceOptions {
  /**
   * Upper bound, in milliseconds, on how long a call may be deferred. Without
   * it a continuously-retriggered debounce never fires at all — which is how a
   * long typing session in the workflow builder could go unsaved indefinitely.
   * The maxWait clock starts on the first call of a burst and is reset when the
   * function actually runs.
   */
  maxWait?: number
}

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 *
 * With `options.maxWait`, the call is guaranteed to run at most that long after
 * the first call of a burst, even if the burst never stops.
 *
 * The constraint uses `never[]` rather than `unknown[]`: parameters are
 * contravariant, so `(...args: unknown[]) => unknown` only accepts callbacks
 * whose parameters accept `unknown` — i.e. zero-arg ones. `never[]` accepts any
 * signature while still letting `Parameters<T>` recover the real argument list.
 */
export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  wait: number,
  options: DebounceOptions = {}
): ((...args: Parameters<T>) => void) & { cancel: () => void; flush: () => void } {
  const { maxWait } = options
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let maxTimeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  const clearTimers = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (maxTimeoutId !== null) {
      clearTimeout(maxTimeoutId)
      maxTimeoutId = null
    }
  }

  const invoke = () => {
    const args = lastArgs
    clearTimers()
    lastArgs = null
    if (args) fn(...args)
  }

  const debounced = (...args: Parameters<T>) => {
    lastArgs = args
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(invoke, wait)
    if (maxWait !== undefined && maxTimeoutId === null) {
      maxTimeoutId = setTimeout(invoke, maxWait)
    }
  }

  debounced.cancel = () => {
    clearTimers()
    lastArgs = null
  }

  /** Runs a pending call immediately, if there is one. */
  debounced.flush = () => {
    if (lastArgs) invoke()
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
