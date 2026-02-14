// apps/web/src/components/workflow/ui/workflow-version-item.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { CommandItem } from '@auxx/ui/components/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Input } from '@auxx/ui/components/input'
import { cn } from '@auxx/ui/lib/utils'
import { ArchiveRestore, Eye, MoreHorizontal, TextCursorInput, Trash2 } from 'lucide-react'
import React from 'react'

interface WorkflowVersionItemProps {
  version: {
    id: string
    title?: string
    version: number
    createdAt: Date
    isPublished?: boolean
    isDraft: boolean
  }
  isSelected: boolean
  onSelect: () => void
  onRename: (id: string, title: string) => void
  onRestore: (id: string, title: string) => void
  onDelete: (id: string, title: string) => void
  formatDate: (date: Date) => string
  isDirty: boolean
  workflowName: string
}

/**
 * Individual workflow version item component
 * Isolated to prevent re-renders affecting parent components
 */
export const WorkflowVersionItem = React.memo<WorkflowVersionItemProps>(
  ({
    version,
    isSelected,
    onSelect,
    onRename,
    onRestore,
    onDelete,
    formatDate,
    isDirty,
    workflowName,
  }) => {
    const [isRenaming, setIsRenaming] = React.useState(false)
    const [renameTitle, setRenameTitle] = React.useState('')

    const handleStartRename = React.useCallback(() => {
      setIsRenaming(true)
      setRenameTitle(version.title || `Version ${version.version}`)
    }, [version.title, version.version])

    const handleSubmitRename = React.useCallback(() => {
      if (renameTitle.trim()) {
        onRename(version.id, renameTitle.trim())
      }
      setIsRenaming(false)
    }, [version.id, renameTitle, onRename])

    const handleCancelRename = React.useCallback(() => {
      setIsRenaming(false)
      setRenameTitle('')
    }, [])

    return (
      <CommandItem
        onSelect={onSelect}
        className={cn(
          'group flex items-center justify-between cursor-pointer',
          'mb-2 rounded-xl border-[0.5px] border-border bg-secondary/30 shadow-xs last-of-type:mb-0',
          'px-3 py-1 transition-all',
          'hover:bg-secondary/50 hover:ring-1 hover:ring-blue-500',
          'data-[selected=true]:bg-secondary/50 data-[selected=true]:ring-1 data-[selected=true]:ring-blue-500'
        )}>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center'>
            <div className='w-6'>
              {isSelected && <Eye className='w-3 h-3 text-muted-foreground' />}
            </div>

            {isRenaming ? (
              <Input
                type='text'
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    handleSubmitRename()
                  } else if (e.key === 'Escape') {
                    handleCancelRename()
                  }
                }}
                onBlur={handleSubmitRename}
                className='w-full px-1 py-0.5 text-sm border rounded'
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className='flex flex-col'>
                <div className='flex flex-row gap-1'>
                  <span className='font-medium text-sm truncate'>
                    {version.isDraft
                      ? 'Current Draft'
                      : version.title || `Version ${version.version}`}
                  </span>
                  {version.isPublished && (
                    <Badge variant='blue' size='xs'>
                      Published
                    </Badge>
                  )}
                  {version.isDraft && isDirty && (
                    <Badge variant='secondary' size='xs'>
                      Unsaved
                    </Badge>
                  )}
                </div>
                <div className='text-sm text-muted-foreground'>
                  {version.isDraft ? workflowName : formatDate(version.createdAt)}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className='flex items-center gap-2'>
          {!isRenaming && !version.isDraft && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 w-6 p-0 invisible group-hover:visible group-data-[selected=true]:visible group-data-[selected=true]:bg-primary-100'
                  onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStartRename()
                  }}>
                  <TextCursorInput />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onRestore(version.id, version.title || `Version ${version.version}`)
                  }}>
                  <ArchiveRestore />
                  Restore
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(version.id, version.title || `Version ${version.version}`)
                  }}
                  variant='destructive'>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CommandItem>
    )
  }
)

WorkflowVersionItem.displayName = 'WorkflowVersionItem'
