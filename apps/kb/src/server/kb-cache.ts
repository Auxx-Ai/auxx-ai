// apps/kb/src/server/kb-cache.ts

import { cacheLife, cacheTag } from 'next/cache'
import { getKBVisibility, loadKBPayload, loadKBPayloadWithContent } from './kb-data'

export function kbTag(orgSlug: string, kbSlug: string): string {
  return `kb:${orgSlug}/${kbSlug}`
}

export function kbArticleTag(orgSlug: string, kbSlug: string, slugPath: string): string {
  return `kb-article:${orgSlug}/${kbSlug}/${slugPath}`
}

/**
 * Cached visibility/lifecycle lookup. Used by both PUBLIC and INTERNAL
 * paths to decide whether to short-circuit, render a 404, or run the
 * auth gate. Busted by `kbTag` on any KB update.
 */
export async function getCachedKBVisibility(orgSlug: string, kbSlug: string) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  return getKBVisibility(orgSlug, kbSlug)
}

/** Public-only cached payload — never used for INTERNAL KBs. */
export async function getPublicKBPayload(orgSlug: string, kbSlug: string) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  return loadKBPayload(orgSlug, kbSlug)
}

/** Public-only cached payload with content — never used for INTERNAL KBs. */
export async function getPublicKBPayloadWithContent(orgSlug: string, kbSlug: string) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  return loadKBPayloadWithContent(orgSlug, kbSlug)
}

// Backwards-compatible aliases for the cached public path.
export const getKBPayload = getPublicKBPayload
export const getKBPayloadWithContent = getPublicKBPayloadWithContent
