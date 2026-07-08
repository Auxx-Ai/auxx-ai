// apps/web/src/components/dashboard/ui/dashboard-tab-strip.tsx
'use client'

// The dashboard's tab strip. Unlike connector-detail-tabs (scroll-spy over one
// page), these are REAL content tabs — each tab is its own widget grid — so the
// active tab is URL state (`?tab=`) and switching swaps the grid. A thin wrapper
// over the shared `<TabStrip>`: edit mode unlocks drag-reorder, inline rename
// (double-click), a simple "Add tab" button, and a hover-× delete (hidden on the
// last tab). Persistence is the draft store (autosave carries it to the server).

import type { LayoutTab } from '@auxx/lib/dashboards/client'
import { TabStrip } from '@auxx/ui/components/tab-strip'
import { Plus, X } from 'lucide-react'

type DashboardTabStripProps = {
  tabs: LayoutTab[]
  activeTabId: string
  isEditMode: boolean
  onSelect: (tabId: string) => void
  onAdd: (title: string) => void
  onRename: (tabId: string, title: string) => void
  onReorder: (orderedIds: string[]) => void
  onRemove: (tabId: string) => void
}

export function DashboardTabStrip({
  tabs,
  activeTabId,
  isEditMode,
  onSelect,
  onAdd,
  onRename,
  onReorder,
  onRemove,
}: DashboardTabStripProps) {
  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      editable={isEditMode}
      onSelect={onSelect}
      onRename={onRename}
      onReorder={(orderedIds) => onReorder(orderedIds)}
      onAdd={onAdd}
      placeholder='Tab'
      renderAddButton={({ onClick, disabled }) => (
        <button
          type='button'
          onClick={onClick}
          disabled={disabled}
          className='flex shrink-0 items-center gap-1 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'>
          <Plus size={14} /> Add tab
        </button>
      )}
      // Never delete the last tab — the dashboard always needs one.
      renderTrailing={
        tabs.length > 1
          ? (tab) => (
              <span
                role='button'
                tabIndex={-1}
                aria-label={`Delete ${tab.title}`}
                className='ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover/tab:opacity-100'
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(tab.id)
                }}>
                <X className='size-3' />
              </span>
            )
          : undefined
      }
    />
  )
}
