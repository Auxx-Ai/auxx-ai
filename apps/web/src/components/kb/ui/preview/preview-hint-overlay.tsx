// apps/web/src/components/kb/ui/preview/preview-hint-overlay.tsx
'use client'

import { ArrowRight } from 'lucide-react'
import { useKBPreviewHint } from './preview-hint-context'

/**
 * In-frame badge shown on first hovers of the preview, nudging the user toward
 * the Articles tab. Pointer-events-none so it never blocks the preview.
 */
export function PreviewHintOverlay() {
  const { isVisible } = useKBPreviewHint()
  if (!isVisible) return null

  return (
    <div
      data-slot='kb-preview-hint-overlay'
      className='pointer-events-none absolute inset-0 z-40 flex items-center justify-center'
      aria-hidden>
      <div className='absolute inset-0 bg-background/40 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200' />
      <div className='relative flex items-center gap-2 rounded-full border border-foreground/10 bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200'>
        <span>This is a live preview. Go to Articles to edit</span>
        <ArrowRight className='size-4 text-primary' />
      </div>
    </div>
  )
}
