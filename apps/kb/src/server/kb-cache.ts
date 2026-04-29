// apps/kb/src/server/kb-cache.ts

import { cacheLife, cacheTag } from 'next/cache'
import { loadKBPayload, loadKBPayloadWithContent } from './kb-data'

export function kbTag(orgSlug: string, kbSlug: string): string {
  return `kb:${orgSlug}/${kbSlug}`
}

export function kbArticleTag(orgSlug: string, kbSlug: string, slugPath: string): string {
  return `kb-article:${orgSlug}/${kbSlug}/${slugPath}`
}

export async function getKBPayload(orgSlug: string, kbSlug: string) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  return loadKBPayload(orgSlug, kbSlug)
}

export async function getKBPayloadWithContent(orgSlug: string, kbSlug: string) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  return loadKBPayloadWithContent(orgSlug, kbSlug)
}
