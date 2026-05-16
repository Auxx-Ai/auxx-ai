// apps/web/src/components/agents/ui/detail/knowledge/flat-record-list.tsx
'use client'

import type { Resource } from '@auxx/lib/resources/client'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { FileText, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { RecordPicker } from '~/components/pickers/record-picker/record-picker'
import { useRecord } from '~/components/resources/hooks/use-record'
import type { AgentDetail } from '../../../store/agent-store'
import { AgentScopeActions } from './agent-scope-actions'
import { deriveEffectiveMode, type EffectiveScopeMode } from './derive-scope-mode'
import type { useScopeMutations } from './use-scope-mutations'

type ScopeMutations = ReturnType<typeof useScopeMutations>

interface FlatRecordListProps {
  resource: Resource
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
  /** Mode applied when admin picks a record via the "+ Add" picker. */
  defaultAddMode?: EffectiveScopeMode
}

/**
 * Renders the records an admin has *explicitly added* (scope row or pin) for
 * one resource type — never the full corpus. An "+ Add" row at the bottom
 * opens `RecordPicker` to attach more.
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
 * Union of scope-row record ids and pinned record ids for one resource type.
 * Definition-level entries (`entityInstanceId === null`) are excluded — those
 * are owned by the depth-0 container row.
 */
function useAddedRecordIds(entityDefinitionId: string, agent: AgentDetail): string[] {
  return useMemo(() => {
    const ids = new Set<string>()
    for (const s of agent.resourceScopes) {
      if (s.entityDefinitionId === entityDefinitionId && s.entityInstanceId) {
        ids.add(toRecordId(entityDefinitionId, s.entityInstanceId))
      }
    }
    for (const p of agent.pinnedRecords) {
      const colon = p.recordId.indexOf(':')
      if (colon === -1) continue
      if (p.recordId.slice(0, colon) === entityDefinitionId) ids.add(p.recordId)
    }
    return Array.from(ids)
  }, [agent.resourceScopes, agent.pinnedRecords, entityDefinitionId])
}

interface RecordLeafRowProps {
  recordId: string
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
}

function RecordLeafRow({ recordId, agent, mutations, depth }: RecordLeafRowProps) {
  const { record, isLoading } = useRecord({ recordId: recordId as RecordId })
  const effectiveMode = deriveEffectiveMode(agent.resourceScopes, recordId)
  const pin = agent.pinnedRecords.find((p) => p.recordId === recordId)
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
          isPinned={!!pin}
          pinReason={pin?.pinReason ?? null}
          onSetMode={(mode) => mutations.setMode(recordId, mode)}
          onTogglePin={() => mutations.setPin(recordId, !pin)}
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
