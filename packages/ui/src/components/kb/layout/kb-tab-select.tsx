// packages/ui/src/components/kb/layout/kb-tab-select.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useRouter } from 'next/navigation'
import type { KBSidebarArticle } from './kb-sidebar-tree'

interface KBTabSelectProps<T extends KBSidebarArticle> {
  tabs: T[]
  activeTabId: string | null
  /** `tabId → href` map for the first navigable child of each tab. */
  tabHrefs: Record<string, string>
  /** Called after navigation kicks off — used to close the mobile drawer. */
  onNavigate?: () => void
}

/**
 * Tab switcher for the mobile sidebar drawer. Mirrors the desktop `KBTopTabs`
 * strip as a dropdown so all tabs are reachable without horizontal scrolling.
 * Hidden when fewer than two tabs exist.
 */
export function KBTabSelect<T extends KBSidebarArticle>({
  tabs,
  activeTabId,
  tabHrefs,
  onNavigate,
}: KBTabSelectProps<T>) {
  const router = useRouter()
  if (tabs.length < 2) return null

  const handleChange = (tabId: string) => {
    const href = tabHrefs[tabId]
    if (!href) return
    router.push(href)
    onNavigate?.()
  }

  return (
    <Select value={activeTabId ?? undefined} onValueChange={handleChange}>
      <SelectTrigger className='w-full'>
        <SelectValue placeholder='Select a tab' />
      </SelectTrigger>
      <SelectContent>
        {tabs.map((tab) => (
          <SelectItem key={tab.id} value={tab.id}>
            {tab.emoji ? <span aria-hidden>{tab.emoji}</span> : null}
            <span>{tab.title}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
