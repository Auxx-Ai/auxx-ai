// packages/chat/src/transport/kb-api.ts
//
// Minimal client for the visitor-facing /api/kb/* surface.

import { authedFetch } from './api-client'

export type KbArticleKind = 'page' | 'category' | 'header' | 'tab' | 'link'

export interface KbTreeNode {
  id: string
  parentId: string | null
  title: string
  emoji?: string
  articleKind: KbArticleKind
  sortOrder: string
}

export interface KbTreeResponse {
  site: { name: string; description?: string; logoUrl?: string }
  nodes: KbTreeNode[]
}

export interface KbArticleResponse {
  id: string
  title: string
  emoji?: string
  coverImageUrl?: string
  html: string
  updatedAt: string
}

export interface KbSearchHit {
  id: string
  title: string
  emoji?: string
  articleKind: KbArticleKind
}

export interface KbSearchResponse {
  results: KbSearchHit[]
}

export function kbApi(channelId: string) {
  return {
    getTree: () => authedFetch<KbTreeResponse>(channelId, '/api/kb/tree'),
    getArticle: (id: string) =>
      authedFetch<KbArticleResponse>(channelId, `/api/kb/articles/${encodeURIComponent(id)}`),
    search: (q: string, signal?: AbortSignal) =>
      authedFetch<KbSearchResponse>(
        channelId,
        `/api/kb/search?q=${encodeURIComponent(q)}`,
        signal ? { signal } : undefined
      ),
  }
}
