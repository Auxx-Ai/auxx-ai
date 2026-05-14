// apps/web/src/components/agents/ui/detail/knowledge/knowledge-sub-tab.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { generateId } from '@auxx/utils'
import { useMemo, useState } from 'react'
import { useRecord } from '~/components/resources/hooks/use-record'
import { useRecordList } from '~/components/resources/hooks/use-record-list'
import type { AgentDetail } from '../../../store/agent-store'
import { AgentScopeRow } from './agent-scope-row'
import { deriveEffectiveMode } from './derive-scope-mode'
import { useScopeMutations } from './use-scope-mutations'

interface KnowledgeSubTabProps {
  agent: AgentDetail
  onSavingChange?: (saving: boolean) => void
}

/**
 * Renders the Knowledge-base + articles tree. KB containers expand to show
 * their articles. Each row owns its own mode dropdown + pin star; both write
 * through `useScopeMutations`.
 */
export function KnowledgeSubTab({ agent, onSavingChange }: KnowledgeSubTabProps) {
  const { setMode, setPin } = useScopeMutations(agent.id, onSavingChange)
  const { recordIds: kbIds, isLoading } = useRecordList({
    entityDefinitionId: 'kb',
    limit: 100,
  })

  if (isLoading && kbIds.length === 0) {
    return <p className='text-sm text-muted-foreground py-2'>Loading knowledge bases…</p>
  }
  if (kbIds.length === 0) {
    return (
      <p className='text-sm text-muted-foreground py-2'>
        No knowledge bases yet. Create one to scope this agent to a specific source.
      </p>
    )
  }

  return (
    <div className='space-y-1'>
      {kbIds.map((kbId) => (
        <KbContainerRow
          key={kbId}
          kbId={kbId}
          agent={agent}
          onSetMode={(recordId, mode) => setMode(recordId, mode)}
          onTogglePin={(recordId, pinned) => setPin(recordId, pinned)}
        />
      ))}
    </div>
  )
}

interface KbContainerRowProps {
  kbId: string
  agent: AgentDetail
  onSetMode: (
    recordId: string,
    mode: 'include_descendants' | 'include_one' | 'exclude' | 'none'
  ) => void
  onTogglePin: (recordId: string, pinned: boolean) => void
}

function KbContainerRow({ kbId, agent, onSetMode, onTogglePin }: KbContainerRowProps) {
  const recordId = toRecordId('kb', kbId)
  const [isOpen, setIsOpen] = useState(false)
  const { record } = useRecord({ recordId })
  const effectiveMode = deriveEffectiveMode(agent.resourceScopes, recordId)
  const pin = agent.pinnedRecords.find((p) => p.recordId === recordId)

  return (
    <>
      <AgentScopeRow
        recordId={recordId}
        title={(record?.displayName as string) ?? (record?.title as string) ?? 'Untitled'}
        kind='container'
        depth={0}
        effectiveMode={effectiveMode}
        isPinned={!!pin}
        pinReason={pin?.pinReason ?? null}
        isOpen={isOpen}
        onToggleOpen={() => setIsOpen((o) => !o)}
        onSetMode={(mode) => onSetMode(recordId, mode)}
        onTogglePin={() => onTogglePin(recordId, !pin)}
      />
      {isOpen && (
        <KbArticles kbId={kbId} agent={agent} onSetMode={onSetMode} onTogglePin={onTogglePin} />
      )}
    </>
  )
}

interface KbArticlesProps extends Omit<KbContainerRowProps, 'kbId'> {
  kbId: string
}

function KbArticles({ kbId, agent, onSetMode, onTogglePin }: KbArticlesProps) {
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
    limit: 50,
  })

  if (isLoading && recordIds.length === 0) {
    return <div className='pl-9 text-xs text-muted-foreground py-1'>Loading articles…</div>
  }
  if (recordIds.length === 0) {
    return <div className='pl-9 text-xs text-muted-foreground py-1'>No articles in this KB.</div>
  }

  return (
    <>
      {recordIds.map((id) => (
        <ArticleLeafRow
          key={id}
          articleId={id}
          agent={agent}
          onSetMode={onSetMode}
          onTogglePin={onTogglePin}
        />
      ))}
    </>
  )
}

interface ArticleLeafRowProps {
  articleId: string
  agent: AgentDetail
  onSetMode: (
    recordId: string,
    mode: 'include_descendants' | 'include_one' | 'exclude' | 'none'
  ) => void
  onTogglePin: (recordId: string, pinned: boolean) => void
}

function ArticleLeafRow({ articleId, agent, onSetMode, onTogglePin }: ArticleLeafRowProps) {
  const recordId = toRecordId('article', articleId)
  const { record, isLoading } = useRecord({ recordId })
  const effectiveMode = deriveEffectiveMode(agent.resourceScopes, recordId)
  const pin = agent.pinnedRecords.find((p) => p.recordId === recordId)

  return (
    <AgentScopeRow
      recordId={recordId}
      title={(record?.displayName as string) ?? (record?.title as string) ?? ''}
      kind='leaf'
      depth={1}
      effectiveMode={effectiveMode}
      isPinned={!!pin}
      pinReason={pin?.pinReason ?? null}
      isLoading={isLoading}
      onSetMode={(mode) => onSetMode(recordId, mode)}
      onTogglePin={() => onTogglePin(recordId, !pin)}
    />
  )
}
