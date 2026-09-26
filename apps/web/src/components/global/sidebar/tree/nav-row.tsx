// apps/web/src/components/global/sidebar/tree/nav-row.tsx
'use client'

import { SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
import { usePathname } from 'next/navigation'
import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { CollapsibleSidebarSection } from '../collapsible-sidebar-section'
import { SidebarNavItem } from '../sidebar-nav-item'
import { SidebarRowMenuContext } from '../sidebar-row-menu-context'
import { isNavEntryActive, isPathActive, type NavEntry } from './sidebar-access'

/** A NAV leaf row: the `SIDEBAR_MENU` entry with its lucide icon. */
export function NavLeafRow({
  entry,
  isSubmenu,
  editItems,
}: {
  entry: NavEntry
  isSubmenu: boolean
  editItems?: ReactNode
}) {
  const pathname = usePathname()
  return (
    <SidebarNavItem
      id={entry.id}
      name={entry.label}
      href={entry.url}
      icon={entry.icon}
      isActive={isNavEntryActive(pathname, entry)}
      isSubmenu={isSubmenu}
      editItems={editItems}
    />
  )
}

/** A NAV entry with sub-items (Resources, Examples); moves as one unit, children aren't placeable. */
export function NavCollapsibleRow({
  entry,
  actions,
  rootRef,
  rootProps,
  rootAddon,
}: {
  entry: NavEntry
  actions?: ReactNode
  rootRef?: Ref<HTMLLIElement>
  rootProps?: HTMLAttributes<HTMLLIElement>
  rootAddon?: ReactNode
}) {
  const pathname = usePathname()
  const active = isNavEntryActive(pathname, entry)
  return (
    <CollapsibleSidebarSection
      title={entry.label}
      icon={entry.icon}
      href={entry.url}
      isEditMode={false}
      defaultOpen={active}
      isActive={active}
      preventNavigation={entry.preventNavigation}
      sectionId={entry.id}
      actions={actions}
      rootRef={rootRef}
      rootProps={rootProps}
      rootAddon={rootAddon}>
      {/* Sub-items carry no layout menu of their own. */}
      <SidebarRowMenuContext.Provider value={null}>
        {entry.items?.map((sub) => (
          <SidebarMenuSubItem key={sub.id}>
            <SidebarNavItem
              id={sub.id}
              name={sub.label}
              href={sub.url}
              icon={sub.icon}
              isSubmenu
              isActive={isPathActive(pathname, sub.url)}
            />
          </SidebarMenuSubItem>
        ))}
      </SidebarRowMenuContext.Provider>
    </CollapsibleSidebarSection>
  )
}
