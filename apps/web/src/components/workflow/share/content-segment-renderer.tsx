// apps/web/src/components/workflow/share/content-segment-renderer.tsx
'use client'

import type { ContentSegment } from '@auxx/lib/workflow-engine/types/content-segment'
import { InlineFileRenderer, InlineFileArrayRenderer } from './inline-file-renderer'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for ContentSegmentRenderer
 */
interface ContentSegmentRendererProps {
  segments: ContentSegment[]
  className?: string
}

/**
 * Render content segments with support for text, files, and file arrays
 * Handles rich content from end node output
 */
export function ContentSegmentRenderer({ segments, className }: ContentSegmentRendererProps) {
  if (!segments || segments.length === 0) {
    return null
  }

  return (
    <div className={cn('space-y-3', className)}>
      {segments.map((segment, index) => {
        switch (segment.type) {
          case 'text':
            // Render text with whitespace preserved
            return segment.value ? (
              <span key={index} className="whitespace-pre-wrap">
                {segment.value}
              </span>
            ) : null

          case 'file':
            // Render single file (image preview or download card)
            return (
              <div key={index} className="my-2">
                <InlineFileRenderer file={segment.value} />
              </div>
            )

          case 'file-array':
            // Render multiple files in a grid
            return (
              <div key={index} className="my-2">
                <InlineFileArrayRenderer files={segment.value} />
              </div>
            )

          default:
            return null
        }
      })}
    </div>
  )
}
