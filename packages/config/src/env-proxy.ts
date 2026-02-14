// packages/config/src/env-proxy.ts

import { Resource } from 'sst'

/**
 * Smart environment proxy with SST Resource access and caching.
 * - Preserves existing `env.VAR` synchronous access pattern
 * - Narrow only string keys; forward symbols and descriptors
 */

/** Global cache for Resource values */
const resourceCache = new Map<string, { value: string | undefined; ts: number }>()

/** Cache TTL in ms for Resource values (optional; 0 disables TTL) */
const CACHE_TTL_MS = Number((typeof process !== 'undefined' && process.env?.ENV_PROXY_TTL_MS) || 0)

/**
 * Determine if we are running under SST with Resources available
 * SST=1 doesn't guarantee Resource access - only true in deployed Lambda or sst dev
 */
const isSst = (): boolean => {
  if (typeof process === 'undefined' || process.env?.SST !== '1') return false

  // Skip SST Resources during Next.js build phase
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return false
  }

  // Additional check: if we're in development, SST Resources likely aren't available
  // unless we're running under `sst dev`
  if (process.env.NODE_ENV === 'development') {
    // Check if we're actually in a multiplexer context (sst dev)
    return !!process.env.SST_RESOURCE_App
  }

  return true
}

/**
 * Check cache validity for a key
 */
const getCached = (key: string) => {
  const rec = resourceCache.get(key)
  if (!rec) return undefined
  if (CACHE_TTL_MS > 0 && Date.now() - rec.ts > CACHE_TTL_MS) {
    resourceCache.delete(key)
    return undefined
  }
  return rec.value
}

/**
 * Put value into cache
 */
const setCached = (key: string, value: string | undefined) => {
  resourceCache.set(key, { value, ts: Date.now() })
}

/**
 * Fetch a value from SST Resource if available; fall back to process.env.
 */
const getValue = (key: string): string | undefined => {
  if (!isSst()) {
    return typeof process !== 'undefined' ? process.env?.[key] : undefined
  }

  // Check process.env first (faster and more reliable for critical vars)
  const processValue = typeof process !== 'undefined' ? process.env?.[key] : undefined
  if (typeof processValue !== 'undefined') {
    return processValue
  }

  const cached = getCached(key)
  if (typeof cached !== 'undefined') {
    return cached
  }

  try {
    const res = (Resource as any)[key]
    const value = res?.value as string | undefined

    if (typeof value !== 'undefined') {
      setCached(key, value)
      return value
    }
  } catch (error) {
    // Resource access failed, continue to return undefined
  }

  return undefined
}

/**
 * Coerce string secrets into the same runtime type as the base value
 */
const coerce = (raw: string | undefined, sample: unknown): unknown => {
  if (typeof sample === 'number') return typeof raw === 'undefined' ? undefined : Number(raw)
  if (typeof sample === 'boolean') return raw === '1' || raw === 'true'
  return raw
}

/**
 * Create a proxy that intercepts property access for uppercase keys and
 * returns Resource-backed values when in SST.
 */
export const createEnvProxy = <T extends Record<string, any>>(baseEnv: T): T => {
  const handler: ProxyHandler<T> = {
    get(target, prop: string | symbol, receiver) {
      if (typeof prop === 'string' && prop === prop.toUpperCase()) {
        const raw = getValue(prop)
        const sample = (target as any)[prop]
        const value = coerce(raw, sample)
        if (typeof value !== 'undefined') return value as any
      }
      return Reflect.get(target, prop, receiver)
    },
    has(target, prop) {
      if (typeof prop === 'string') return true
      return Reflect.has(target, prop)
    },
    set() {
      throw new Error('env is read-only')
    },
    ownKeys(target) {
      const keys = new Set<string | symbol>(Reflect.ownKeys(target))
      // Expose cached keys too
      for (const k of resourceCache.keys()) keys.add(k)
      return Array.from(keys)
    },
    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop)
      if (desc) return desc
      return {
        configurable: true,
        enumerable: true,
        value: (baseEnv as any)[prop as any],
        writable: false,
      }
    },
  }
  return new Proxy<T>(baseEnv, handler)
}
