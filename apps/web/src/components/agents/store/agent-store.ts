// apps/web/src/components/agents/store/agent-store.ts
'use client'

import '~/lib/immer-config'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { RouterOutputs } from '~/trpc/react'

export type AgentListItem = RouterOutputs['agent']['list'][number]
export type AgentDetail = RouterOutputs['agent']['getById']

interface PendingAgentUpdate {
  optimistic: Partial<AgentListItem>
  original: AgentListItem
}

interface AgentStoreState {
  // ─── Server state ──────────────────────────────────────────────────
  agents: AgentListItem[]
  agentsById: Record<string, AgentListItem>
  agentsBySlug: Record<string, AgentListItem>
  isLoading: boolean
  hasLoadedOnce: boolean

  // ─── UI state ──────────────────────────────────────────────────────
  search: string

  // ─── Optimistic state ──────────────────────────────────────────────
  pendingUpdates: Record<string, PendingAgentUpdate>
  optimisticNewAgents: Record<string, AgentListItem>
  optimisticArchived: Set<string>

  // ─── Actions ───────────────────────────────────────────────────────
  setAgents: (agents: AgentListItem[]) => void
  applyAgentFromServer: (agent: AgentListItem) => void
  setLoading: (isLoading: boolean) => void
  setSearch: (s: string) => void

  setAgentOptimistic: (id: string, updates: Partial<AgentListItem>) => void
  confirmAgentUpdate: (id: string, server?: AgentListItem) => void
  rollbackAgentUpdate: (id: string) => void

  addOptimisticAgent: (tempId: string, agent: AgentListItem) => void
  confirmAgentCreate: (tempId: string, server: AgentListItem) => void
  rollbackAgentCreate: (tempId: string) => void

  markAgentArchived: (id: string) => void
  confirmAgentArchive: (id: string) => void
  rollbackAgentArchive: (id: string) => void

  reset: () => void
}

export const useAgentStore = create<AgentStoreState>()(
  subscribeWithSelector(
    immer((set) => ({
      agents: [],
      agentsById: {},
      agentsBySlug: {},
      isLoading: false,
      hasLoadedOnce: false,
      search: '',
      pendingUpdates: {},
      optimisticNewAgents: {},
      optimisticArchived: new Set<string>(),

      setAgents: (agents) =>
        set((state) => {
          state.agents = agents
          const byId: Record<string, AgentListItem> = {}
          const bySlug: Record<string, AgentListItem> = {}
          for (const a of agents) {
            byId[a.id] = a
            bySlug[a.slug] = a
          }
          state.agentsById = byId
          state.agentsBySlug = bySlug
          state.hasLoadedOnce = true

          // Drop pending updates the server has already merged.
          for (const [id, pending] of Object.entries(state.pendingUpdates)) {
            const server = byId[id]
            if (!server) continue
            const merged = { ...pending.original, ...pending.optimistic } as AgentListItem
            const matches = (Object.keys(pending.optimistic) as Array<keyof AgentListItem>).every(
              (k) => server[k] === merged[k]
            )
            if (matches) delete state.pendingUpdates[id]
          }
          for (const tempId of Object.keys(state.optimisticNewAgents)) {
            if (byId[tempId]) delete state.optimisticNewAgents[tempId]
          }
          for (const id of state.optimisticArchived) {
            const server = byId[id]
            if (!server || server.archivedAt) state.optimisticArchived.delete(id)
          }
        }),

      applyAgentFromServer: (agent) =>
        set((state) => {
          state.agentsById[agent.id] = agent
          state.agentsBySlug[agent.slug] = agent
          const idx = state.agents.findIndex((x) => x.id === agent.id)
          if (idx === -1) state.agents.push(agent)
          else state.agents[idx] = agent
          delete state.pendingUpdates[agent.id]
          state.optimisticArchived.delete(agent.id)
        }),

      setLoading: (isLoading) =>
        set((state) => {
          state.isLoading = isLoading
        }),

      setSearch: (s) =>
        set((state) => {
          state.search = s
        }),

      setAgentOptimistic: (id, updates) =>
        set((state) => {
          const server = state.agentsById[id] ?? state.optimisticNewAgents[id]
          if (!server) return
          const existing = state.pendingUpdates[id]
          state.pendingUpdates[id] = {
            optimistic: existing ? { ...existing.optimistic, ...updates } : updates,
            original: existing?.original ?? server,
          }
        }),

      confirmAgentUpdate: (id, server) =>
        set((state) => {
          delete state.pendingUpdates[id]
          if (server) {
            state.agentsById[id] = server
            state.agentsBySlug[server.slug] = server
            const idx = state.agents.findIndex((x) => x.id === id)
            if (idx >= 0) state.agents[idx] = server
          }
        }),

      rollbackAgentUpdate: (id) =>
        set((state) => {
          delete state.pendingUpdates[id]
        }),

      addOptimisticAgent: (tempId, agent) =>
        set((state) => {
          state.optimisticNewAgents[tempId] = agent
          state.agents.push(agent)
        }),

      confirmAgentCreate: (tempId, server) =>
        set((state) => {
          delete state.optimisticNewAgents[tempId]
          state.agentsById[server.id] = server
          state.agentsBySlug[server.slug] = server
          const idx = state.agents.findIndex((x) => x.id === tempId)
          if (idx >= 0) state.agents[idx] = server
          else state.agents.push(server)
        }),

      rollbackAgentCreate: (tempId) =>
        set((state) => {
          delete state.optimisticNewAgents[tempId]
          state.agents = state.agents.filter((x) => x.id !== tempId)
        }),

      markAgentArchived: (id) =>
        set((state) => {
          state.optimisticArchived.add(id)
        }),

      confirmAgentArchive: (id) =>
        set((state) => {
          state.optimisticArchived.delete(id)
        }),

      rollbackAgentArchive: (id) =>
        set((state) => {
          state.optimisticArchived.delete(id)
        }),

      reset: () =>
        set((state) => {
          state.agents = []
          state.agentsById = {}
          state.agentsBySlug = {}
          state.isLoading = false
          state.hasLoadedOnce = false
          state.search = ''
          state.pendingUpdates = {}
          state.optimisticNewAgents = {}
          state.optimisticArchived.clear()
        }),
    }))
  )
)

export const getAgentStoreState = () => useAgentStore.getState()

/** Effective list — does NOT remove archived rows; server-side `list` already filters by default. */
export function selectEffectiveAgents(state: AgentStoreState): AgentListItem[] {
  return state.agents.map((a) => {
    const pending = state.pendingUpdates[a.id]
    return pending ? ({ ...a, ...pending.optimistic } as AgentListItem) : a
  })
}

export function selectEffectiveAgent(
  state: AgentStoreState,
  idOrSlug: string
): AgentListItem | undefined {
  const fromId = state.agentsById[idOrSlug]
  const fromSlug = state.agentsBySlug[idOrSlug]
  let a = fromId ?? fromSlug ?? state.optimisticNewAgents[idOrSlug]
  if (!a) return undefined
  const pending = state.pendingUpdates[a.id]
  if (pending) a = { ...a, ...pending.optimistic } as AgentListItem
  return a
}

export function selectAgentSearch(state: AgentStoreState): string {
  return state.search
}
