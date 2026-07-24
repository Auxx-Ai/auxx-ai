// packages/ui/src/components/side-panel.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'

/** Props for the non-modal, left-anchored side panel. */
export interface SidePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  width?: number
  offset?: number | string
  resizable?: boolean
  minWidth?: number
  maxWidth?: number
  onWidthChange?: (width: number) => void
  title: string
  className?: string
  children: React.ReactNode
}

/** A full-height overlay panel that leaves the page behind it interactive. */
export function SidePanel({
  open,
  onOpenChange,
  width = 420,
  offset = 0,
  resizable = false,
  minWidth = 320,
  maxWidth = 640,
  onWidthChange,
  title,
  className,
  children,
}: SidePanelProps) {
  const [isResizing, setIsResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange, open])

  useEffect(() => {
    if (!isResizing) return
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      onWidthChange?.(
        Math.min(maxWidth, Math.max(minWidth, drag.startWidth + event.clientX - drag.startX))
      )
    }
    const onPointerUp = () => {
      dragRef.current = null
      setIsResizing(false)
    }
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
    }
  }, [isResizing, maxWidth, minWidth, onWidthChange])

  return (
    <aside
      aria-hidden={!open}
      aria-label={title}
      aria-modal={false}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'fixed inset-y-0 z-30 flex w-(--side-panel-width) flex-col',
        'left-(--side-panel-offset) max-w-[calc(100vw_-_var(--side-panel-offset))]',
        'max-md:left-0 max-md:w-screen max-md:max-w-none max-md:pt-safe max-md:pb-safe',
        'border-r-[0.5px] border-divider-regular bg-background/70 shadow-right backdrop-blur-sm',
        'transition-[transform,opacity,left,width] duration-200 ease-out',
        'data-[state=closed]:pointer-events-none data-[state=closed]:-translate-x-2 data-[state=closed]:opacity-0',
        className
      )}
      style={
        {
          '--side-panel-width': `${width}px`,
          '--side-panel-offset': typeof offset === 'number' ? `${offset}px` : offset,
        } as React.CSSProperties
      }>
      <h2 className='sr-only'>{title}</h2>
      {children}
      {resizable ? (
        <button
          type='button'
          aria-label='Resize panel'
          className='group absolute inset-y-0 right-0 hidden w-3 translate-x-1/2 cursor-col-resize touch-none items-center justify-center md:flex'
          onPointerDown={(event) => {
            event.preventDefault()
            dragRef.current = { startX: event.clientX, startWidth: width }
            setIsResizing(true)
          }}>
          <span
            className={cn(
              'h-12 w-1.5 rounded-full bg-primary-300 transition-colors',
              isResizing && 'bg-primary-500'
            )}
          />
        </button>
      ) : null}
    </aside>
  )
}
