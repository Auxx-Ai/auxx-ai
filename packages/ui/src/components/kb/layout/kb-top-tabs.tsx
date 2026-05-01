// packages/ui/src/components/kb/layout/kb-top-tabs.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import type { KBSidebarArticle } from './kb-sidebar-tree'

interface KBTopTabsProps<T extends KBSidebarArticle> {
  /** Articles where `articleKind === 'tab'`, sorted by `order`. */
  tabs: T[]
  activeTabId: string | null
  /** `tabId → href` map for the first navigable child of each tab. */
  tabHrefs: Record<string, string>
}

/**
 * Horizontal tab strip that anchors the public-site KB layout. Hides itself
 * when there are fewer than two tabs — single-tab KBs read like a flat sidebar.
 */
export function KBTopTabs<T extends KBSidebarArticle>({
  tabs,
  activeTabId,
  tabHrefs,
}: KBTopTabsProps<T>) {
  if (tabs.length < 2) return null
  return (
    <div
      className={cn(
        'sticky top-[var(--kb-header-h,3.5rem)] z-20 hidden border-b border-[var(--kb-border)] @kb-md:block',
        'bg-[var(--kb-surface-bg)] backdrop-blur',
        'data-[kb-theme=bold]:border-b-2 data-[kb-theme=bold]:border-[var(--kb-fg)]'
      )}>
      <div className='mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-4'>
        {tabs.map((tab) => {
          const href = tabHrefs[tab.id] ?? '#'
          const active = activeTabId === tab.id
          return (
            <Link
              key={tab.id}
              href={href}
              prefetch={false}
              data-active={active}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm text-[var(--kb-fg)]/85 no-underline transition-colors',
                'hover:text-[var(--kb-primary)]',
                'data-[active=true]:border-[var(--kb-primary)] data-[active=true]:font-medium data-[active=true]:text-[var(--kb-primary)]'
              )}>
              {tab.emoji ? <span aria-hidden>{tab.emoji}</span> : null}
              <span>{tab.title}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
