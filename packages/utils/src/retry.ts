// packages/utils/src/retry.ts

/**
 * Retry a function with exponential backoff on rate limit errors
 * @param fn - Async function to retry
 * @param retries - Number of retry attempts (default: 5)
 * @param delay - Initial delay in ms (default: 1000)
 * @returns Result of the function
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 5, delay = 1000): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    if (retries > 0 && err.code === 429) {
      // Rate limit error
      console.warn(`Rate limit reached. Retrying in ${delay}ms...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return withRetry(fn, retries - 1, delay * 2)
    }
    throw err
  }
}
