// components/global/sidebar/nav-main.tsx
'use client'

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSubItem,
} from '@auxx/ui/components/sidebar'
import { usePathname } from 'next/navigation'
import type * as React from 'react'
import type { SidebarProps } from '~/constants/menu'
import { CollapsibleSidebarSection } from './collapsible-sidebar-section'
import { SidebarGroupHeader } from './sidebar-group-header'
import { SidebarItem } from './sidebar-item'
import { useSidebarStateContext } from './sidebar-state-context'

type Menu = { title: string; route: string; items: SidebarProps[] }
type Props = {
  menu: Menu
  /** Optional per-item action renderers, keyed by item id */
  itemActions?: Record<string, () => React.ReactNode>
}
export function NavMain({ menu, itemActions }: Props) {
  const pathname = usePathname()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isOpen = getGroupOpen('configurations')

  /** Toggle the Configurations group open/closed state */
  function handleToggleOpen() {
    toggleGroup('configurations')
  }

  function getUrl(url: string, parentSlug?: string, childSlug?: string) {
    let fullUrl = `${url}`
    if (parentSlug) {
      fullUrl += `/${parentSlug}`
    }
    if (childSlug) {
      fullUrl += `/${childSlug}`
    }
    return fullUrl
  }

  // Process menu.items URLs
  menu.items = menu.items.map((item) => {
    if (item.items && item.items.length > 0) {
      item.items = item.items.map((subItem) => {
        if (item.skipParentSlug) {
          // Parent has skipParentSlug flag - skip parent slug for all children
          subItem.url = getUrl(menu.route, undefined, subItem.slug)
        } else {
          subItem.url = getUrl(menu.route, item.slug, subItem.slug)
        }
        return subItem
      })

      // Handle parent URL - keep URL for consistency, preventNavigation will handle the behavior
      item.url = item.items[0].url // Always set URL to first child for consistency
    } else {
      item.url = getUrl(menu.route, item.slug)
    }
    return item
  })

  function isActive(item: SidebarProps) {
    if (item.items?.length) {
      const isActive = item.items.some(
        (subItem) => pathname.startsWith(subItem.url!) || pathname === subItem.url
      )
      return isActive
    }
    return pathname.startsWith(item.url!) || pathname === item.url
  }

  return (
    <SidebarGroup className='group'>
      <SidebarGroupHeader
        title='Configurations'
        isEditMode={false}
        onToggleEditMode={() => {}}
        isOpen={isOpen}
        toggleOpen={handleToggleOpen}
        hideEditOption
      />
      {isOpen && (
        <SidebarMenu className='gap-0'>
          {menu.items.map((item) => (
            <div key={item.id}>
              {item.items?.length ? (
                <CollapsibleSidebarSection
                  title={item.label}
                  icon={item.icon}
                  href={item.url}
                  isEditMode={false}
                  defaultOpen={isActive(item)}
                  alwaysShowChildren={false}
                  isActive={isActive(item)}
                  preventNavigation={item.preventNavigation}
                  sectionId={item.id}>
                  {item.items.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.id}>
                      <SidebarItem
                        id={subItem.id}
                        name={subItem.label}
                        href={subItem.url!}
                        icon={subItem.icon}
                        isSubmenu
                        isActive={isActive(subItem)}
                      />
                    </SidebarMenuSubItem>
                  ))}
                </CollapsibleSidebarSection>
              ) : (
                <SidebarMenuItem>
                  <SidebarItem
                    id={item.id}
                    name={item.label}
                    href={item.url!}
                    icon={item.icon}
                    isActive={isActive(item)}
                    className='ps-[30px]'
                    editItems={itemActions?.[item.id]?.()}
                  />
                </SidebarMenuItem>
              )}
            </div>
          ))}
        </SidebarMenu>
      )}
    </SidebarGroup>
  )
}
