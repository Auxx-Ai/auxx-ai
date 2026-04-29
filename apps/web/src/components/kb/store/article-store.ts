// apps/web/src/components/kb/store/article-store.ts
'use client'

import '~/lib/immer-config' // Enables Map/Set support for immer
import type { ArticleStatus } from '@auxx/database/types'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

/**
 * ArticleMeta — flat metadata for an article. Content/contentJson are NOT stored
 * here; the editor fetches them directly per-article via tRPC.
 */
export interface ArticleMeta {
  id: string
  knowledgeBaseId: string
  title: string
  slug: string
  emoji: string | null
  parentId: string | null
  isCategory: boolean
  order: number
  isPublished: boolean
  status: ArticleStatus
  description: string | null
  excerpt: string | null
}

/** A tree-shaped article node (built lazily from the flat list). */
export interface ArticleTreeNode extends ArticleMeta {
  children: ArticleTreeNode[]
  path?: string
  orderPath?: string
}

interface PendingArticleUpdate {
  optimistic: Partial<ArticleMeta>
  original: ArticleMeta
}

interface PendingReorder {
  /** Updates that were applied. */
  updates: Array<{ id: string; parentId: string | null; order: number }>
  /** Originals captured for rollback. */
  originals: Map<string, Pick<ArticleMeta, 'parentId' | 'order'>>
}

interface ArticleStoreState {
  // ─── Server state ──────────────────────────────────────────────────
  /** All articles by id (server + reconciled optimistic state). */
  articles: Map<string, ArticleMeta>
  /** Article ids per KB. Used for fast list selection. */
  articleIdsByKb: Record<string, string[]>
  /** KBs that have completed at least one fetch. */
  loadedKbs: Set<string>

  // ─── Optimistic state ──────────────────────────────────────────────
  /** Pending field updates per article id. */
  pendingUpdates: Record<string, PendingArticleUpdate>
  /** Optimistic create entries keyed by tempId. */
  optimisticNewArticles: Record<string, ArticleMeta>
  /** Articles marked deleted (hidden from selectors). */
  optimisticDeleted: Set<string>
  /** Active reorder snapshot (only one in flight at a time). */
  pendingReorder: PendingReorder | null

  // ─── Actions ───────────────────────────────────────────────────────
  setArticles: (kbId: string, articles: ArticleMeta[]) => void
  applyArticleFromServer: (article: ArticleMeta) => void
  applyArticleMetadataFromServer: (id: string, fields: Partial<ArticleMeta>) => void

  setArticleOptimistic: (id: string, updates: Partial<ArticleMeta>) => void
  confirmUpdate: (id: string, server?: ArticleMeta) => void
  rollbackUpdate: (id: string) => void

  addOptimisticArticle: (tempId: string, article: ArticleMeta) => void
  confirmCreate: (tempId: string, server: ArticleMeta) => void
  rollbackCreate: (tempId: string) => void

  markArticleDeleted: (id: string) => void
  confirmDelete: (id: string) => void
  rollbackDelete: (id: string) => void

  applyOptimisticReorder: (updates: PendingReorder['updates']) => void
  confirmReorder: () => void
  rollbackReorder: () => void

  clearKb: (kbId: string) => void
  reset: () => void
}

/** Build the effective article view (server + pending overlay). */
function getEffective(state: ArticleStoreState, id: string): ArticleMeta | undefined {
  if (state.optimisticDeleted.has(id)) return undefined
  const optNew = state.optimisticNewArticles[id]
  if (optNew) return optNew
  const server = state.articles.get(id)
  if (!server) return undefined
  const pending = state.pendingUpdates[id]
  if (pending) return { ...server, ...pending.optimistic }
  return server
}

export const useArticleStore = create<ArticleStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      articles: new Map<string, ArticleMeta>(),
      articleIdsByKb: {},
      loadedKbs: new Set<string>(),

      pendingUpdates: {},
      optimisticNewArticles: {},
      optimisticDeleted: new Set<string>(),
      pendingReorder: null,

      // ─── Hydration ───────────────────────────────────────────────
      setArticles: (kbId, articles) => {
        set((state) => {
          // Replace the article ids for this KB
          state.articleIdsByKb[kbId] = articles.map((a) => a.id)

          // Drop stale entries from this KB that aren't in the new list
          const incoming = new Set(articles.map((a) => a.id))
          for (const [id, art] of state.articles) {
            if (art.knowledgeBaseId === kbId && !incoming.has(id)) {
              state.articles.delete(id)
            }
          }

          // Upsert new entries
          for (const article of articles) {
            state.articles.set(article.id, article)
          }

          state.loadedKbs.add(kbId)

          // Reconcile optimistic state with the server view
          for (const [id, pending] of Object.entries(state.pendingUpdates)) {
            const server = state.articles.get(id)
            if (server) {
              const merged = { ...pending.original, ...pending.optimistic }
              const matches = (Object.keys(pending.optimistic) as Array<keyof ArticleMeta>).every(
                (key) => server[key] === merged[key]
              )
              if (matches) delete state.pendingUpdates[id]
            }
          }
          for (const tempId of Object.keys(state.optimisticNewArticles)) {
            // Server-confirmed creates land in `articles` directly, leaving the temp orphaned.
            // Drop the temp once a real id replaces it (best-effort by slug match).
            const temp = state.optimisticNewArticles[tempId]
            if (state.articles.has(tempId)) {
              delete state.optimisticNewArticles[tempId]
            } else if (
              temp &&
              articles.some(
                (a) =>
                  a.knowledgeBaseId === temp.knowledgeBaseId &&
                  a.slug === temp.slug &&
                  a.parentId === temp.parentId
              )
            ) {
              delete state.optimisticNewArticles[tempId]
            }
          }
          for (const id of state.optimisticDeleted) {
            if (!state.articles.has(id)) state.optimisticDeleted.delete(id)
          }
        })
      },

      applyArticleFromServer: (article) => {
        set((state) => {
          state.articles.set(article.id, article)
          delete state.pendingUpdates[article.id]
          const ids = state.articleIdsByKb[article.knowledgeBaseId]
          if (ids && !ids.includes(article.id)) {
            ids.push(article.id)
          }
        })
      },

      applyArticleMetadataFromServer: (id, fields) => {
        set((state) => {
          const existing = state.articles.get(id)
          if (existing) {
            state.articles.set(id, { ...existing, ...fields })
          }
        })
      },

      // ─── Single-article optimistic ───────────────────────────────
      setArticleOptimistic: (id, updates) => {
        set((state) => {
          const server = state.articles.get(id) ?? state.optimisticNewArticles[id]
          if (!server) return
          const existing = state.pendingUpdates[id]
          state.pendingUpdates[id] = {
            optimistic: existing ? { ...existing.optimistic, ...updates } : updates,
            original: existing?.original ?? server,
          }
        })
      },

      confirmUpdate: (id, server) => {
        set((state) => {
          delete state.pendingUpdates[id]
          if (server) state.articles.set(id, server)
        })
      },

      rollbackUpdate: (id) => {
        set((state) => {
          delete state.pendingUpdates[id]
        })
      },

      // ─── Create ──────────────────────────────────────────────────
      addOptimisticArticle: (tempId, article) => {
        set((state) => {
          state.optimisticNewArticles[tempId] = article
          const ids = state.articleIdsByKb[article.knowledgeBaseId] ?? []
          if (!ids.includes(tempId)) {
            state.articleIdsByKb[article.knowledgeBaseId] = [...ids, tempId]
          }
        })
      },

      confirmCreate: (tempId, server) => {
        set((state) => {
          delete state.optimisticNewArticles[tempId]
          state.articles.set(server.id, server)
          const ids = state.articleIdsByKb[server.knowledgeBaseId] ?? []
          const next = ids.filter((id) => id !== tempId)
          if (!next.includes(server.id)) next.push(server.id)
          state.articleIdsByKb[server.knowledgeBaseId] = next
        })
      },

      rollbackCreate: (tempId) => {
        set((state) => {
          const temp = state.optimisticNewArticles[tempId]
          delete state.optimisticNewArticles[tempId]
          if (temp) {
            const ids = state.articleIdsByKb[temp.knowledgeBaseId]
            if (ids) {
              state.articleIdsByKb[temp.knowledgeBaseId] = ids.filter((id) => id !== tempId)
            }
          }
        })
      },

      // ─── Delete ──────────────────────────────────────────────────
      markArticleDeleted: (id) => {
        set((state) => {
          state.optimisticDeleted.add(id)
          // Cascade: hide descendants too
          const stack = [id]
          while (stack.length > 0) {
            const cur = stack.pop()!
            for (const article of state.articles.values()) {
              if (article.parentId === cur) {
                state.optimisticDeleted.add(article.id)
                stack.push(article.id)
              }
            }
          }
        })
      },

      confirmDelete: (id) => {
        set((state) => {
          // Remove the article + descendants from the store entirely.
          const toRemove = new Set<string>([id])
          let added = true
          while (added) {
            added = false
            for (const article of state.articles.values()) {
              if (article.parentId && toRemove.has(article.parentId) && !toRemove.has(article.id)) {
                toRemove.add(article.id)
                added = true
              }
            }
          }
          for (const removeId of toRemove) {
            const article = state.articles.get(removeId)
            state.articles.delete(removeId)
            state.optimisticDeleted.delete(removeId)
            delete state.pendingUpdates[removeId]
            if (article) {
              const ids = state.articleIdsByKb[article.knowledgeBaseId]
              if (ids) {
                state.articleIdsByKb[article.knowledgeBaseId] = ids.filter((x) => x !== removeId)
              }
            }
          }
        })
      },

      rollbackDelete: (id) => {
        set((state) => {
          state.optimisticDeleted.delete(id)
          // Restore descendants too (they were hidden in markArticleDeleted)
          const stack = [id]
          while (stack.length > 0) {
            const cur = stack.pop()!
            for (const article of state.articles.values()) {
              if (article.parentId === cur && state.optimisticDeleted.has(article.id)) {
                state.optimisticDeleted.delete(article.id)
                stack.push(article.id)
              }
            }
          }
        })
      },

      // ─── Reorder (multi-article batch) ───────────────────────────
      applyOptimisticReorder: (updates) => {
        set((state) => {
          // Capture originals (parentId + order) for every affected article.
          const originals = new Map<string, Pick<ArticleMeta, 'parentId' | 'order'>>()
          for (const update of updates) {
            const article = state.articles.get(update.id)
            if (article) {
              originals.set(update.id, { parentId: article.parentId, order: article.order })
              state.articles.set(update.id, {
                ...article,
                parentId: update.parentId,
                order: update.order,
              })
            }
          }
          state.pendingReorder = { updates, originals }
        })
      },

      confirmReorder: () => {
        set((state) => {
          state.pendingReorder = null
        })
      },

      rollbackReorder: () => {
        set((state) => {
          if (!state.pendingReorder) return
          for (const [id, original] of state.pendingReorder.originals) {
            const article = state.articles.get(id)
            if (article) {
              state.articles.set(id, { ...article, ...original })
            }
          }
          state.pendingReorder = null
        })
      },

      // ─── Lifecycle ───────────────────────────────────────────────
      clearKb: (kbId) => {
        set((state) => {
          const ids = state.articleIdsByKb[kbId] ?? []
          for (const id of ids) {
            state.articles.delete(id)
            delete state.pendingUpdates[id]
            delete state.optimisticNewArticles[id]
            state.optimisticDeleted.delete(id)
          }
          delete state.articleIdsByKb[kbId]
          state.loadedKbs.delete(kbId)
        })
      },

      reset: () => {
        set((state) => {
          state.articles.clear()
          state.articleIdsByKb = {}
          state.loadedKbs.clear()
          state.pendingUpdates = {}
          state.optimisticNewArticles = {}
          state.optimisticDeleted.clear()
          state.pendingReorder = null
        })
      },
    }))
  )
)

export const getArticleStoreState = () => useArticleStore.getState()

/** Selector helper for components that want the effective article. */
export function selectEffectiveArticle(
  state: ArticleStoreState,
  id: string
): ArticleMeta | undefined {
  return getEffective(state, id)
}

/** Selector helper for the effective flat list of a KB. */
export function selectArticlesForKb(state: ArticleStoreState, kbId: string): ArticleMeta[] {
  const ids = state.articleIdsByKb[kbId] ?? []
  const out: ArticleMeta[] = []
  for (const id of ids) {
    const article = getEffective(state, id)
    if (article) out.push(article)
  }
  return out
}
