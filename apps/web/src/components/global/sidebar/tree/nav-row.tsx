// apps/web/src/components/global/sidebar/tree/nav-row.tsx
'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { SidebarNavItem } from '../sidebar-nav-item'
import { isNavEntryActive, type NavEntry } from './sidebar-access'

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
