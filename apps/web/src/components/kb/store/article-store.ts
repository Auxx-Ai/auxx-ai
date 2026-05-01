// apps/web/src/components/kb/store/article-store.ts
'use client'

import '~/lib/immer-config' // Enables Map/Set support for immer
import type { ArticleKind, ArticleStatus } from '@auxx/database/types'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

/**
 * ArticleMeta — flat metadata for an article. Content/contentJson are NOT stored
 * here; the editor fetches them directly per-article via tRPC.
 *
 * title/emoji/description/excerpt come from the joined revision row:
 *   - published revision when the article has been published at least once
 *   - draft revision otherwise
 */
export interface ArticleMeta {
  id: string
  knowledgeBaseId: string
  title: string
  slug: string
  emoji: string | null
  parentId: string | null
  articleKind: ArticleKind
  sortOrder: string
  isPublished: boolean
  status: ArticleStatus
  description: string | null
  excerpt: string | null
  hasUnpublishedChanges: boolean
  publishedAt: Date | null
  publishedRevisionId: string | null
  draftRevisionId: string | null
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

interface PendingMove {
  id: string
  optimistic: { parentId: string | null; sortOrder: string }
  original: { parentId: string | null; sortOrder: string }
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
  /**
   * Server ids confirmed by `confirmCreate` whose presence has not yet been
   * observed in a server `setArticles` call. We preserve these in the per-kb
   * list ordering when a stale fetch arrives, so the just-created article
   * doesn't flicker out while the GET refetch is in flight.
   */
  recentlyCreatedIds: Record<string, Set<string>>
  /** Articles marked deleted (hidden from selectors). */
  optimisticDeleted: Set<string>
  /** Active move snapshot (only one in flight at a time). */
  pendingMove: PendingMove | null

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

  applyOptimisticMove: (move: { id: string; parentId: string | null; sortOrder: string }) => void
  confirmMove: () => void
  rollbackMove: () => void

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
      recentlyCreatedIds: {},
      optimisticDeleted: new Set<string>(),
      pendingMove: null,

      // ─── Hydration ───────────────────────────────────────────────
      setArticles: (kbId, articles) => {
        set((state) => {
          const incomingIds = articles.map((a) => a.id)
          const incomingSet = new Set(incomingIds)

          // Reconcile recentlyCreatedIds: drop any that the server now lists
          // (its create has been observed by a fetch). Anything still in the
          // set is a confirmed create the server response hasn't seen yet —
          // append those to the list ordering so the UI doesn't lose them.
          const recent = state.recentlyCreatedIds[kbId]
          const stillPending: string[] = []
          if (recent) {
            for (const id of recent) {
              if (incomingSet.has(id)) {
                recent.delete(id)
              } else if (state.articles.has(id) && !state.optimisticDeleted.has(id)) {
                stillPending.push(id)
              } else {
                // Entity gone (rolled back, deleted, etc.) — stop tracking it.
                recent.delete(id)
              }
            }
          }

          state.articleIdsByKb[kbId] = stillPending.length
            ? [...incomingIds, ...stillPending]
            : incomingIds

          // Upsert into the entity map. We deliberately do NOT prune entries
          // that are missing from the incoming list — a stale fetch arriving
          // after a confirmed optimistic create/update would otherwise drop
          // the just-confirmed entity. Entities leave the map only via
          // explicit confirmDelete (mirrors record-store semantics).
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
          // Track until a server fetch confirms it — protects against a stale
          // refetch wiping the new id out of articleIdsByKb mid-navigation.
          const recent = state.recentlyCreatedIds[server.knowledgeBaseId] ?? new Set<string>()
          recent.add(server.id)
          state.recentlyCreatedIds[server.knowledgeBaseId] = recent
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

      // ─── Move (single-row) ───────────────────────────────────────
      applyOptimisticMove: (move) => {
        set((state) => {
          const article = state.articles.get(move.id)
          if (!article) return
          state.pendingMove = {
            id: move.id,
            optimistic: { parentId: move.parentId, sortOrder: move.sortOrder },
            original: { parentId: article.parentId, sortOrder: article.sortOrder },
          }
          state.articles.set(move.id, {
            ...article,
            parentId: move.parentId,
            sortOrder: move.sortOrder,
          })
        })
      },

      confirmMove: () => {
        set((state) => {
          state.pendingMove = null
        })
      },

      rollbackMove: () => {
        set((state) => {
          if (!state.pendingMove) return
          const article = state.articles.get(state.pendingMove.id)
          if (article) {
            state.articles.set(article.id, { ...article, ...state.pendingMove.original })
          }
          state.pendingMove = null
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
          delete state.recentlyCreatedIds[kbId]
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
          state.recentlyCreatedIds = {}
          state.optimisticDeleted.clear()
          state.pendingMove = null
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
