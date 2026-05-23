// apps/chat-widget/src/views/kb/kb-section-view.tsx
//
// Browse-all view + section drill-down. Reads the cached KB tree once, then
// renders the children of `parentId` (null = root). Tappable rows push
// kb-section or kb-article frames depending on whether the child has
// children of its own.

import { getIcon } from '@auxx/ui/components/icon-data'
import { ChevronRight, FileText, Folder } from 'lucide-react'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { cn } from '~/lib/cn'
import { useNavStack } from '~/navigation/nav-stack-context'
import type { KbTreeNode, KbTreeResponse } from '~/transport/kb-api'
import { loadKbTree } from './kb-tree-store'

interface KbSectionViewProps {
  channelId: string
  sectionId: string | null
}

export function KbSectionView({ channelId, sectionId }: KbSectionViewProps) {
  const nav = useNavStack()
  const [tree, setTree] = useState<KbTreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    loadKbTree(channelId)
      .then((t) => {
        if (!cancelled) setTree(t)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load articles')
      })
    return () => {
      cancelled = true
    }
  }, [channelId])

  const childrenMap = useMemo(() => buildChildrenMap(tree?.nodes ?? []), [tree])
  const rows = useMemo(() => flattenSection(sectionId, childrenMap), [sectionId, childrenMap])

  if (error) {
    return (
      <div className='flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground'>
        {error}
      </div>
    )
  }
  if (!tree) {
    return (
      <div className='flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground'>
        Loading…
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground'>
        Nothing here yet
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3'>
      {rows.map((row) => {
        if (row.kind === 'header') {
          const HeaderIcon = row.node.emoji ? (getIcon(row.node.emoji)?.icon ?? null) : null
          return (
            <div
              key={row.node.id}
              className='flex items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
              {HeaderIcon ? <HeaderIcon className='size-3.5' aria-hidden='true' /> : null}
              <span>{row.node.title}</span>
            </div>
          )
        }
        const RowIcon = row.node.emoji
          ? (getIcon(row.node.emoji)?.icon ?? (row.hasChildren ? Folder : FileText))
          : row.hasChildren
            ? Folder
            : FileText
        return (
          <button
            key={row.node.id}
            type='button'
            onClick={() => {
              if (row.hasChildren) {
                nav.push({
                  id: row.node.id,
                  label: row.node.title,
                  view: 'kb-section',
                  params: { sectionId: row.node.id },
                })
              } else {
                nav.push({
                  id: row.node.id,
                  label: row.node.title,
                  view: 'kb-article',
                  params: { articleId: row.node.id },
                })
              }
            }}
            className={cn(
              'group flex w-full items-center gap-3 rounded-lg border border-[color:var(--auxx-chat-hairline)] bg-card px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--auxx-chat-surface-loud)]'
            )}>
            <span className='flex size-5 shrink-0 items-center justify-center'>
              <RowIcon className='size-4 text-muted-foreground' aria-hidden='true' />
            </span>
            <span className='min-w-0 flex-1 truncate text-sm text-foreground'>
              {row.node.title}
            </span>
            <ChevronRight
              className='size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5'
              aria-hidden='true'
            />
          </button>
        )
      })}
    </div>
  )
}

type Row =
  | { kind: 'page'; node: KbTreeNode; hasChildren: boolean }
  | { kind: 'header'; node: KbTreeNode }

function buildChildrenMap(nodes: KbTreeNode[]): Map<string | null, KbTreeNode[]> {
  const map = new Map<string | null, KbTreeNode[]>()
  for (const node of nodes) {
    const key = node.parentId ?? null
    const list = map.get(key)
    if (list) list.push(node)
    else map.set(key, [node])
  }
  return map
}

/**
 * Project a section's children into render rows. `tab` items are treated as
 * containers — their children get promoted into the current list — while
 * `header` items render as non-tappable section headers and `page`/everything
 * else renders as a tappable row.
 */
function flattenSection(
  sectionId: string | null,
  childrenMap: Map<string | null, KbTreeNode[]>
): Row[] {
  const direct = childrenMap.get(sectionId) ?? []
  const rows: Row[] = []
  for (const node of direct) {
    if (node.articleKind === 'tab') {
      // Promote the tab's children into this section.
      const grandchildren = childrenMap.get(node.id) ?? []
      for (const gc of grandchildren) {
        rows.push(toRow(gc, childrenMap))
      }
      continue
    }
    if (node.articleKind === 'header') {
      rows.push({ kind: 'header', node })
      continue
    }
    rows.push(toRow(node, childrenMap))
  }
  return rows
}

function toRow(node: KbTreeNode, childrenMap: Map<string | null, KbTreeNode[]>): Row {
  if (node.articleKind === 'header') return { kind: 'header', node }
  return { kind: 'page', node, hasChildren: (childrenMap.get(node.id) ?? []).length > 0 }
}
