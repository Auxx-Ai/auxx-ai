// apps/web/src/components/calendar/ui/source-toggle-group.tsx

'use client'

import {
  SidebarGroup,
  SidebarGroupCollapse,
  SidebarMenu,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { EyeOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'

/** Fallback color-dot when an item has no resolved color (e.g. a source not yet color-picked). */
const DEFAULT_TOGGLE_COLOR = '#94a3b8'

interface SourceToggleRowProps {
  id: string
  label: string
  color?: string
  visible: boolean
  onToggle: () => void
  /** Leading visual. Defaults to a small color dot; pass a richer node (e.g. a `VisualIcon`
   * avatar/glyph for dispatch workers) to override it. */
  icon?: ReactNode
  /** Extra classes on the row (e.g. a muted tint for a synthetic row). Merged before the
   * hidden-state dim, so hiding still wins. */
  className?: string
}

/**
 * One toggleable sidebar row — color dot + label (dimmed when hidden) + hover-revealed eye
 * toggle. Generalized from dispatch's `WorkerRow` (`dispatch/ui/sidebar/workers-group.tsx`),
 * itself ported from the deleted `ModuleSidebarToggleItem`'s visual treatment. Exported so
 * bespoke groups (e.g. dispatch's `WorkersGroup`, which needs worker avatars) can reuse the
 * row without adopting `SourceToggleGroup`'s generic list rendering.
 */
export function SourceToggleRow({
  id,
  label,
  color,
  visible,
  onToggle,
  icon,
  className,
}: SourceToggleRowProps) {
  return (
    <SidebarMenuItem>
      <SidebarItem
        id={id}
        name={label}
        onClick={onToggle}
        className={cn(className, !visible && 'text-muted-foreground/70')}
        icon={
          icon ?? (
            <span
              className='size-2 shrink-0 rounded-full'
              style={{ backgroundColor: color ?? DEFAULT_TOGGLE_COLOR }}
            />
          )
        }
        end={
          <EyeOff
            className={cn(
              'size-3.5 text-muted-foreground',
              // Visible: eye-off only reveals on hover (click to hide). Hidden: eye-off stays
              // put as the persistent hidden-state indicator (click to show).
              visible ? 'hidden group-hover/menu-item:block' : 'opacity-60'
            )}
          />
        }
      />
    </SidebarMenuItem>
  )
}

interface SourceToggleGroupItem {
  id: string
  label: string
  color?: string
}

interface SourceToggleGroupProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  items: SourceToggleGroupItem[]
  isHidden: (id: string) => boolean
  onToggle: (id: string) => void
  /** Extra dropdown-menu items rendered in the group header's 3-dot menu (e.g. "New worker"). */
  additionalOptions?: ReactNode
}

/**
 * One generic sidebar group of `SourceToggleRow`s — the calendar-source-registry analog of
 * dispatch's `WorkersGroup` (plan §3.4), for groups whose rows need nothing beyond a color
 * dot + label + visibility toggle (sidebar 'kinds'/'accounts' groups on the calendar page).
 */
export function SourceToggleGroup({
  title,
  open,
  onOpenChange,
  items,
  isHidden,
  onToggle,
  additionalOptions,
}: SourceToggleGroupProps) {
  return (
    <SidebarGroup>
      <SidebarGroupHeader
        title={title}
        isOpen={open}
        toggleOpen={() => onOpenChange(!open)}
        isEditMode={false}
        onToggleEditMode={() => {}}
        hideEditOption
        additionalOptions={additionalOptions}
      />
      <SidebarGroupCollapse open={open}>
        <SidebarMenu>
          {items.map((item) => (
            <SourceToggleRow
              key={item.id}
              id={item.id}
              label={item.label}
              color={item.color}
              visible={!isHidden(item.id)}
              onToggle={() => onToggle(item.id)}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}
