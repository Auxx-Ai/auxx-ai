// apps/web/src/components/global/sidebar/tree/sidebar-drag-overlay.tsx
'use client'

import { Folder, PanelLeft, Star } from 'lucide-react'
import type { SidebarNodeKind } from './sidebar-drop-rules'

/** DragOverlay ghost for sidebar nodes; label-only so row renderers' fetch hooks don't re-fire mid-drag. */
export function SidebarDragOverlay({ kind, label }: { kind: SidebarNodeKind; label: string }) {
  const Icon = kind === 'FOLDER' ? Folder : kind === 'GROUP' ? PanelLeft : Star
  return (
    <div className='inline-flex max-w-xs items-center gap-2 rounded-md border bg-popover px-2 py-1 text-sm shadow-md'>
      <Icon className='size-3.5 shrink-0 text-muted-foreground' />
      <span className='truncate'>{label}</span>
    </div>
  )
}
