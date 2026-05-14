// apps/web/src/components/agents/providers/agents-provider.tsx
'use client'

import { useAgents } from '../hooks/use-agents'

/**
 * Hydrates the agents Zustand store from `api.agent.list`. Wrap any surface
 * that reads agents from the store (list page, detail page, breadcrumb
 * switcher) so the store is populated before children render.
 */
export function AgentsProvider({ children }: { children: React.ReactNode }) {
  useAgents()
  return <>{children}</>
}
