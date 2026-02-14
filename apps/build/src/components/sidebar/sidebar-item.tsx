// apps/build/src/components/sidebar/sidebar-item.tsx
'use client'

import { SidebarMenuButton } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'

interface SidebarItemProps {
  id: string
  name: string
  href: string
  icon: React.ReactNode
  isActive: boolean
  className?: string
}

/**
 * SidebarItem - reusable sidebar navigation item
 * Links to a specific page with active state highlighting
 */
export function SidebarItem({ id, name, href, icon, isActive, className }: SidebarItemProps) {
  return (
    <SidebarMenuButton asChild isActive={isActive} className={cn('cursor-pointer', className)}>
      <Link href={href}>
        {icon}
        <span>{name}</span>
      </Link>
    </SidebarMenuButton>
  )
}
