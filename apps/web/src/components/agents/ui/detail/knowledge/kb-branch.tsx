// apps/web/src/components/agents/ui/detail/knowledge/kb-branch.tsx
'use client'

import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import type { ArticleTreeNode } from '@auxx/ui/components/kb/utils'
import { buildArticleTree } from '@auxx/ui/components/kb/utils'
import { TreeRow } from '@auxx/ui/components/tree-row'
import {
  ExternalLink,
  FileText,
  FolderClosed,
  FolderOpen,
  Hash,
  LayoutPanelTop,
  Plus,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { RecordPicker } from '~/components/pickers/record-picker/record-picker'
import { useRecord } from '~/components/resources/hooks/use-record'
import { api } from '~/trpc/react'
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
 * inside exist so the admin can pin or override individual articles. Articles
 * are rendered as the real `parentId` tree (categories, headers, tabs, links)
 * — same shape as the KB editor sidebar.
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
      <KbArticles
        kbId={kbId}
        agent={agent}
        mutations={mutations}
        depth={depth + 1}
        kbRecordId={recordId}
      />
    </TreeRow>
  )
}

interface KbArticlesProps {
  kbId: string
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
  kbRecordId: string
}

type ArticleListItem = NonNullable<ReturnType<typeof api.kb.getArticles.useQuery>['data']>[number]

function KbArticles({ kbId, agent, mutations, depth, kbRecordId }: KbArticlesProps) {
  const { data: articles, isLoading } = api.kb.getArticles.useQuery(
    { knowledgeBaseId: kbId, includeUnpublished: true },
    { staleTime: 5 * 60 * 1000 }
  )

  const tree = useMemo<ArticleTreeNode<ArticleListItem>[]>(() => {
    if (!articles) return []
    // Archived articles aren't useful as scope targets — keep them out of
    // the tree so the agent picker doesn't surface decommissioned content.
    const visible = articles.filter(
      (a) => !('archivedAt' in a) || (a as { archivedAt?: Date | null }).archivedAt == null
    )
    return buildArticleTree(visible)
  }, [articles])

  if (isLoading && !articles) {
    return (
      <div
        className='text-xs text-muted-foreground py-1'
        style={{ paddingLeft: `${0.5 + depth * 1.5}rem` }}>
        Loading articles…
      </div>
    )
  }
  if (tree.length === 0) {
    return (
      <div
        className='text-xs text-muted-foreground py-1'
        style={{ paddingLeft: `${0.5 + depth * 1.5}rem` }}>
        No articles in this KB.
      </div>
    )
  }

  return (
    <>
      {tree.map((node) => (
        <ArticleTreeRow
          key={node.id}
          node={node}
          agent={agent}
          mutations={mutations}
          depth={depth}
          ancestorRecordIds={[kbRecordId]}
        />
      ))}
    </>
  )
}

interface ArticleTreeRowProps {
  node: ArticleTreeNode<ArticleListItem>
  agent: AgentDetail
  mutations: ScopeMutations
  depth: number
  ancestorRecordIds: string[]
}

function ArticleTreeRow({ node, agent, mutations, depth, ancestorRecordIds }: ArticleTreeRowProps) {
  const recordId = toRecordId('article', node.id)
  const [isOpen, setIsOpen] = useState(false)
  const effectiveMode = deriveEffectiveMode(agent.resourceScopes, recordId, {
    ancestorRecordIds,
  })
  const pin = agent.pinnedRecords.find((p) => p.recordId === recordId)
  const title = node.title || 'Untitled'

  const hasChildren = node.children.length > 0
  const kind = node.articleKind
  const isStructural = kind === 'tab' || kind === 'link'
  const isContainer = kind === 'category' || kind === 'header' || kind === 'tab'

  const icon = renderArticleIcon(kind, isOpen)

  const childAncestors = useMemo(
    () => [recordId, ...ancestorRecordIds],
    [recordId, ancestorRecordIds]
  )

  return (
    <TreeRow
      icon={icon}
      title={<span className={isStructural ? 'text-muted-foreground/80' : undefined}>{title}</span>}
      depth={depth}
      expandable={isContainer && hasChildren}
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((o) => !o)}
      actions={
        isStructural ? null : (
          <AgentScopeActions
            kind={isContainer ? 'container' : 'leaf'}
            effectiveMode={effectiveMode}
            isPinned={!!pin}
            pinReason={pin?.pinReason ?? null}
            onSetMode={(mode) => mutations.setMode(recordId, mode)}
            onTogglePin={() => mutations.setPin(recordId, !pin)}
          />
        )
      }>
      {hasChildren &&
        node.children.map((child) => (
          <ArticleTreeRow
            key={child.id}
            node={child}
            agent={agent}
            mutations={mutations}
            depth={depth + 1}
            ancestorRecordIds={childAncestors}
          />
        ))}
    </TreeRow>
  )
}

function renderArticleIcon(kind: ArticleListItem['articleKind'], isOpen: boolean) {
  switch (kind) {
    case 'category':
      return isOpen ? <FolderOpen className='size-4' /> : <FolderClosed className='size-4' />
    case 'header':
      return <Hash className='size-4' />
    case 'tab':
      return <LayoutPanelTop className='size-4' />
    case 'link':
      return <ExternalLink className='size-4' />
    default:
      return <FileText className='size-4' />
  }
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
