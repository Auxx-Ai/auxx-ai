// apps/web/src/components/agents/ui/detail/knowledge/resource-type-branch.tsx
'use client'

import type { AgentScopeMode } from '@auxx/lib/agents/client'
import type { Resource } from '@auxx/lib/resources/client'
import { EntityIcon } from '@auxx/ui/components/icons'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { useState } from 'react'
import type { AgentDetail } from '../../../store/agent-store'
import { AgentScopeActions } from './agent-scope-actions'
import { deriveEffectiveMode } from './derive-scope-mode'
import { FlatRecordList } from './flat-record-list'
import { KbBranch } from './kb-branch'
import type { useScopeMutations } from './use-scope-mutations'

type ScopeMutations = ReturnType<typeof useScopeMutations>

interface ResourceTypeBranchProps {
  resource: Resource
  agent: AgentDetail
  mutations: ScopeMutations
}

/**
 * Resource types whose `include_descendants` mode is meaningful — picking one
 * via the "+ Add" picker should default to "Whole" rather than "Container
 * only" because scoping in descendants is the common case. Only `kb` reaches
 * this component with descendants (articles); `dataset` has none.
 */
const HAS_DESCENDANTS = new Set<string>(['kb'])

/**
 * Depth-0 row for one knowledge-source type (`kb` or `dataset`). The row
 * owns a definition-level scope + pin (recordId = resource.id with no
 * instance suffix). Expanding reveals only the records the admin has
 * explicitly added (via picker), never the full corpus.
 */
export function ResourceTypeBranch({ resource, agent, mutations }: ResourceTypeBranchProps) {
  const recordId = resource.id
  const [isOpen, setIsOpen] = useState(false)
  const effectiveMode = deriveEffectiveMode(agent.knowledge, recordId)
  const entry = agent.knowledge.find((k) => k.recordId === recordId)
  const isMentionLocked = entry?.source === 'mention'

  const defaultAddMode: AgentScopeMode = HAS_DESCENDANTS.has(resource.id)
    ? 'include_descendants'
    : 'include_one'

  return (
    <TreeRow
      icon={
        <EntityIcon
          iconId={resource.icon ?? 'circle'}
          color={resource.color ?? 'gray'}
          size='sm'
          inverse
          className='inset-shadow-xs inset-shadow-black/20'
        />
      }
      title={resource.plural}
      depth={0}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((o) => !o)}
      actions={
        <AgentScopeActions
          kind='container'
          effectiveMode={effectiveMode}
          isMentionLocked={isMentionLocked}
          onSetMode={(mode) => mutations.setMode(recordId, mode)}
        />
      }>
      {resource.id === 'kb' ? (
        <KbBranch agent={agent} mutations={mutations} depth={1} />
      ) : (
        // Only 'dataset' reaches this branch — the only other resource in
        // SYSTEM_ORDER (see knowledge-section-content.tsx).
        <FlatRecordList
          resource={resource}
          agent={agent}
          mutations={mutations}
          depth={1}
          defaultAddMode={defaultAddMode}
        />
      )}
    </TreeRow>
  )
}
