// packages/lib/src/import/utils/progress-reporter.ts

/** Progress callback function */
export type ProgressCallback = (processed: number, total: number) => void

/**
 * Create a throttled progress reporter.
 * Only calls the callback at most once per interval.
 *
 * @param callback - The progress callback to throttle
 * @param intervalMs - Minimum interval between calls (default: 100ms)
 * @returns Throttled callback
 */
export function createThrottledProgress(
  callback: ProgressCallback,
  intervalMs: number = 100
): ProgressCallback {
  let lastCall = 0

  return (processed: number, total: number) => {
    const now = Date.now()

    // Always call on completion
    if (processed === total || now - lastCall >= intervalMs) {
      lastCall = now
      callback(processed, total)
    }
  }
}

/**
 * Create a progress reporter that calculates percentage.
 *
 * @param callback - Callback receiving percentage (0-100)
 * @returns Progress callback
 */
export function createPercentageProgress(callback: (percentage: number) => void): ProgressCallback {
  return (processed: number, total: number) => {
    if (total === 0) {
      callback(100)
      return
    }
    callback(Math.round((processed / total) * 100))
  }
}
