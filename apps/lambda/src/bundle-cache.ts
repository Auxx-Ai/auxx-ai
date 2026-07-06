// apps/lambda/src/bundle-cache.ts

/**
 * Bounded LRU caches for app server bundles. Bundles are content-addressed
 * (immutable SHA key) and this process is long-lived, so entries never need
 * invalidation — only bounding.
 *
 * Two layers:
 *  - bundle source strings, keyed `${appId}:${serverBundleSha}` (S3 downloads)
 *  - compiled `Function` objects, keyed by bundle source + return-statement
 *    (the executors wrap the same bundle differently)
 *
 * Only the compiled Function is cached — never its invocation result. The
 * bundle's top-level scope must re-evaluate per call against the runtime
 * helpers each executor injects into globalThis beforehand.
 */

const MAX_ENTRIES = 32

const bundleCache = new Map<string, string>()

/** Get a cached bundle source string, refreshing its LRU position. */
export function getCachedBundle(key: string): string | undefined {
  const code = bundleCache.get(key)
  if (code !== undefined) {
    bundleCache.delete(key)
    bundleCache.set(key, code)
  }
  return code
}

/** Store a bundle source string, evicting the least-recently-used entry. */
export function setCachedBundle(key: string, code: string): void {
  if (bundleCache.size >= MAX_ENTRIES) {
    const oldest = bundleCache.keys().next().value
    if (oldest !== undefined) bundleCache.delete(oldest)
  }
  bundleCache.set(key, code)
}

/** code string → (return statement → compiled Function). String keys compare
 * by value, so a re-downloaded identical bundle still hits. */
const compiledCache = new Map<string, Map<string, () => any>>()

/**
 * Compile `bundleCode + '\n' + returnStatement` once and reuse the Function
 * across invocations (each call still re-evaluates the bundle top-level).
 */
export function compileBundle(bundleCode: string, returnStatement: string): () => any {
  let byReturn = compiledCache.get(bundleCode)
  if (!byReturn) {
    if (compiledCache.size >= MAX_ENTRIES) {
      const oldest = compiledCache.keys().next().value
      if (oldest !== undefined) compiledCache.delete(oldest)
    }
    byReturn = new Map()
    compiledCache.set(bundleCode, byReturn)
  } else {
    // Refresh LRU position
    compiledCache.delete(bundleCode)
    compiledCache.set(bundleCode, byReturn)
  }

  let fn = byReturn.get(returnStatement)
  if (!fn) {
    fn = new Function(`${bundleCode}\n${returnStatement}`) as () => any
    byReturn.set(returnStatement, fn)
  }
  return fn
}
