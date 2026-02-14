// apps/web/src/components/datasets/documents/document-segment-item.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader } from '@auxx/ui/components/card'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Switch } from '@auxx/ui/components/switch'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Edit2, MoreVertical, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { SegmentEditorDialog } from './segment-editor-dialog'

interface DocumentSegmentItemProps {
  segment: {
    id: string
    content: string
    position: number
    tokenCount: number
    indexStatus: string
    enabled: boolean
    metadata?: any
  }
  documentId: string
  datasetId: string
  isSelected?: boolean
  isBulkSelectionMode?: boolean // When true, clicking the row toggles selection
  onSelectionChange?: (selected: boolean) => void
  onUpdate?: () => void
  onDelete?: () => void
  highlightText?: string
}

/**
 * Component for displaying and managing individual document segments
 */
/**
 * Utility to highlight search matches in text
 */
function highlightSearchMatch(text: string, query: string): React.ReactNode {
  if (!query) return text

  try {
    // Escape special regex characters
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'))

    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className='bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded'>
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    )
  } catch (error) {
    // If regex fails, return plain text
    return text
  }
}

export function DocumentSegmentItem({
  segment,
  documentId,
  datasetId,
  isSelected = false,
  isBulkSelectionMode = false,
  onSelectionChange,
  onUpdate,
  onDelete,
  highlightText,
}: DocumentSegmentItemProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [localEnabled, setLocalEnabled] = useState(segment.enabled)
  const [isDeleted, setIsDeleted] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  // Sync local state with prop changes when segment prop changes
  useEffect(() => {
    setLocalEnabled(segment.enabled)
  }, [segment.enabled])

  // Toggle enabled mutation
  const toggleEnabled = api.segment.toggleEnabled.useMutation({
    onSuccess: () => {
      utils.document.getById.invalidate({ documentId })
      utils.segment.listByDocument.invalidate({ documentId })
      onUpdate?.()
    },
    onError: (error) => {
      // Revert local state on error
      setLocalEnabled(!localEnabled)
      toastError({
        title: 'Failed to update segment',
        description: error.message,
      })
    },
  })

  // Delete mutation
  const deleteSegment = api.segment.delete.useMutation({
    onMutate: async () => {
      // Optimistically hide the segment immediately
      setIsDeleted(true)

      // Cancel any outgoing refetches
      await utils.segment.listByDocument.cancel({ documentId })
      await utils.document.getById.cancel({ documentId })

      // Snapshot the previous values
      const previousSegments = utils.segment.listByDocument.getData({ documentId })
      const previousDocument = utils.document.getById.getData({ documentId })

      // Optimistically update the cache to remove this segment
      utils.segment.listByDocument.setInfiniteData({ documentId }, (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            segments: page.segments.filter((s) => s.id !== segment.id),
            totalCount: Math.max(0, (page.totalCount || 0) - 1),
          })),
        }
      })

      // Return a context with the snapshots
      return { previousSegments, previousDocument }
    },
    onSuccess: () => {
      // Invalidate queries to ensure consistency
      utils.document.getById.invalidate({ documentId })
      utils.segment.listByDocument.invalidate({ documentId })
      onDelete?.()
    },
    onError: (error, _, context) => {
      // Revert the optimistic update
      setIsDeleted(false)

      // Restore the previous data if available
      if (context?.previousSegments) {
        utils.segment.listByDocument.setInfiniteData({ documentId }, context.previousSegments)
      }
      if (context?.previousDocument) {
        utils.document.getById.setData({ documentId }, context.previousDocument)
      }

      toastError({
        title: 'Failed to delete segment',
        description: error.message,
      })
    },
  })

  // Update content mutation
  const updateContent = api.segment.updateContent.useMutation({
    onSuccess: () => {
      setIsEditorOpen(false)
      // Invalidate queries
      utils.document.getById.invalidate({ documentId })
      utils.segment.listByDocument.invalidate({ documentId })
      onUpdate?.()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update segment',
        description: error.message,
      })
    },
  })

  /**
   * Handle segment deletion with confirmation
   */
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Segment',
      description: `Are you sure you want to delete segment ${segment.position}? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteSegment.mutate({ segmentId: segment.id })
    }
  }

  /**
   * Handle segment content update
   */
  const handleSave = async (updatedContent: string) => {
    await updateContent.mutateAsync({
      segmentId: segment.id,
      content: updatedContent,
    })
  }

  /**
   * Handle switch toggle with optimistic update
   */
  const handleToggleEnabled = () => {
    // Optimistically update local state
    const newEnabledState = !localEnabled
    setLocalEnabled(newEnabledState)

    // Make API call
    toggleEnabled.mutate({
      segmentId: segment.id,
      enabled: newEnabledState,
    })
  }

  /**
   * Handle row click for bulk selection mode
   * Ignores clicks on interactive elements (buttons, checkboxes, switches, links)
   */
  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, [role="checkbox"], [role="switch"], a')) {
      return
    }

    if (isBulkSelectionMode) {
      onSelectionChange?.(!isSelected)
    }
  }

  // Determine status variant
  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'INDEXED':
        return 'green'
      case 'PENDING':
        return 'secondary'
      case 'FAILED':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  // Character limit for content preview
  const CONTENT_PREVIEW_LENGTH = 200
  const shouldTruncate = segment.content.length > CONTENT_PREVIEW_LENGTH
  const displayContent = isExpanded
    ? segment.content
    : shouldTruncate
      ? segment.content.slice(0, CONTENT_PREVIEW_LENGTH) + '...'
      : segment.content

  // Don't render if deleted
  if (isDeleted) {
    return null
  }

  return (
    <>
      <div
        onClick={handleRowClick}
        className={cn(
          'flex items-start gap-2',
          isBulkSelectionMode && 'cursor-pointer'
          // isSelected && 'rounded-2xl ring-2 ring-primary ring-offset-2'
        )}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onSelectionChange}
          className='mt-4'
          aria-label={`Select segment ${segment.position}`}
        />
        <Card
          className={cn(
            'flex-1 border transition-opacity transition-shadow duration-300 rounded-2xl relative hover:shadow-md dark:hover:shadow-black',
            !localEnabled && 'opacity-50',
            isSelected && 'ring-2 ring-info/50 ring-offset-2 bg-info/10 dark:ring-offset-black'
          )}>
          <CardHeader className='flex flex-row items-start justify-between pb-1'>
            <div className='flex items-center gap-2'>
              <Badge variant='outline' size='sm'>
                Segment {segment.position + 1}
              </Badge>
              <span className='text-xs text-muted-foreground'>{segment.tokenCount} tokens</span>
              <Badge variant={getStatusVariant(segment.indexStatus)} size='sm'>
                {segment.indexStatus}
              </Badge>
            </div>

            <div className='flex items-center gap-1 absolute top-1 right-1'>
              <Switch
                checked={localEnabled}
                size='sm'
                onCheckedChange={handleToggleEnabled}
                disabled={toggleEnabled.isPending}
                aria-label={`Toggle segment ${segment.position}`}
              />

              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    className='rounded-full '
                    disabled={deleteSegment.isPending || updateContent.isPending}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={() => setIsEditorOpen(true)}>
                    <Edit2 />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} variant='destructive'>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            {/* Header Row */}

            {/* Content */}
            <div>
              <p className='text-sm text-muted-foreground whitespace-pre-wrap truncate'>
                {highlightText
                  ? highlightSearchMatch(displayContent, highlightText)
                  : displayContent}
                {shouldTruncate && (
                  <Button
                    variant='link'
                    size='sm'
                    className='ms-2 px-0 h-auto mt-1'
                    onClick={() => setIsExpanded(!isExpanded)}>
                    {isExpanded ? 'Show less' : 'Show more'}
                  </Button>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Editor Dialog */}
      <SegmentEditorDialog
        segment={segment}
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onSave={handleSave}
        isPending={updateContent.isPending}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog />
    </>
  )
}
