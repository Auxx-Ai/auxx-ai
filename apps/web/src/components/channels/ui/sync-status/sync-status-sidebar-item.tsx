// apps/web/src/components/channels/ui/sync-status/sync-status-sidebar-item.tsx

'use client'

import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { useSyncDockStore } from '../../store/sync-dock-store'
import {
  DOCK_DURATION,
  DOCK_EASE,
  DOCK_FADE_OUT,
  getCompactStatus,
  SyncStatusIcon,
} from './sync-status-shared'
import { useSyncStatus } from './use-sync-status'

/** Negates `SidebarMenu`'s `gap-0.5` while collapsed, so a zero-height row adds no space. */
const MENU_GAP = 2

/** The docked form of the sync status card; clicking it morphs the card back out. */
export function SyncStatusSidebarItem() {
  const { visible, syncing, authErrors } = useSyncStatus()
  const phase = useSyncDockStore((state) => state.phase)
  const undock = useSyncDockStore((state) => state.undock)
  const setDockTarget = useSyncDockStore((state) => state.setDockTarget)
  const { isMobile, setOpenMobile } = useSidebar()

  const show = visible && (phase === 'docking' || phase === 'docked')
  const [rendered, setRendered] = useState(show)
  const [open, setOpen] = useState(show)
  // Once grown, the row drops the grid/clip/transition styles and is a plain sidebar row.
  const [settled, setSettled] = useState(show)

  const counts = { syncCount: syncing.length, authCount: authErrors.length }
  // Keeps the row's text while it collapses after the lists have emptied.
  const lastCounts = useRef(counts)
  if (visible) lastCounts.current = counts

  useLayoutEffect(() => {
    const frames: number[] = []
    let fallback: number | undefined
    if (show) {
      setRendered(true)
      setSettled(false)
      // Mount collapsed for a frame so the grow has a start value to transition from.
      frames.push(
        requestAnimationFrame(() => frames.push(requestAnimationFrame(() => setOpen(true))))
      )
      fallback = window.setTimeout(() => setSettled(true), DOCK_DURATION + 150)
    } else {
      setSettled(false)
      setOpen(false)
      fallback = window.setTimeout(() => setRendered(false), DOCK_DURATION + 150)
    }
    return () => {
      for (const id of frames) cancelAnimationFrame(id)
      window.clearTimeout(fallback)
    }
  }, [show])

  if (!rendered) return null

  const { label, count } = getCompactStatus(lastCounts.current)
  const style: CSSProperties = settled
    ? {}
    : {
        gridTemplateRows: open ? '1fr' : '0fr',
        marginTop: open ? 0 : -MENU_GAP,
        // Fade only on the way out; on the way in the card hands off to a fully opaque row.
        transition: `grid-template-rows ${DOCK_DURATION}ms ${DOCK_EASE}, margin-top ${DOCK_DURATION}ms ${DOCK_EASE}${show ? '' : `, opacity ${DOCK_FADE_OUT}ms ease-out`}`,
      }

  return (
    <SidebarMenuItem
      ref={setDockTarget}
      // Mid-morph the floating card is drawn over this slot, so the slot only reserves space.
      className={cn(!settled && 'grid', phase !== 'docked' && 'pointer-events-none opacity-0')}
      style={style}
      onTransitionEnd={(e) => {
        if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return
        if (open) setSettled(true)
        else setRendered(false)
      }}>
      <div className={cn('relative min-h-0', !settled && 'overflow-hidden')}>
        <SidebarMenuButton
          tooltip='Show sync status'
          onClick={() => {
            if (isMobile) setOpenMobile(false)
            undock()
          }}>
          <SyncStatusIcon {...lastCounts.current} />
          <span>{label}</span>
        </SidebarMenuButton>
        <SidebarMenuBadge className={cn(lastCounts.current.authCount > 0 && 'text-amber-600')}>
          {count}
        </SidebarMenuBadge>
      </div>
    </SidebarMenuItem>
  )
}
