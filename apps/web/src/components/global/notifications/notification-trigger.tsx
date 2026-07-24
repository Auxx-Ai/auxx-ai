// apps/web/src/components/global/notifications/notification-trigger.tsx
'use client'

import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { useNotificationPanelStore } from './notification-panel-store'

export function NotificationTrigger() {
  const toggle = useNotificationPanelStore((state) => state.toggle)
  const open = useNotificationPanelStore((state) => state.open)
  const { isMobile, setOpenMobile } = useSidebar()
  const { data } = api.notification.getUnreadCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
  })
  const unreadCount = data?.count ?? 0
  const previousUnreadCount = useRef(unreadCount)
  const [badgePulse, setBadgePulse] = useState(false)

  useEffect(() => {
    if (unreadCount > previousUnreadCount.current) {
      setBadgePulse(true)
      const timer = setTimeout(() => setBadgePulse(false), 500)
      previousUnreadCount.current = unreadCount
      return () => clearTimeout(timer)
    }
    previousUnreadCount.current = unreadCount
  }, [unreadCount])

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={open}
        tooltip='Notifications'
        aria-expanded={open}
        onClick={() => {
          if (isMobile) setOpenMobile(false)
          toggle()
        }}>
        <Bell />
        <span>Notifications</span>
      </SidebarMenuButton>
      {unreadCount > 0 ? (
        <SidebarMenuBadge
          className={cn(
            'transition-colors',
            badgePulse && 'animate-in zoom-in-50 text-blue-500 duration-300'
          )}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  )
}
