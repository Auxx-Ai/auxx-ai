// apps/web/src/components/agents/ui/detail/knowledge/flat-record-list.tsx
'use client'

import type { AgentScopeMode } from '@auxx/lib/agents/client'
import type { RecordId, Resource } from '@auxx/lib/resources/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { FileText, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { RecordPicker } from '~/components/pickers/record-picker/record-picker'
import { useRecord } from '~/components/resources/hooks/use-record'
import type { AgentDetail } from '../../../store/agent-store'
import { AgentScopeActions } from './agent-scope-actions'
import { deriveEffectiveMode } from './derive-scope-mode'
import type { useScopeMutations } from './use-scope-mutations'

type ScopeMutations = ReturnType<typeof useScopeMutations>

interface FlatRecordListProps {
  resource: Resource
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
  /**
   * Mode applied when admin picks a record via the "+ Add" picker. Only the
   * writable modes — the `inherited_*` variants of `EffectiveScopeMode` are
   * derived, never stored.
   */
  defaultAddMode?: AgentScopeMode
}

/**
 * Renders the datasets an admin has *explicitly added* (scope row or pin) —
 * never the full corpus. The only resource type that reaches this component
 * is `dataset` (`kb` has its own `KbBranch` with article-level picking). An
 * "+ Add" row at the bottom opens `RecordPicker` to attach more.
 */
export function FlatRecordList({
  resource,
  agent,
  mutations,
  depth,
  defaultAddMode = 'include_one',
}: FlatRecordListProps) {
  const addedRecordIds = useAddedRecordIds(resource.id, agent)

  return (
    <>
      {addedRecordIds.map((recordId) => (
        <RecordLeafRow
          key={recordId}
          recordId={recordId}
          agent={agent}
          mutations={mutations}
          depth={depth}
        />
      ))}
      <AddRecordRow
        resource={resource}
        depth={depth}
        excludeIds={addedRecordIds}
        onAdd={(recordId) => mutations.setMode(recordId, defaultAddMode)}
      />
    </>
  )
}

/**
 * Knowledge-entry record ids scoped to the `dataset` resource type.
 * Definition-level entries (no `:instanceId` suffix) are excluded — those
 * are owned by the depth-0 container row.
 */
function useAddedRecordIds(entityDefinitionId: string, agent: AgentDetail): string[] {
  return useMemo(() => {
    const ids = new Set<string>()
    for (const k of agent.knowledge) {
      const colon = k.recordId.indexOf(':')
      if (colon === -1) continue
      if (k.recordId.slice(0, colon) === entityDefinitionId) ids.add(k.recordId)
    }
    return Array.from(ids)
  }, [agent.knowledge, entityDefinitionId])
}

interface RecordLeafRowProps {
  recordId: string
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
}

function RecordLeafRow({ recordId, agent, mutations, depth }: RecordLeafRowProps) {
  const { record, isLoading } = useRecord({ recordId: recordId as RecordId })
  const effectiveMode = deriveEffectiveMode(agent.knowledge, recordId)
  const entry = agent.knowledge.find((k) => k.recordId === recordId)
  const isMentionLocked = entry?.source === 'mention'
  const title = (record?.displayName as string) ?? (record?.title as string) ?? ''

  return (
    <TreeRow
      icon={<FileText className='size-4' />}
      title={title || (isLoading ? '…' : 'Untitled')}
      depth={depth}
      actions={
        <AgentScopeActions
          kind='leaf'
          effectiveMode={effectiveMode}
          isMentionLocked={isMentionLocked}
          onSetMode={(mode) => mutations.setMode(recordId, mode)}
        />
      }
    />
  )
}

interface AddRecordRowProps {
  resource: Resource
  depth: number
  excludeIds: string[]
  onAdd: (recordId: string) => void
}

function AddRecordRow({ resource, depth, excludeIds, onAdd }: AddRecordRowProps) {
  return (
    <RecordPicker
      entityDefinitionId={resource.id}
      value={[]}
      onChange={() => {}}
      multi={false}
      onSelectSingle={(recordId) => onAdd(recordId)}
      excludeIds={excludeIds as RecordId[]}
      placeholder={`Search ${resource.plural.toLowerCase()}…`}>
      <div className='cursor-pointer'>
        <TreeRow
          icon={<Plus className='size-4' />}
          title={`Add ${resource.label.toLowerCase()}`}
          depth={depth}
        />
      </div>
    </RecordPicker>
  )
}
