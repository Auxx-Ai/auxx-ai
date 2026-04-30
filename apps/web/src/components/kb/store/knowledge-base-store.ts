// apps/web/src/components/kb/store/knowledge-base-store.ts
'use client'

import {
  type DraftSection,
  draftedSections as draftedSectionsHelper,
  hasUnpublishedSettings as hasUnpublishedSettingsHelper,
  type KBDraftSettings,
  mergeDraftOverLive,
} from '@auxx/lib/kb/client'
import { deepEqual } from '@auxx/utils/objects'
import '~/lib/immer-config'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { RouterOutputs } from '~/trpc/react'

export type KnowledgeBase = RouterOutputs['kb']['byId']
export type { KBDraftSettings }

interface PendingKBUpdate {
  optimistic: Partial<KnowledgeBase>
  original: KnowledgeBase
}

interface PendingDraftPatch {
  patch: KBDraftSettings
  /** The kb.draftSettings value at the time the first patch was applied. */
  baseDraft: KBDraftSettings | null
}

interface KnowledgeBaseStoreState {
  // ─── Server state ──────────────────────────────────────────────────
  knowledgeBases: KnowledgeBase[]
  knowledgeBasesById: Record<string, KnowledgeBase>
  activeKnowledgeBaseId: string | null
  isLoading: boolean
  hasLoadedOnce: boolean

  // ─── Optimistic state ──────────────────────────────────────────────
  pendingUpdates: Record<string, PendingKBUpdate>
  pendingDraftPatches: Record<string, PendingDraftPatch>
  optimisticNewKBs: Record<string, KnowledgeBase>
  optimisticDeleted: Set<string>

  // ─── Actions ───────────────────────────────────────────────────────
  setKnowledgeBases: (kbs: KnowledgeBase[]) => void
  applyKnowledgeBaseFromServer: (kb: KnowledgeBase) => void
  setActiveKnowledgeBaseId: (id: string | null) => void
  setLoading: (isLoading: boolean) => void

  setKBOptimistic: (id: string, updates: Partial<KnowledgeBase>) => void
  confirmKBUpdate: (id: string, server?: KnowledgeBase) => void
  rollbackKBUpdate: (id: string) => void

  setKBDraftPatchOptimistic: (id: string, patch: KBDraftSettings) => void
  clearKBDraftOptimistic: (id: string) => void
  confirmKBDraftFromServer: (server: KnowledgeBase) => void

  addOptimisticKB: (tempId: string, kb: KnowledgeBase) => void
  confirmKBCreate: (tempId: string, server: KnowledgeBase) => void
  rollbackKBCreate: (tempId: string) => void

  markKBDeleted: (id: string) => void
  confirmKBDelete: (id: string) => void
  rollbackKBDelete: (id: string) => void

  reset: () => void
}

export const useKnowledgeBaseStore = create<KnowledgeBaseStoreState>()(
  subscribeWithSelector(
    immer((set) => ({
      knowledgeBases: [],
      knowledgeBasesById: {},
      activeKnowledgeBaseId: null,
      isLoading: false,
      hasLoadedOnce: false,

      pendingUpdates: {},
      pendingDraftPatches: {},
      optimisticNewKBs: {},
      optimisticDeleted: new Set<string>(),

      setKnowledgeBases: (kbs) => {
        set((state) => {
          state.knowledgeBases = kbs
          const byId: Record<string, KnowledgeBase> = {}
          for (const kb of kbs) byId[kb.id] = kb
          state.knowledgeBasesById = byId
          state.hasLoadedOnce = true

          // Reconcile optimistic state.
          for (const [id, pending] of Object.entries(state.pendingUpdates)) {
            const server = byId[id]
            if (!server) continue
            const merged = { ...pending.original, ...pending.optimistic }
            const matches = (Object.keys(pending.optimistic) as Array<keyof KnowledgeBase>).every(
              (k) => server[k] === (merged as KnowledgeBase)[k]
            )
            if (matches) delete state.pendingUpdates[id]
          }
          for (const [id, pending] of Object.entries(state.pendingDraftPatches)) {
            const server = byId[id]
            if (!server) continue
            const serverDraft = (server.draftSettings as KBDraftSettings | null) ?? {}
            const remaining: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(pending.patch)) {
              if (!deepEqual((serverDraft as Record<string, unknown>)[k], v)) remaining[k] = v
            }
            if (Object.keys(remaining).length === 0) {
              delete state.pendingDraftPatches[id]
            } else {
              state.pendingDraftPatches[id] = {
                patch: remaining as KBDraftSettings,
                baseDraft: (server.draftSettings as KBDraftSettings | null) ?? null,
              }
            }
          }
          for (const tempId of Object.keys(state.optimisticNewKBs)) {
            if (byId[tempId]) delete state.optimisticNewKBs[tempId]
          }
          for (const id of state.optimisticDeleted) {
            if (!byId[id]) state.optimisticDeleted.delete(id)
          }
        })
      },

      applyKnowledgeBaseFromServer: (kb) => {
        set((state) => {
          state.knowledgeBasesById[kb.id] = kb
          const idx = state.knowledgeBases.findIndex((x) => x.id === kb.id)
          if (idx === -1) state.knowledgeBases.push(kb)
          else state.knowledgeBases[idx] = kb
          delete state.pendingUpdates[kb.id]
        })
      },

      setActiveKnowledgeBaseId: (id) => {
        set((state) => {
          state.activeKnowledgeBaseId = id
        })
      },

      setLoading: (isLoading) => {
        set((state) => {
          state.isLoading = isLoading
        })
      },

      // ─── Optimistic update ────────────────────────────────────────
      setKBOptimistic: (id, updates) => {
        set((state) => {
          const server = state.knowledgeBasesById[id] ?? state.optimisticNewKBs[id]
          if (!server) return
          const existing = state.pendingUpdates[id]
          state.pendingUpdates[id] = {
            optimistic: existing ? { ...existing.optimistic, ...updates } : updates,
            original: existing?.original ?? server,
          }
        })
      },

      confirmKBUpdate: (id, server) => {
        set((state) => {
          delete state.pendingUpdates[id]
          if (server) {
            state.knowledgeBasesById[id] = server
            const idx = state.knowledgeBases.findIndex((x) => x.id === id)
            if (idx >= 0) state.knowledgeBases[idx] = server
          }
        })
      },

      rollbackKBUpdate: (id) => {
        set((state) => {
          delete state.pendingUpdates[id]
        })
      },

      // ─── Optimistic draft-settings patch ─────────────────────────
      setKBDraftPatchOptimistic: (id, patch) => {
        set((state) => {
          const server = state.knowledgeBasesById[id] ?? state.optimisticNewKBs[id]
          if (!server) return
          const existing = state.pendingDraftPatches[id]
          state.pendingDraftPatches[id] = {
            patch: existing ? { ...existing.patch, ...patch } : { ...patch },
            baseDraft:
              existing?.baseDraft ?? (server.draftSettings as KBDraftSettings | null) ?? null,
          }
        })
      },

      clearKBDraftOptimistic: (id) => {
        set((state) => {
          delete state.pendingDraftPatches[id]
        })
      },

      /**
       * Reconcile pending draft patches against a fresh server row. Drops keys
       * that the server has already merged so the optimistic layer doesn't
       * keep replaying stale edits.
       */
      confirmKBDraftFromServer: (server) => {
        set((state) => {
          state.knowledgeBasesById[server.id] = server
          const idx = state.knowledgeBases.findIndex((x) => x.id === server.id)
          if (idx === -1) state.knowledgeBases.push(server)
          else state.knowledgeBases[idx] = server
          const pending = state.pendingDraftPatches[server.id]
          if (!pending) return
          const serverDraft = (server.draftSettings as KBDraftSettings | null) ?? {}
          const remaining: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(pending.patch)) {
            if (!deepEqual((serverDraft as Record<string, unknown>)[k], v)) remaining[k] = v
          }
          if (Object.keys(remaining).length === 0) {
            delete state.pendingDraftPatches[server.id]
          } else {
            state.pendingDraftPatches[server.id] = {
              patch: remaining as KBDraftSettings,
              baseDraft: (server.draftSettings as KBDraftSettings | null) ?? null,
            }
          }
        })
      },

      // ─── Optimistic create ────────────────────────────────────────
      addOptimisticKB: (tempId, kb) => {
        set((state) => {
          state.optimisticNewKBs[tempId] = kb
          state.knowledgeBases.push(kb)
        })
      },

      confirmKBCreate: (tempId, server) => {
        set((state) => {
          delete state.optimisticNewKBs[tempId]
          state.knowledgeBasesById[server.id] = server
          const idx = state.knowledgeBases.findIndex((x) => x.id === tempId)
          if (idx >= 0) state.knowledgeBases[idx] = server
          else state.knowledgeBases.push(server)
        })
      },

      rollbackKBCreate: (tempId) => {
        set((state) => {
          delete state.optimisticNewKBs[tempId]
          state.knowledgeBases = state.knowledgeBases.filter((x) => x.id !== tempId)
        })
      },

      // ─── Optimistic delete ────────────────────────────────────────
      markKBDeleted: (id) => {
        set((state) => {
          state.optimisticDeleted.add(id)
        })
      },

      confirmKBDelete: (id) => {
        set((state) => {
          state.optimisticDeleted.delete(id)
          delete state.knowledgeBasesById[id]
          state.knowledgeBases = state.knowledgeBases.filter((x) => x.id !== id)
        })
      },

      rollbackKBDelete: (id) => {
        set((state) => {
          state.optimisticDeleted.delete(id)
        })
      },

      reset: () => {
        set((state) => {
          state.knowledgeBases = []
          state.knowledgeBasesById = {}
          state.activeKnowledgeBaseId = null
          state.isLoading = false
          state.hasLoadedOnce = false
          state.pendingUpdates = {}
          state.pendingDraftPatches = {}
          state.optimisticNewKBs = {}
          state.optimisticDeleted.clear()
        })
      },
    }))
  )
)

export const getKnowledgeBaseStoreState = () => useKnowledgeBaseStore.getState()

export function selectEffectiveKnowledgeBases(state: KnowledgeBaseStoreState): KnowledgeBase[] {
  return state.knowledgeBases.filter((kb) => !state.optimisticDeleted.has(kb.id))
}

export function selectEffectiveKnowledgeBase(
  state: KnowledgeBaseStoreState,
  id: string
): KnowledgeBase | undefined {
  if (state.optimisticDeleted.has(id)) return undefined
  const optNew = state.optimisticNewKBs[id]
  let kb: KnowledgeBase | undefined = optNew
  if (!kb) kb = state.knowledgeBasesById[id]
  if (!kb) return undefined
  const pendingFlat = state.pendingUpdates[id]
  if (pendingFlat) kb = { ...kb, ...pendingFlat.optimistic }
  const pendingDraft = state.pendingDraftPatches[id]
  if (pendingDraft) {
    const baseDraft = (kb.draftSettings as KBDraftSettings | null) ?? {}
    kb = {
      ...kb,
      draftSettings: { ...baseDraft, ...pendingDraft.patch },
    } as KnowledgeBase
  }
  return kb
}

/** Live row + pending draft envelope merged on top. Use anywhere admin UI renders KB. */
export function selectMergedKB(kb: KnowledgeBase | undefined): KnowledgeBase | undefined {
  if (!kb) return undefined
  return mergeDraftOverLive(
    kb as Record<string, unknown> & {
      draftSettings?: KBDraftSettings | null
    }
  ) as KnowledgeBase
}

export function selectHasUnpublishedSettings(kb: KnowledgeBase | undefined): boolean {
  return hasUnpublishedSettingsHelper((kb?.draftSettings as KBDraftSettings | null) ?? null)
}

export function selectDraftedSections(kb: KnowledgeBase | undefined): Set<DraftSection> {
  return draftedSectionsHelper((kb?.draftSettings as KBDraftSettings | null) ?? null)
}
