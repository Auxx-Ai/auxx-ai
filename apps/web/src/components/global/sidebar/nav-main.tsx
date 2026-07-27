// components/global/sidebar/nav-main.tsx
'use client'

import {
  SidebarGroup,
  SidebarGroupCollapse,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSubItem,
} from '@auxx/ui/components/sidebar'
import { usePathname } from 'next/navigation'
import type * as React from 'react'
import { useMemo } from 'react'
import type { SidebarProps } from '~/constants/menu'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { CollapsibleSidebarSection } from './collapsible-sidebar-section'
import { SidebarGroupHeader } from './sidebar-group-header'
import { SidebarNavItem } from './sidebar-nav-item'
import { useSidebarStateContext } from './sidebar-state-context'

type Menu = { title: string; route: string; items: SidebarProps[] }
type Props = {
  menu: Menu
  /** Optional per-item action renderers, keyed by item id */
  itemActions?: Record<string, () => React.ReactNode>
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

export function NavMain({ menu, itemActions }: Props) {
  const pathname = usePathname()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const { hasAccess } = useFeatureFlags()
  const { can } = useAccess()
  const isOpen = getGroupOpen('configurations')

  /** Toggle the Configurations group open/closed state */
  function handleToggleOpen() {
    toggleGroup('configurations')
  }

  // Filter items by feature access + Layer-2 capability, then compute URLs —
  // into NEW objects, never mutating the shared `menu.items`
  // (the module-level `SIDEBAR_MENU`, also read by the command palette). Mutating
  // it would permanently prune entries: once an item is filtered out it could
  // never reappear when a realtime permission change re-grants access. Memoized
  // on the gate identities, which change exactly when capabilities/features do.
  const menuItems = useMemo(() => {
    return menu.items
      .filter((item) => !item.featureKey || hasAccess(item.featureKey))
      .filter((item) => !item.permissionKey || can(item.permissionKey))
      .map((item) => {
        const subItems = item.items
          ?.filter((sub) => !sub.featureKey || hasAccess(sub.featureKey))
          .filter((sub) => !sub.permissionKey || can(sub.permissionKey))
          .map((sub) => ({
            ...sub,
            url: item.skipParentSlug
              ? getUrl(menu.route, undefined, sub.slug)
              : getUrl(menu.route, item.slug, sub.slug),
          }))

        if (subItems && subItems.length > 0) {
          // Explicit `url` on the entry wins (navigable group homes like
          // /app/dispatch); else fall back to the first child. preventNavigation
          // still decides whether clicking the row navigates at all.
          return { ...item, items: subItems, url: item.url ?? subItems[0].url }
        }
        return { ...item, items: subItems, url: getUrl(menu.route, item.slug) }
      })
      .filter((item) => !item.items || item.items.length > 0)
  }, [menu, can, hasAccess])

  function isActive(item: SidebarProps) {
    if (item.items?.length) {
      const isActive = item.items.some(
        (subItem) => pathname.startsWith(subItem.url!) || pathname === subItem.url
      )
      // Groups with their own home route (explicit url) are also active on it
      return isActive || (!!item.url && pathname.startsWith(item.url))
    }
    // Match against the base path (without trailing segments like /new)
    // so e.g. /app/kopilot/new matches /app/kopilot/<sessionId> too
    const baseUrl = `${menu.route}/${item.slug?.split('/')[0]}`
    return pathname.startsWith(baseUrl) || pathname === item.url
  }

  return (
    <SidebarGroup className='group'>
      <SidebarGroupHeader
        title='Workspace'
        isEditMode={false}
        onToggleEditMode={() => {}}
        isOpen={isOpen}
        toggleOpen={handleToggleOpen}
        hideEditOption
      />
      <SidebarGroupCollapse open={isOpen}>
        <SidebarMenu>
          {menuItems.map((item) => (
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
                      <SidebarNavItem
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
                  <SidebarNavItem
                    id={item.id}
                    name={item.label}
                    href={item.url!}
                    icon={item.icon}
                    isActive={isActive(item)}
                    editItems={itemActions?.[item.id]?.()}
                  />
                </SidebarMenuItem>
              )}
            </div>
          ))}
        </SidebarMenu>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}
