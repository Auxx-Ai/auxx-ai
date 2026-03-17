// packages/lib/src/cache/app-cache-helpers.ts

import type { CachedApp, CachedPublishedApp } from './app-cache-keys'
import { getAppCache } from './singletons'

/** Resolve an app slug to its cached app data. Returns undefined if not found. */
export async function getCachedAppBySlug(slug: string): Promise<CachedApp | undefined> {
  const appSlugMap = await getAppCache().get('appSlugMap')
  return appSlugMap[slug]
}

/** Resolve an app slug to its ID. Returns undefined if not found. */
export async function resolveAppSlug(slug: string): Promise<string | undefined> {
  const app = await getCachedAppBySlug(slug)
  return app?.id
}

/** Get all published apps from cache. */
export async function getCachedPublishedApps(): Promise<CachedPublishedApp[]> {
  return getAppCache().get('publishedApps')
}
