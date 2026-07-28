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
import { useApprovalsCount } from './hooks/use-approvals-count'
import { useNotificationPanelStore } from './notification-panel-store'

/** How long the badge stays flashed after a bump. */
const PULSE_MS = 500

export function NotificationTrigger() {
  const toggle = useNotificationPanelStore((state) => state.toggle)
  const open = useNotificationPanelStore((state) => state.open)
  const bellPulse = useNotificationPanelStore((state) => state.bellPulse)
  const { isMobile, setOpenMobile } = useSidebar()
  const unread = api.notification.getUnreadCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
  })
  // Approvals are state-derived (`ApprovalRequest`), not row-derived — nothing
  // pending mints a notification, so the two sources never double-count the same
  // item (plans/today/05-bell-and-feed-dedupe.md §1).
  const approvals = useApprovalsCount()
  const total = (unread.data?.count ?? 0) + approvals.count
  // A badge that failed to load and a badge that is zero look identical. Say so.
  const isError = !!unread.error || approvals.isError
  const previousTotal = useRef(total)
  const [badgePulse, setBadgePulse] = useState(false)

  useEffect(() => {
    if (total > previousTotal.current) {
      setBadgePulse(true)
      const timer = setTimeout(() => setBadgePulse(false), PULSE_MS)
      previousTotal.current = total
      return () => clearTimeout(timer)
    }
    previousTotal.current = total
  }, [total])

  // Explicit pulses (an approval reminder re-pinging a request that is already
  // counted) never move the total, so they get their own channel.
  useEffect(() => {
    if (!bellPulse) return
    setBadgePulse(true)
    const timer = setTimeout(() => setBadgePulse(false), PULSE_MS)
    return () => clearTimeout(timer)
  }, [bellPulse])

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
      {isError ? (
        <SidebarMenuBadge
          className='text-destructive'
          title="Couldn't load notification counts — open the panel to retry">
          !
        </SidebarMenuBadge>
      ) : total > 0 ? (
        <SidebarMenuBadge
          className={cn(
            'transition-colors',
            badgePulse && 'animate-in zoom-in-50 text-blue-500 duration-300'
          )}>
          {total > 99 ? '99+' : total}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  )
}
