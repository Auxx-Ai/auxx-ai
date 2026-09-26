// apps/web/src/components/global/sidebar/tree/sidebar-tree-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { Button } from '@auxx/ui/components/button'
import { DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { SidebarMenuItem, SidebarMenuSkeleton } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { FavoriteItemDispatch } from '~/components/favorites/ui/favorite-item'
import { FavoriteItemSkeleton } from '~/components/favorites/ui/favorite-item-skeleton'
import { SidebarRowMenuContext } from '../sidebar-row-menu-context'
import { EntityRow } from './entity-row'
import { LayoutMenuItems } from './layout-menu-items'
import { NavCollapsibleRow, NavLeafRow } from './nav-row'
import type { RenderItem } from './sidebar-access'
import { useSidebarNodes } from './sidebar-nodes-provider'
import { useSidebarTree } from './sidebar-tree-context'
import { useSidebarSortable } from './use-sidebar-sortable'

/** Label for the drag overlay. */
function itemLabel(item: RenderItem): string {
  if (item.nav) return item.nav.label
  if (item.entity) return item.entity.plural
  return 'Favorite'
}

/** Inline "show again" button on a row hidden by its own flag (visible while Show hidden is on). */
export function UnhideButton({ nodeKey }: { nodeKey: string }) {
  const { mutations } = useSidebarTree()
  return (
    <Button
      variant='ghost'
      size='icon'
      aria-label='Show in sidebar'
      className='absolute right-7 top-0.5 z-10 size-6 rounded-md'
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        void mutations.setHidden(nodeKey, false)
      }}>
      <Eye />
    </Button>
  )
}

/** One ITEM row: whole-row sortable around whichever renderer its target needs. */
export function SidebarTreeItem({ item }: { item: RenderItem }) {
  const { navActions } = useSidebarTree()
  const sortable = useSidebarSortable({
    key: item.key,
    kind: 'ITEM',
    parentKey: item.parentKey,
    label: itemLabel(item),
    inFolder: item.inFolder,
  })

  const layoutItems = <LayoutMenuItems node={item} />
  const rootProps = {
    ...sortable.attributes,
    ...sortable.listeners,
    style: sortable.style,
    className: cn('list-none', sortable.isDragging && 'opacity-40', item.ownHidden && 'opacity-50'),
  }

  const own = item.nav ? navActions[item.nav.id]?.() : undefined
  if (item.nav?.items?.length) {
    const actions: ReactNode = (
      <>
        {own}
        {own && <DropdownMenuSeparator />}
        {layoutItems}
      </>
    )
    return (
      <NavCollapsibleRow
        entry={item.nav}
        actions={actions}
        rootRef={sortable.setNodeRef}
        rootProps={rootProps}
        rootAddon={item.ownHidden && <UnhideButton nodeKey={item.key} />}
      />
    )
  }

  let row: ReactNode
  if (item.nav) row = <NavLeafRow entry={item.nav} isSubmenu={item.inFolder} editItems={own} />
  else if (item.entity) row = <EntityRow def={item.entity} isSubmenu={item.inFolder} />
  else if (item.pending) row = <SidebarMenuSkeleton showIcon className='h-7' />
  else row = <FavoriteRow nodeId={item.nodeId} />

  return (
    <SidebarMenuItem ref={sortable.setNodeRef} {...rootProps}>
      {item.ownHidden && <UnhideButton nodeKey={item.key} />}
      <SidebarRowMenuContext.Provider value={layoutItems}>{row}</SidebarRowMenuContext.Provider>
    </SidebarMenuItem>
  )
}

function FavoriteRow({ nodeId }: { nodeId: string | null }) {
  const node = useSidebarNodes((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId) : undefined))
  if (!node) return <FavoriteItemSkeleton />
  return <FavoriteItemDispatch favorite={node as FavoriteEntity} />
}
