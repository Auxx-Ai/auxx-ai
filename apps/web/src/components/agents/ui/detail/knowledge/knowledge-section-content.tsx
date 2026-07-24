// apps/web/src/components/agents/ui/detail/knowledge/knowledge-section-content.tsx
'use client'

import type { Resource } from '@auxx/lib/resources/client'
import { useCallback, useMemo } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { ResourceTypeBranch } from './resource-type-branch'
import { useScopeMutations } from './use-scope-mutations'

/**
 * Depth-0 ordering for the resource types that remain valid retrieval scope
 * targets. `article` is omitted intentionally — articles render under their
 * owning KB (see `KbBranch`). Entity records (contacts, tickets, etc.) are
 * no longer scope targets here — access to them is governed by the
 * Permissions tab.
 */
const SYSTEM_ORDER: ReadonlyArray<string> = ['kb', 'dataset']

interface KnowledgeSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

/**
 * Knowledge tab body: a retrieval-scope tree over knowledge bases and
 * datasets. Narrowing scope here limits what the agent searches — it does
 * not grant or restrict access; that's the Permissions tab's job. Pinned
 * state shows inline via the star icon on every row — no separate pinned
 * block.
 */
export function KnowledgeSectionContent({ agent, onAutosaveChange }: KnowledgeSectionContentProps) {
  const handleSavingChange = useCallback(
    (saving: boolean) => {
      onAutosaveChange?.(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
    },
    [onAutosaveChange]
  )

  const { resources, isLoading } = useResources()
  const mutations = useScopeMutations(agent.id, agent.slug, handleSavingChange)

  const orderedTypes = useMemo<Resource[]>(() => {
    const byId = new Map(resources.map((r) => [r.id, r]))
    return SYSTEM_ORDER.map((id) => byId.get(id)).filter((r): r is Resource => !!r)
  }, [resources])

  if (isLoading && orderedTypes.length === 0) {
    return <p className='text-sm text-muted-foreground py-2'>Loading resources…</p>
  }

  if (orderedTypes.length === 0) {
    return (
      <p className='text-sm text-muted-foreground py-2'>
        No knowledge bases or datasets available yet. Set one up to scope this agent's retrieval.
      </p>
    )
  }

  return (
    <div className='ps-2 pe-4'>
      {orderedTypes.map((resource) => (
        <ResourceTypeBranch
          key={resource.id}
          resource={resource}
          agent={agent}
          mutations={mutations}
        />
      ))}
    </div>
  )
}
