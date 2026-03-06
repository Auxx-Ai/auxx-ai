// apps/web/src/app/admin/_components/admin-nav-main.tsx
'use client'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import {
  Activity,
  Building2,
  Code,
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
 * Navigation group interface
 */
interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * Admin navigation groups
 */
const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        slug: '',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: 'People',
    items: [
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
    ],
  },
  {
    label: 'Platform',
    items: [
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
        id: 'developer-accounts',
        label: 'Developer Accounts',
        slug: 'developer-accounts',
        icon: Code,
      },
    ],
  },
  {
    label: 'System',
    items: [
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
      {
        id: 'health',
        label: 'Health',
        slug: 'health',
        icon: Activity,
      },
    ],
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
      return pathname === '/admin' || pathname === '/admin/'
    }

    return pathname.startsWith(url) || pathname === url
  }

  return (
    <div className='space-y-4'>
      {ADMIN_NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map((item) => {
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
      ))}
    </div>
  )
}
