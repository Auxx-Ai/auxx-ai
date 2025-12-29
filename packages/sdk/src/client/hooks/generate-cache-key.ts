// packages/sdk/src/client/hooks/generate-cache-key.ts

/**
 * Generate a unique cache key from a name and arguments
 *
 * @param name - The name/identifier for this cache entry
 * @param args - The arguments passed to the async function
 * @returns A unique string key for caching
 *
 * @example
 * ```typescript
 * generateCacheKey('loadUser', ['123']) // => 'loadUser:["123"]'
 * generateCacheKey('loadWidget', []) // => 'loadWidget:'
 * ```
 */
export function generateCacheKey(name: string, args: any[]): string {
  try {
    // Serialize arguments to create unique key
    const argsString = args.length > 0 ? JSON.stringify(args) : ''
    return `${name}:${argsString}`
  } catch (error) {
    // If args can't be serialized, use a fallback with timestamp and random value
    console.warn('Failed to serialize cache key arguments:', error)
    return `${name}:${Date.now()}-${Math.random()}`
  }
}
