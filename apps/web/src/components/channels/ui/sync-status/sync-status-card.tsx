// apps/web/src/components/channels/ui/sync-status/sync-status-card.tsx

'use client'

import { useSidebar } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Channel } from '../../store/channel-store'
import { useSyncDockStore } from '../../store/sync-dock-store'
import {
  DOCK_DURATION,
  DOCK_EASE,
  DOCK_FADE_OUT,
  getCompactStatus,
  ReauthChannelItem,
  SyncChannelItem,
  SyncStatusHeaderText,
  SyncStatusIcon,
} from './sync-status-shared'
import { useSyncDockRules, useSyncStatus } from './use-sync-status'

const FADE_IN_DELAY = 140
const GAP = 16
const WIDTH = 320

const MORPH_TRANSITION = [
  'left',
  'top',
  'width',
  'height',
  'border-radius',
  'border-color',
  'background-color',
  'box-shadow',
]
  .map((prop) => `${prop} ${DOCK_DURATION}ms ${DOCK_EASE}`)
  .join(', ')

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * `rect: null` rests the card bottom-right; `compact` shows the sidebar-row face;
 * `hidden` is the plain fade used when there is no on-screen sidebar slot to fly to.
 */
interface Flight {
  rect: Rect | null
  animate: boolean
  compact: boolean
  hidden: boolean
}

const RESTING: Flight = { rect: null, animate: false, compact: false, hidden: false }

/** Floating channel sync / re-auth card. X morphs it into the sidebar footer. */
export function SyncStatusCard() {
  useSyncDockRules()
  const { visible, syncing, authErrors } = useSyncStatus()
  const phase = useSyncDockStore((state) => state.phase)

  if (!visible || phase === 'docked') return null
  return createPortal(<CardBody syncing={syncing} authErrors={authErrors} />, document.body)
}

function CardBody({ syncing, authErrors }: { syncing: Channel[]; authErrors: Channel[] }) {
  const phase = useSyncDockStore((state) => state.phase)
  const dock = useSyncDockStore((state) => state.dock)
  const settle = useSyncDockStore((state) => state.settle)
  const { isMobile } = useSidebar()
  const cardRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLDivElement>(null)
  // Coming back from the sidebar means the user asked for details, so open expanded.
  const [isExpanded, setIsExpanded] = useState(phase === 'undocking')
  const [flight, setFlight] = useState<Flight>(RESTING)

  const counts = { syncCount: syncing.length, authCount: authErrors.length }
  const compactStatus = getCompactStatus(counts)

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per phase change
  useLayoutEffect(() => {
    if (phase === 'floating') {
      setFlight(RESTING)
      return
    }
    const frames: number[] = []
    const nextFrame = (fn: () => void) => {
      frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(fn))))
    }
    // transitionend is the primary signal; this covers a transition that never starts.
    const fallback = window.setTimeout(settle, DOCK_DURATION + 150)
    const cleanup = () => {
      for (const id of frames) cancelAnimationFrame(id)
      window.clearTimeout(fallback)
    }

    if (phase === 'docking') {
      // Measured a frame late so the sidebar slot, mounted in this same commit, is laid out.
      frames.push(
        requestAnimationFrame(() => {
          const target = dockTargetRect(isMobile)
          if (!target || !cardRef.current) {
            setFlight({ ...RESTING, animate: true, hidden: true })
            return
          }
          setFlight({ ...RESTING, rect: toRect(cardRef.current.getBoundingClientRect()) })
          nextFrame(() => setFlight({ rect: target, animate: true, compact: true, hidden: false }))
        })
      )
      return cleanup
    }

    // undocking: start on top of the sidebar row before the first paint, then fly out.
    const target = dockTargetRect(isMobile)
    if (!target) {
      setFlight({ ...RESTING, hidden: true })
      nextFrame(() => setFlight({ ...RESTING, animate: true }))
      return cleanup
    }
    setFlight({ rect: target, animate: false, compact: true, hidden: false })
    nextFrame(() => {
      const height = fullRef.current?.offsetHeight ?? target.height
      setFlight({ rect: restingRect(height), animate: true, compact: false, hidden: false })
    })
    return cleanup
  }, [phase])

  const inFlight = flight.rect !== null
  const style: CSSProperties = flight.rect
    ? { ...flight.rect }
    : { right: GAP, bottom: GAP, width: WIDTH }
  if (flight.animate) {
    style.transition = flight.hidden
      ? `opacity 200ms ease-out`
      : `${MORPH_TRANSITION}, opacity 200ms ease-out`
  }
  if (flight.hidden) style.opacity = 0

  return (
    <div
      ref={cardRef}
      className={cn(
        'fixed z-[9999] overflow-hidden border',
        flight.compact
          ? 'rounded-md border-transparent bg-sidebar shadow-none'
          : 'rounded-lg bg-background shadow-lg'
      )}
      style={style}
      onTransitionEnd={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.propertyName === 'width' || e.propertyName === 'opacity') settle()
      }}>
      <div
        ref={fullRef}
        className={cn(inFlight && 'absolute top-0 left-0')}
        style={{
          width: inFlight ? WIDTH : undefined,
          opacity: flight.compact ? 0 : 1,
          transition: flight.compact
            ? `opacity ${DOCK_FADE_OUT}ms ease-out`
            : `opacity ${DOCK_FADE_OUT}ms ease-out ${FADE_IN_DELAY}ms`,
        }}>
        <div className='flex items-center justify-between px-3 py-2.5'>
          <div className='flex items-center gap-2'>
            <SyncStatusIcon {...counts} />
            <span className='text-sm font-medium'>
              <SyncStatusHeaderText {...counts} />
            </span>
          </div>
          <div className='flex items-center gap-0.5'>
            <button
              type='button'
              onClick={() => setIsExpanded(!isExpanded)}
              className='p-1 rounded hover:bg-muted'
              aria-label={isExpanded ? 'Collapse' : 'Expand'}>
              {isExpanded ? (
                <ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
              ) : (
                <ChevronUp className='h-3.5 w-3.5 text-muted-foreground' />
              )}
            </button>
            <button
              type='button'
              disabled={phase !== 'floating'}
              onClick={() => {
                // Collapse first so the morph starts from the header, not a tall list.
                setIsExpanded(false)
                dock(authErrors.map((c) => c.id))
              }}
              className='p-1 rounded hover:bg-muted'
              aria-label='Move to sidebar'>
              <X className='h-3.5 w-3.5 text-muted-foreground' />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className='border-t max-h-48 overflow-y-auto'>
            {syncing.map((channel) => (
              <SyncChannelItem key={channel.id} channel={channel} />
            ))}
            {syncing.length > 0 && authErrors.length > 0 && <div className='border-b' />}
            {authErrors.map((channel) => (
              <ReauthChannelItem key={channel.id} channel={channel} />
            ))}
          </div>
        )}
      </div>

      {/* Mirrors SidebarMenuButton + SidebarMenuBadge so the hand-off to the real row is seamless. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 flex h-8 items-center gap-2 p-2 text-sm text-sidebar-foreground [&>svg]:size-4 [&>svg]:shrink-0'
        style={{
          opacity: flight.compact ? 1 : 0,
          transition: flight.compact
            ? `opacity ${DOCK_FADE_OUT}ms ease-out ${FADE_IN_DELAY}ms`
            : `opacity ${DOCK_FADE_OUT}ms ease-out`,
        }}>
        <SyncStatusIcon {...counts} />
        <span className='truncate'>{compactStatus.label}</span>
        <span
          className={cn(
            'absolute top-1.5 right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums',
            counts.authCount > 0 && 'text-amber-600'
          )}>
          {compactStatus.count}
        </span>
      </div>
    </div>
  )
}

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function restingRect(height: number): Rect {
  return {
    left: window.innerWidth - GAP - WIDTH,
    top: window.innerHeight - GAP - height,
    width: WIDTH,
    height,
  }
}

/** The sidebar slot's rect, or null when there is no on-screen slot to morph into. */
function dockTargetRect(isMobile: boolean): Rect | null {
  const el = useSyncDockStore.getState().target
  if (!el || isMobile) return null
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  const r = el.getBoundingClientRect()
  // A collapsed offcanvas sidebar is parked off the left edge.
  if (r.width === 0 || r.right <= 0 || r.left >= window.innerWidth) return null
  // The slot animates its height while the card flies; the footer is bottom-anchored, so
  // only its bottom edge is stable. Aim for the fully grown row.
  const height = el.firstElementChild?.scrollHeight || r.height
  return { left: r.left, top: r.bottom - height, width: r.width, height }
}
