// packages/sdk/src/server/storage.ts

/**
 * App KV storage — a durable, per-app key-value store.
 *
 * Values are JSON-serializable; reads return the parsed value wrapped in
 * `{ value }` so a stored `null` is distinguishable from a missing key.
 *
 * Two scopes:
 * - `installation` (default) — shared across the whole app installation.
 * - `connection` — bound to the connection in the current run context (the
 *   agent-bound connection for tools, the trigger's connection for polling).
 *   Throws when no connection is in context.
 *
 * Plain keys live at the top level; `storage.collection(name)` binds a named,
 * enumerable bucket (the only place `list()` exists).
 *
 * @example
 * ```typescript
 * import { storage } from '@auxx/sdk/server'
 *
 * // token cache (connection-scoped, 55-minute TTL)
 * await storage.set('bearer-token', { token }, { scope: 'connection', ttlSeconds: 3300 })
 * const cached = await storage.get<{ token: string }>('bearer-token', { scope: 'connection' })
 *
 * // watch registry — one row per tracking number, enumerable
 * const watches = storage.collection('watch', { scope: 'connection' })
 * await watches.set(trackingNumber, { lastStatus }, { ttlSeconds: 14 * 86400 })
 * const { entries } = await watches.list()
 *
 * // webhook idempotency — atomic claim
 * const first = await storage.collection('webhook-events').setIfAbsent(eventId, { seenAt })
 * if (!first) return // duplicate delivery
 * ```
 */

/** Storage scope: shared per installation, or bound to the run's connection. */
export type StorageScope = 'installation' | 'connection'

export interface StorageOptions {
  /** Defaults to `'installation'`. */
  scope?: StorageScope
}

export interface StorageSetOptions extends StorageOptions {
  /** Lazy expiry — the row reads as missing past this many seconds (max 30 days). */
  ttlSeconds?: number
}

export interface StorageListOptions {
  /** Page size. Defaults to 1,000, clamped to 5,000 (the per-namespace key cap). */
  limit?: number
}

/** Item-level operations available on both `storage` and a bound collection. */
export interface StorageItemApi {
  /** `null` = key missing or expired; `{ value }` otherwise (a stored `null` is NOT a miss). */
  get<T = unknown>(key: string, opts?: StorageOptions): Promise<{ value: T } | null>
  set(key: string, value: unknown, opts?: StorageSetOptions): Promise<void>
  /**
   * Atomic insert-if-missing. `true` = this call created the key; `false` = it
   * already existed. Expired rows count as missing (the claim succeeds). The
   * idempotency primitive.
   */
  setIfAbsent(key: string, value: unknown, opts?: StorageSetOptions): Promise<boolean>
  /** Idempotent — no error when the key is absent. */
  remove(key: string, opts?: StorageOptions): Promise<void>
}

/** A bound collection adds enumeration over its keys. */
export interface StorageCollectionApi extends StorageItemApi {
  list<T = unknown>(
    opts?: StorageListOptions
  ): Promise<{ entries: Array<{ key: string; value: T }> }>
}

export interface Storage extends StorageItemApi {
  /** Bind a named collection; `defaults` (e.g. scope) apply to every call on the handle. */
  collection(name: string, defaults?: StorageSetOptions): StorageCollectionApi
}

/**
 * Host-side storage implementation injected on the `AUXX_SERVER_SDK` global.
 * Flat methods taking `collection` as an argument — `collection()` is pure
 * client-side sugar over these.
 */
interface StorageHost {
  get(args: {
    collection: string
    key: string
    scope: StorageScope
  }): Promise<{ value: unknown } | null>
  set(args: {
    collection: string
    key: string
    value: unknown
    scope: StorageScope
    ttlSeconds?: number
  }): Promise<void>
  setIfAbsent(args: {
    collection: string
    key: string
    value: unknown
    scope: StorageScope
    ttlSeconds?: number
  }): Promise<boolean>
  remove(args: { collection: string; key: string; scope: StorageScope }): Promise<void>
  list(args: {
    collection: string
    scope: StorageScope
    limit?: number
  }): Promise<{ entries: Array<{ key: string; value: unknown }> }>
}

/** Resolve the host storage implementation or throw the standard SDK error. */
function host(): StorageHost {
  const sdk = (global as { AUXX_SERVER_SDK?: { storage?: StorageHost } }).AUXX_SERVER_SDK
  if (sdk?.storage && typeof sdk.storage.get === 'function') {
    return sdk.storage
  }
  throw new Error(
    '[auxx/server] Server SDK not available. This code must run in the Auxx server environment.'
  )
}

/** Build the item-level API for a (collection, defaults) pair — used for both plain keys and collections. */
function itemApi(collection: string, defaults: StorageSetOptions): StorageItemApi {
  const scopeOf = (opts?: StorageOptions): StorageScope =>
    opts?.scope ?? defaults.scope ?? 'installation'
  const ttlOf = (opts?: StorageSetOptions): number | undefined =>
    opts?.ttlSeconds ?? defaults.ttlSeconds

  return {
    get: (key, opts) =>
      host().get({ collection, key, scope: scopeOf(opts) }) as Promise<{ value: never } | null>,
    set: (key, value, opts) =>
      host().set({ collection, key, value, scope: scopeOf(opts), ttlSeconds: ttlOf(opts) }),
    setIfAbsent: (key, value, opts) =>
      host().setIfAbsent({ collection, key, value, scope: scopeOf(opts), ttlSeconds: ttlOf(opts) }),
    remove: (key, opts) => host().remove({ collection, key, scope: scopeOf(opts) }),
  }
}

export const storage: Storage = {
  ...itemApi('', {}),
  collection(name: string, defaults: StorageSetOptions = {}): StorageCollectionApi {
    return {
      ...itemApi(name, defaults),
      list: (opts) =>
        host().list({
          collection: name,
          scope: defaults.scope ?? 'installation',
          limit: opts?.limit,
        }) as Promise<{ entries: Array<{ key: string; value: never }> }>,
    }
  },
}
