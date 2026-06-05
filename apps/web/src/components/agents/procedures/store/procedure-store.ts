// apps/web/src/components/agents/procedures/store/procedure-store.ts
'use client'

import '~/lib/immer-config' // Enables Map/Set support for immer
import type { TriggerExample } from '@auxx/lib/agents/procedures/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

/**
 * ProcedureMeta — the light, editable trigger meta of one standalone
 * `Procedure` draft. The heavy TipTap `doc` is deliberately NOT here: the
 * editor owns it (uncontrolled, seeded once via `loadedRef`), mirroring how KB
 * keeps article content out of `article-store.ts`. Everything in this shape is
 * cheap, optimistically patched, and survives a background `getById` refetch.
 */
export interface ProcedureMeta {
  id: string
  name: string
  whenToUse: string
  triggerExamples: TriggerExample[]
  ruleset: ConditionGroup[]
  activeVersionId: string | null
  hasUnpublishedChanges: boolean
}

interface PendingProcedureUpdate {
  optimistic: Partial<ProcedureMeta>
  original: ProcedureMeta
}

interface ProcedureStoreState {
  /** Procedure meta by id (server + reconciled optimistic state). */
  procedures: Map<string, ProcedureMeta>
  /** Pending field updates per procedure id. */
  pendingUpdates: Record<string, PendingProcedureUpdate>

  /** Hydrate/upsert from a server payload, keeping the pending overlay. */
  setProcedureFromServer: (meta: ProcedureMeta) => void
  /** Write authoritative base fields without touching the pending overlay. */
  applyMetadataFromServer: (id: string, fields: Partial<ProcedureMeta>) => void
  /** Instant optimistic patch — the keystroke shows immediately. */
  patchProcedure: (id: string, fields: Partial<ProcedureMeta>) => void
  /** Settle a pending update: with a server snapshot replace base + clear; without one, promote the delta. */
  confirmUpdate: (id: string, server?: ProcedureMeta) => void
  rollbackUpdate: (id: string) => void
  reset: () => void
}

/** Build the effective procedure view (server + pending overlay). */
function getEffective(state: ProcedureStoreState, id: string): ProcedureMeta | undefined {
  const server = state.procedures.get(id)
  if (!server) return undefined
  const pending = state.pendingUpdates[id]
  if (pending) return { ...server, ...pending.optimistic }
  return server
}

export const useProcedureStore = create<ProcedureStoreState>()(
  subscribeWithSelector(
    immer((set) => ({
      procedures: new Map<string, ProcedureMeta>(),
      pendingUpdates: {},

      setProcedureFromServer: (meta) => {
        set((state) => {
          state.procedures.set(meta.id, meta)
          // Reconcile the optimistic overlay with the server view: drop a
          // pending entry only once every optimistic key matches the server
          // value. Until then the overlay keeps winning, so a stale getById
          // refetch arriving mid-edit can't clobber an in-flight change.
          const pending = state.pendingUpdates[meta.id]
          if (pending) {
            const merged = { ...pending.original, ...pending.optimistic }
            const matches = (Object.keys(pending.optimistic) as Array<keyof ProcedureMeta>).every(
              (key) => meta[key] === merged[key]
            )
            if (matches) delete state.pendingUpdates[meta.id]
          }
        })
      },

      applyMetadataFromServer: (id, fields) => {
        set((state) => {
          const existing = state.procedures.get(id)
          if (existing) state.procedures.set(id, { ...existing, ...fields })
        })
      },

      patchProcedure: (id, fields) => {
        set((state) => {
          const server = state.procedures.get(id)
          if (!server) return
          const existing = state.pendingUpdates[id]
          state.pendingUpdates[id] = {
            optimistic: existing ? { ...existing.optimistic, ...fields } : fields,
            original: existing?.original ?? server,
          }
        })
      },

      confirmUpdate: (id, server) => {
        set((state) => {
          if (server) {
            state.procedures.set(id, server)
          } else {
            // No server snapshot — promote the optimistic delta to truth so the
            // UI keeps showing the confirmed values until a refetch lands,
            // instead of flickering back to the pre-mutation state.
            const pending = state.pendingUpdates[id]
            const existing = state.procedures.get(id)
            if (pending && existing) {
              state.procedures.set(id, { ...existing, ...pending.optimistic })
            }
          }
          delete state.pendingUpdates[id]
        })
      },

      rollbackUpdate: (id) => {
        set((state) => {
          delete state.pendingUpdates[id]
        })
      },

      reset: () => {
        set((state) => {
          state.procedures.clear()
          state.pendingUpdates = {}
        })
      },
    }))
  )
)

export const getProcedureStoreState = () => useProcedureStore.getState()

/** Selector helper for components that want the effective procedure meta. */
export function selectProcedure(state: ProcedureStoreState, id: string): ProcedureMeta | undefined {
  return getEffective(state, id)
}
