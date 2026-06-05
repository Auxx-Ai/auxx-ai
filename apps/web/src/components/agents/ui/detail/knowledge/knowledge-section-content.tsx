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
 * Depth-0 ordering for system resources. `article` is omitted intentionally —
 * articles render under their owning KB (see `KbBranch`).
 */
const SYSTEM_ORDER: ReadonlyArray<string> = [
  'kb',
  'contact',
  'company',
  'ticket',
  'dataset',
  'meeting',
  'part',
]

interface KnowledgeSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

/**
 * Knowledge tab body: a unified scope tree with one branch per resource
 * type, each expanding to its records. Pinned state shows inline via the
 * star icon on every row — no separate pinned block.
 */
export function KnowledgeSectionContent({ agent, onAutosaveChange }: KnowledgeSectionContentProps) {
  const handleSavingChange = useCallback(
    (saving: boolean) => {
      onAutosaveChange?.(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
    },
    [onAutosaveChange]
  )

  const { resources, customResources, isLoading } = useResources()
  const mutations = useScopeMutations(agent.id, agent.slug, handleSavingChange)

  const orderedTypes = useMemo<Resource[]>(() => {
    const byId = new Map(resources.map((r) => [r.id, r]))
    const system = SYSTEM_ORDER.map((id) => byId.get(id)).filter((r): r is Resource => !!r)
    const visibleCustom = customResources
      .filter((r) => r.isVisible !== false)
      .sort((a, b) => a.plural.localeCompare(b.plural))
    return [...system, ...visibleCustom]
  }, [resources, customResources])

  if (isLoading && orderedTypes.length === 0) {
    return <p className='text-sm text-muted-foreground py-2'>Loading resources…</p>
  }

  if (orderedTypes.length === 0) {
    return (
      <p className='text-sm text-muted-foreground py-2'>
        No resources available yet. Set up a knowledge base or entity to scope this agent.
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
