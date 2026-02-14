// apps/web/src/components/files/files-breadcrumb.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { ChevronRight, Home } from 'lucide-react'
import { useFilesystemContext } from './provider/filesystem-provider'

/**
 * Props for the breadcrumb component with drag-drop support
 */
type FilesBreadcrumbProps = {
  draggingItems?: any[] | null
  allowedBreadcrumbIds?: Set<string>
  highlightClassName?: string
}

/**
 * Props for individual breadcrumb item
 */
type BreadcrumbItemProps = {
  crumb: { id: string | null; name: string }
  index: number
  isAllowed: boolean
  highlightClassName: string
  onNavigate: (folderId: string | null) => void
}

/**
 * Individual breadcrumb item component that can use useDroppable
 */
function BreadcrumbItem({
  crumb,
  index,
  isAllowed,
  highlightClassName,
  onNavigate,
}: BreadcrumbItemProps) {
  const id = crumb.id || 'root'

  // Register droppable for this breadcrumb item
  const { setNodeRef, isOver } = useDroppable({
    id: `breadcrumb:${id}`,
    data: { type: 'breadcrumb', folderId: id, name: crumb.name },
  })

  return (
    <div ref={setNodeRef} className='flex items-center rounded-sm'>
      {index > 0 && <ChevronRight className='h-4 w-4 mx-1' />}
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onNavigate(crumb.id)}
        className={cn(
          'px-1 font-normal border border-transparent hover:text-foreground transition-colors',
          isAllowed && highlightClassName,
          isOver && 'border-solid bg-primary-300'
        )}>
        {index === 0 && <Home />}
        {crumb.name}
      </Button>
    </div>
  )
}

/**
 * Breadcrumb navigation component for files
 * Shows the current folder path and allows navigation to parent folders
 * Supports drag-drop operations with visual feedback
 */
export function FilesBreadcrumb({
  draggingItems,
  allowedBreadcrumbIds = new Set(),
  highlightClassName = 'bg-info/10',
}: FilesBreadcrumbProps = {}) {
  const { breadcrumbs, navigateToFolder } = useFilesystemContext()

  return (
    <nav className='flex items-center space-x-1 text-sm text-muted-foreground'>
      {breadcrumbs.map((crumb, index) => {
        const id = crumb.id || 'root'
        const isAllowed = !!draggingItems?.length && allowedBreadcrumbIds.has(id)

        return (
          <BreadcrumbItem
            key={id}
            crumb={crumb}
            index={index}
            isAllowed={isAllowed}
            highlightClassName={highlightClassName}
            onNavigate={navigateToFolder}
          />
        )
      })}
    </nav>
  )
}
