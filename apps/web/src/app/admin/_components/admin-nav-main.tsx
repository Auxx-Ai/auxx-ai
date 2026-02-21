// apps/web/src/app/admin/_components/admin-nav-main.tsx
'use client'

import { SidebarGroup, SidebarMenu, SidebarMenuItem } from '@auxx/ui/components/sidebar'
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Settings,
  Users,
  Workflow,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'

/**
 * Navigation item interface
 */
interface NavItem {
  id: string
  label: string
  slug: string
  icon: LucideIcon
}

/**
 * Admin navigation items
 */
const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    slug: '',
    icon: LayoutDashboard,
  },
  {
    id: 'organizations',
    label: 'Organizations',
    slug: 'organizations',
    icon: Building2,
  },
  {
    id: 'users',
    label: 'Users',
    slug: 'users',
    icon: Users,
  },
  {
    id: 'apps',
    label: 'Apps',
    slug: 'apps',
    icon: Package,
  },
  {
    id: 'workflows',
    label: 'Workflow Templates',
    slug: 'workflows',
    icon: Workflow,
  },
  {
    id: 'plans',
    label: 'Plans',
    slug: 'plans',
    icon: CreditCard,
  },
  {
    id: 'config',
    label: 'Config',
    slug: 'config',
    icon: Settings,
  },
]

/**
 * AdminNavMain component - renders navigation items for admin area
 */
export function AdminNavMain() {
  const pathname = usePathname()

  /**
   * Check if a nav item is active
   */
  function isActive(item: NavItem): boolean {
    const url = `/admin/${item.slug}`

    if (item.slug === '') {
      // Dashboard - only active on exact match
      return pathname === '/admin' || pathname === '/admin/'
    }

    // Other items - active if path starts with the URL
    return pathname.startsWith(url) || pathname === url
  }

  return (
    <SidebarGroup>
      <SidebarMenu>
        {ADMIN_NAV_ITEMS.map((item) => {
          const url = `/admin/${item.slug}`
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarItem
                id={item.id}
                name={item.label}
                href={url}
                icon={<item.icon />}
                isActive={isActive(item)}
              />
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
