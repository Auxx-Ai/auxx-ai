// apps/web/src/components/templates/ui/template-detail-layout.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

interface TemplateDetailLayoutProps {
  /** Left pane (2/3, bg-muted/30, border-r; top half on mobile). */
  preview: ReactNode
  /** Shown centered in the preview pane while detail data loads. */
  previewLoading?: boolean
  /** Right pane content, wrapped in a ScrollArea (1/3; bottom half on mobile). */
  children: ReactNode
}

/**
 * Two-pane detail body shared by the entity and workflow gallery dialogs: a wide
 * preview pane (left/top) and a narrower info pane (right/bottom). The footer CTA
 * is owned by `TemplateGalleryDialog`'s global `DialogFooter` via
 * `renderDetailFooter` — this component intentionally has no footer of its own.
 */
export function TemplateDetailLayout({
  preview,
  previewLoading,
  children,
}: TemplateDetailLayoutProps) {
  return (
    <div className='flex h-[460px] flex-col overflow-hidden sm:flex-row'>
      {/* Preview — top on mobile, left 2/3 on desktop */}
      <div className='h-1/2 overflow-hidden border-b bg-muted/30 sm:h-auto sm:flex-2 sm:border-r sm:border-b-0'>
        {previewLoading ? (
          <div className='flex h-full items-center justify-center'>
            <Loader2 className='size-8 animate-spin text-muted-foreground' />
          </div>
        ) : (
          preview
        )}
      </div>

      {/* Info — bottom on mobile, right 1/3 on desktop */}
      <div className='flex h-1/2 flex-col sm:h-auto sm:flex-1'>
        <ScrollArea className='flex-1'>{children}</ScrollArea>
      </div>
    </div>
  )
}
