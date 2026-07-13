// apps/web/src/components/dispatch/ui/sidebar/tags-group.tsx

'use client'

import {
  SidebarGroup,
  SidebarGroupCollapse,
  SidebarMenu,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { Eye, EyeOff } from 'lucide-react'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'

interface TagsGroupProps {
  /** Distinct `work_order.tags` across the route planner's visible day (map mode only). */
  tags: string[]
  /** `null` = every tag visible (the default, no filter applied). */
  selectedTags: string[] | null
  onToggleTag: (tag: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Sidebar Tags group (v3 sidebar plan §1.2, map mode only, refactored onto the global
 * `SidebarGroupHeader`/`SidebarItem` primitives per
 * plans/dispatch/v3/02-sidebar-primitives-refactor.md Phase 3) — toggle rows over the planner's
 * distinct work-order tags, mirroring the deleted `TagFilterPopover`'s exact selection semantics
 * (shape copied verbatim from `WorkersGroup`/the old `worker-filter-popover.tsx` precedent):
 * toggling a tag writes the store's `selectedTags`, collapsing back to `null` once every tag is
 * selected again.
 */
export function TagsGroup({ tags, selectedTags, onToggleTag, open, onOpenChange }: TagsGroupProps) {
  if (tags.length === 0) return null
  const isChecked = (tag: string) => selectedTags === null || selectedTags.includes(tag)

  return (
    <SidebarGroup>
      <SidebarGroupHeader
        title='Tags'
        isOpen={open}
        toggleOpen={() => onOpenChange(!open)}
        isEditMode={false}
        onToggleEditMode={() => {}}
        hideEditOption
      />
      <SidebarGroupCollapse open={open}>
        <SidebarMenu>
          {tags.map((tag) => {
            const checked = isChecked(tag)
            return (
              <SidebarMenuItem key={tag}>
                <SidebarItem
                  id={tag}
                  name={tag}
                  onClick={() => onToggleTag(tag)}
                  className={cn(!checked && 'text-muted-foreground/70')}
                  end={
                    checked ? (
                      <EyeOff className='hidden size-3.5 text-muted-foreground group-hover/menu-item:block' />
                    ) : (
                      <Eye className='size-3.5 text-muted-foreground opacity-60' />
                    )
                  }
                />
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}
