// apps/web/src/components/agents/ui/detail/knowledge/kb-branch.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { generateId } from '@auxx/utils'
import { FileText, FolderClosed, FolderOpen, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RecordPicker } from '~/components/pickers/record-picker/record-picker'
import { useRecord } from '~/components/resources/hooks/use-record'
import { useRecordList } from '~/components/resources/hooks/use-record-list'
import type { AgentDetail } from '../../../store/agent-store'
import { AgentScopeActions } from './agent-scope-actions'
import { deriveEffectiveMode } from './derive-scope-mode'
import type { useScopeMutations } from './use-scope-mutations'

type ScopeMutations = ReturnType<typeof useScopeMutations>

interface KbBranchProps {
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
}

/**
 * Body for the `kb` resource branch. Lists the KBs the admin has added (via
 * picker) and lets each expand to its full article tree. Setting "Whole" on
 * a KB still grants the agent access to every article; the per-article rows
 * inside exist so the admin can pin or override individual articles.
 */
export function KbBranch({ agent, mutations, depth }: KbBranchProps) {
  const addedKbIds = useAddedKbInstanceIds(agent)

  return (
    <>
      {addedKbIds.map((kbId) => (
        <KbContainerRow key={kbId} kbId={kbId} agent={agent} mutations={mutations} depth={depth} />
      ))}
      <AddKbRow
        depth={depth}
        excludeIds={addedKbIds.map((id) => toRecordId('kb', id))}
        onAdd={(recordId) => mutations.setMode(recordId, 'include_descendants')}
      />
    </>
  )
}

function useAddedKbInstanceIds(agent: AgentDetail): string[] {
  return useMemo(() => {
    const ids = new Set<string>()
    for (const s of agent.resourceScopes) {
      if (s.entityDefinitionId === 'kb' && s.entityInstanceId) ids.add(s.entityInstanceId)
    }
    for (const p of agent.pinnedRecords) {
      const colon = p.recordId.indexOf(':')
      if (colon === -1) continue
      if (p.recordId.slice(0, colon) === 'kb') ids.add(p.recordId.slice(colon + 1))
    }
    return Array.from(ids)
  }, [agent.resourceScopes, agent.pinnedRecords])
}

interface KbContainerRowProps {
  kbId: string
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
}

function KbContainerRow({ kbId, agent, mutations, depth }: KbContainerRowProps) {
  const recordId = toRecordId('kb', kbId)
  const [isOpen, setIsOpen] = useState(false)
  const { record } = useRecord({ recordId })
  const effectiveMode = deriveEffectiveMode(agent.resourceScopes, recordId)
  const pin = agent.pinnedRecords.find((p) => p.recordId === recordId)
  const title = (record?.displayName as string) ?? (record?.title as string) ?? 'Untitled'

  return (
    <TreeRow
      icon={isOpen ? <FolderOpen className='size-4' /> : <FolderClosed className='size-4' />}
      title={title}
      depth={depth}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((o) => !o)}
      dimmed={effectiveMode === 'exclude'}
      actions={
        <AgentScopeActions
          kind='container'
          effectiveMode={effectiveMode}
          isPinned={!!pin}
          pinReason={pin?.pinReason ?? null}
          onSetMode={(mode) => mutations.setMode(recordId, mode)}
          onTogglePin={() => mutations.setPin(recordId, !pin)}
        />
      }>
      <KbArticles kbId={kbId} agent={agent} mutations={mutations} depth={depth + 1} />
    </TreeRow>
  )
}

interface KbArticlesProps {
  kbId: string
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
}

function KbArticles({ kbId, agent, mutations, depth }: KbArticlesProps) {
  const filters = useMemo<ConditionGroup[]>(
    () => [
      {
        id: 'agent-scope-kb-filter',
        logicalOperator: 'AND',
        conditions: [
          {
            id: generateId(),
            fieldId: 'article:knowledgeBaseId',
            operator: 'is',
            value: kbId,
          },
        ],
      },
    ],
    [kbId]
  )

  const { recordIds, isLoading } = useRecordList({
    entityDefinitionId: 'article',
    filters,
    limit: 100,
  })

  if (isLoading && recordIds.length === 0) {
    return (
      <div
        className='text-xs text-muted-foreground py-1'
        style={{ paddingLeft: `${0.5 + depth * 1.125}rem` }}>
        Loading articles…
      </div>
    )
  }
  if (recordIds.length === 0) {
    return (
      <div
        className='text-xs text-muted-foreground py-1'
        style={{ paddingLeft: `${0.5 + depth * 1.125}rem` }}>
        No articles in this KB.
      </div>
    )
  }

  return (
    <>
      {recordIds.map((id) => (
        <ArticleLeafRow key={id} articleId={id} agent={agent} mutations={mutations} depth={depth} />
      ))}
    </>
  )
}

interface ArticleLeafRowProps {
  articleId: string
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
}

function ArticleLeafRow({ articleId, agent, mutations, depth }: ArticleLeafRowProps) {
  const recordId = toRecordId('article', articleId)
  const { record, isLoading } = useRecord({ recordId })
  const effectiveMode = deriveEffectiveMode(agent.resourceScopes, recordId)
  const pin = agent.pinnedRecords.find((p) => p.recordId === recordId)
  const title = (record?.displayName as string) ?? (record?.title as string) ?? ''

  return (
    <TreeRow
      icon={<FileText className='size-4' />}
      title={title || (isLoading ? '…' : 'Untitled')}
      depth={depth}
      dimmed={effectiveMode === 'exclude'}
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

interface AddKbRowProps {
  depth: number
  excludeIds: RecordId[]
  onAdd: (recordId: string) => void
}

function AddKbRow({ depth, excludeIds, onAdd }: AddKbRowProps) {
  return (
    <RecordPicker
      entityDefinitionId='kb'
      value={[]}
      onChange={() => {}}
      multi={false}
      onSelectSingle={(recordId) => onAdd(recordId)}
      excludeIds={excludeIds}
      placeholder='Search knowledge bases…'>
      <div className='cursor-pointer'>
        <TreeRow icon={<Plus className='size-4' />} title='Add knowledge base' depth={depth} />
      </div>
    </RecordPicker>
  )
}
