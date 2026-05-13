// apps/homepage/src/app/_components/sections/hero-video-modal.tsx
'use client'

import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface HeroVideoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  src: string
}

export function HeroVideoModal({ open, onOpenChange, src }: HeroVideoModalProps) {
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open, onOpenChange])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      role='dialog'
      aria-modal='true'
      aria-label='Auxx.ai product video'
      className='fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8'>
      <button
        type='button'
        aria-label='Close video'
        onClick={() => onOpenChange(false)}
        className='absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm'
      />

      <div className='relative z-10 w-full max-w-5xl'>
        <button
          type='button'
          aria-label='Close video'
          onClick={() => onOpenChange(false)}
          className='absolute -top-10 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:-right-10 sm:top-0'>
          <X className='h-4 w-4' />
        </button>

        <div className='aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl'>
          <video src={src} className='size-full' controls autoPlay playsInline preload='auto' />
        </div>
      </div>
    </div>,
    document.body
  )
}
