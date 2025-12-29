// apps/web/src/components/dynamic-table/components/drag-preview.tsx

'use client'

import { FolderIcon, FileIcon } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import type { FileItem } from '~/components/files/files-store'

interface DragPreviewProps<TData = any> {
  items: TData[]
  isDragging: boolean
}

/**
 * Generic drag preview component
 */
export function DragPreview<TData>({ items, isDragging }: DragPreviewProps<TData>) {
  const itemCount = items.length
  const firstItem = items[0]

  return (
    <div
      className={cn(
        'bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-48',
        'flex items-center gap-2',
        isDragging && 'opacity-90'
      )}>
      <div className="h-5 w-5 text-blue-500">
        <FileIcon />
      </div>
      <span className="text-sm font-medium">
        {itemCount === 1 ? (firstItem as any)?.name || `1 item` : `${itemCount} items`}
      </span>
    </div>
  )
}
