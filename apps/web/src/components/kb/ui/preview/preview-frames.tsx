// apps/web/src/components/kb/ui/preview/preview-frames.tsx
'use client'

import type { ReactNode } from 'react'

interface MobilePreviewFrameProps {
  children: ReactNode
}

export function MobilePreviewFrame({ children }: MobilePreviewFrameProps) {
  return (
    <div
      data-slot='mobile-frame'
      className='relative aspect-[390/844] w-[390px] rounded-[3rem] border border-foreground/10 bg-white p-[10px] shadow-[0_8px_32px_rgba(15,23,42,0.08)]'>
      <div
        data-slot='mobile-screen'
        className='relative flex h-full w-full flex-col overflow-auto rounded-[2.4rem] bg-background'>
        {children}
        <DynamicIsland />
      </div>
    </div>
  )
}

function DynamicIsland() {
  return (
    <div
      data-slot='dynamic-island'
      className='pointer-events-none absolute top-2 left-1/2 z-50 flex h-[34px] w-[120px] -translate-x-1/2 items-center justify-center gap-2 rounded-full bg-zinc-900'>
      <span className='h-[5px] w-9 rounded-full bg-zinc-700' aria-hidden />
      <span
        className='relative h-[10px] w-[10px] rounded-full bg-zinc-800 ring-[1.5px] ring-zinc-700'
        aria-hidden>
        <span className='absolute inset-[2.5px] rounded-full bg-zinc-950' />
      </span>
    </div>
  )
}

interface DesktopPreviewFrameProps {
  url: string
  children: ReactNode
}

export function DesktopPreviewFrame({ url, children }: DesktopPreviewFrameProps) {
  return (
    <div
      data-slot='desktop-frame'
      className='w-full max-w-7xl overflow-hidden rounded-lg border border-foreground/10 bg-background shadow-sm'>
      <div
        data-slot='desktop-chrome'
        className='flex items-center gap-3 border-b border-foreground/10 bg-muted/60 px-3 py-2'>
        <div className='flex items-center gap-1.5'>
          <span className='size-3 rounded-full bg-[#ff5f57]' aria-hidden />
          <span className='size-3 rounded-full bg-[#febc2e]' aria-hidden />
          <span className='size-3 rounded-full bg-[#28c841]' aria-hidden />
        </div>
        <div className='mx-auto w-full max-w-md truncate rounded-md border border-foreground/10 bg-background px-3 py-1 text-center font-mono text-xs text-foreground/70'>
          {url}
        </div>
        <div className='w-12' aria-hidden />
      </div>
      <div data-slot='desktop-content' className='relative'>
        {children}
      </div>
    </div>
  )
}
