// packages/lib/src/files/storage/providers.ts

/**
 * The storage provider registry — one source of truth for "does this provider
 * have an adapter?", plus the lazy loader that produces it.
 *
 * This was a `private static` on `StorageManager`, which meant a pure-data
 * question ("is `DROPBOX` supported?") could only be asked by constructing a
 * manager. The Phase-2 write pilot refused to do that and duplicated the set as
 * a local `SUPPORTED_PROVIDERS` in `storage/locations.ts`, recording the drift
 * risk in a comment. Both now read {@link isProviderAvailable}.
 *
 * ## Why this is not in `auth.ts`
 *
 * `storage/auth.ts` imports `@auxx/credentials/store` at module scope for
 * `revealSecrets`. `storage/locations.ts` is a pure database module whose test
 * calls `vi.mock` zero times, and it needs nothing but the provider set — so
 * the registry lives in its own leaf module with no runtime dependencies at
 * all. The adapter loaders are `import()` expressions, so nothing in
 * `@aws-sdk/*` is pulled into the graph until an adapter is actually asked for.
 */

import type { ProviderId, StorageAdapter } from '../adapters/base-adapter'
import { StorageAdapterError } from '../adapters/base-adapter'

/**
 * Provider id → adapter loader.
 *
 * Adding a provider is one line here; the five commented entries are the
 * historical stubs and are kept as documentation of the intended shape.
 *
 * @example
 * ```ts
 * DROPBOX: async () => (await import('../adapters/dropbox-adapter')).DropboxAdapter,
 * ```
 */
const ADAPTER_LOADERS = {
  S3: async () => (await import('../adapters/s3-adapter')).default,
  // GOOGLE_DRIVE: async () => (await import('../adapters/google-drive-adapter')).GoogleDriveAdapter,
  // DROPBOX: async () => (await import('../adapters/dropbox-adapter')).DropboxAdapter,
  // ONEDRIVE: async () => (await import('../adapters/onedrive-adapter')).OneDriveAdapter,
  // BOX: async () => (await import('../adapters/box-adapter')).BoxAdapter,
  // GENERIC_URL: async () => (await import('../adapters/url-adapter')).UrlAdapter,
} as const

/** The subset of {@link ProviderId} that actually has an adapter today. */
export type AvailableProviderId = keyof typeof ADAPTER_LOADERS

/** The same set as a value, for callers that want to enumerate rather than test. */
export const AVAILABLE_PROVIDERS: ReadonlySet<ProviderId> = new Set(
  Object.keys(ADAPTER_LOADERS) as ProviderId[]
)

/** Whether `provider` has an adapter. Narrows, so a caller can use the loader map. */
export function isProviderAvailable(provider: ProviderId): provider is AvailableProviderId {
  return AVAILABLE_PROVIDERS.has(provider)
}

/**
 * Adapter instance cache.
 *
 * Module-level rather than a static, so it is per-module-graph: a Vitest file
 * gets its own, and {@link clearStorageAdapterCache} exists for tests that swap
 * the adapter mid-file.
 */
const adapterCache = new Map<ProviderId, StorageAdapter>()

/**
 * Load (and cache) the adapter for a provider.
 *
 * @throws {StorageAdapterError} when the provider has no adapter, or the
 *   dynamic import fails.
 */
export async function getStorageAdapter(provider: ProviderId): Promise<StorageAdapter> {
  const cached = adapterCache.get(provider)
  if (cached) return cached

  if (!isProviderAvailable(provider)) {
    throw new StorageAdapterError(
      `No adapter available for provider: ${provider}`,
      provider,
      'getStorageAdapter'
    )
  }

  try {
    const AdapterClass = await ADAPTER_LOADERS[provider]()
    const adapter = new AdapterClass()
    adapterCache.set(provider, adapter)
    return adapter
  } catch (error) {
    throw new StorageAdapterError(
      `Failed to load adapter for provider ${provider}: ${error}`,
      provider,
      'getStorageAdapter',
      error as Error
    )
  }
}

/**
 * The already-loaded adapter, or `undefined`.
 *
 * For synchronous paths that want an adapter's opinion but must not await one
 * (`StorageManager.buildLocationRef` reads `resolveBucket()` this way).
 */
export function getCachedStorageAdapter(provider: ProviderId): StorageAdapter | undefined {
  return adapterCache.get(provider)
}

/** Drop every cached adapter instance. Test seam. */
export function clearStorageAdapterCache(): void {
  adapterCache.clear()
}
