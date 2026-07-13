// apps/web/src/components/dispatch/ui/sidebar/tags-group.tsx

'use client'

import { ModuleSidebarToggleItem } from '@auxx/ui/components/module-sidebar'
import { SidebarGroup, SidebarGroupCollapse, SidebarMenu } from '@auxx/ui/components/sidebar'
import { SidebarGroupHeader } from './sidebar-group-header'

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
 * Sidebar Tags group (v3 sidebar plan §1.2, map mode only) — toggle rows over the planner's
 * distinct work-order tags, mirroring the deleted `TagFilterPopover`'s exact selection
 * semantics (shape copied verbatim from `WorkersGroup`/the old `worker-filter-popover.tsx`
 * precedent): toggling a tag writes the store's `selectedTags`, collapsing back to `null` once
 * every tag is selected again.
 */
export function TagsGroup({ tags, selectedTags, onToggleTag, open, onOpenChange }: TagsGroupProps) {
  if (tags.length === 0) return null
  const isChecked = (tag: string) => selectedTags === null || selectedTags.includes(tag)

  return (
    <SidebarGroup>
      <SidebarGroupHeader title='Tags' open={open} onOpenChange={onOpenChange} />
      <SidebarGroupCollapse open={open}>
        <SidebarMenu>
          {tags.map((tag) => (
            <ModuleSidebarToggleItem
              key={tag}
              label={tag}
              checked={isChecked(tag)}
              onCheckedChange={() => onToggleTag(tag)}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}
