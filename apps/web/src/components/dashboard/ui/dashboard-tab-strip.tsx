// apps/web/src/components/dashboard/ui/dashboard-tab-strip.tsx
'use client'

// The dashboard's tab strip. Unlike connector-detail-tabs (scroll-spy over one
// page), these are REAL content tabs — each tab is its own widget grid — so the
// active tab is URL state (`?tab=`) and switching swaps the grid. Edit mode adds
// an inline-rename affordance, a delete (blocked on the last tab), and an add
// button. Drag-to-reorder is deferred (store has `reorderTabs`; wire a dnd-kit
// sortable here in a follow-up).

import type { LayoutTab } from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

type DashboardTabStripProps = {
  tabs: LayoutTab[]
  activeTabId: string
  isEditMode: boolean
  onSelect: (tabId: string) => void
  onAddTab: () => void
  onRenameTab: (tabId: string, title: string) => void
  onRemoveTab: (tabId: string) => void
}

export function DashboardTabStrip({
  tabs,
  activeTabId,
  isEditMode,
  onSelect,
  onAddTab,
  onRenameTab,
  onRemoveTab,
}: DashboardTabStripProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)

  return (
    <div className='flex items-center gap-1 overflow-x-auto border-b px-1 no-scrollbar'>
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        if (renamingId === tab.id) {
          return (
            <input
              key={tab.id}
              // biome-ignore lint/a11y/noAutofocus: inline rename should grab focus immediately
              autoFocus
              defaultValue={tab.title}
              className='h-8 w-28 rounded border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-primary'
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v) onRenameTab(tab.id, v)
                setRenamingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenamingId(null)
              }}
            />
          )
        }
        return (
          <button
            key={tab.id}
            type='button'
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => isEditMode && setRenamingId(tab.id)}
            className={cn(
              'group/tab flex h-8 shrink-0 items-center gap-1 border-b-2 px-3 text-sm transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}>
            <span className='truncate'>{tab.title}</span>
            {isEditMode && tabs.length > 1 && (
              // biome-ignore lint/a11y/useKeyWithClickEvents: hover affordance; keyboard delete is via the tab menu (follow-up)
              <span
                role='button'
                tabIndex={-1}
                aria-label={`Delete ${tab.title}`}
                className='ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover/tab:opacity-100'
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveTab(tab.id)
                }}>
                <X className='size-3' />
              </span>
            )}
          </button>
        )
      })}
      {isEditMode && (
        <Button variant='ghost' size='icon-sm' aria-label='Add tab' onClick={onAddTab}>
          <Plus />
        </Button>
      )}
    </div>
  )
}
