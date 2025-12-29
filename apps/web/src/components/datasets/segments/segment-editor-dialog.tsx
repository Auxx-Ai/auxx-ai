// apps/web/src/components/datasets/documents/segment-editor-dialog.tsx

'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Textarea } from '@auxx/ui/components/textarea'
import { Label } from '@auxx/ui/components/label'
import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'

interface SegmentEditorDialogProps {
  segment: {
    id: string
    content: string
    position: number
    tokenCount: number
  }
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (content: string) => Promise<void>
  isPending?: boolean
}

/**
 * Dialog for editing document segment content
 */
export function SegmentEditorDialog({
  segment,
  open,
  onOpenChange,
  onSave,
  isPending = false,
}: SegmentEditorDialogProps) {
  const [content, setContent] = useState(segment.content)
  const [isSaving, setIsSaving] = useState(false)

  // Reset content when dialog opens or segment changes
  useEffect(() => {
    if (open) {
      setContent(segment.content)
    }
  }, [open, segment.content])

  /**
   * Estimate token count (rough approximation)
   * More accurate counting would require a proper tokenizer
   */
  const estimatedTokenCount = useMemo(() => {
    // Rough estimation: ~4 characters per token on average
    return Math.ceil(content.length / 4)
  }, [content])

  /**
   * Calculate percentage change in token count
   */
  const tokenCountChange = useMemo(() => {
    const change = estimatedTokenCount - segment.tokenCount
    const percentChange = (change / segment.tokenCount) * 100
    return { change, percentChange }
  }, [estimatedTokenCount, segment.tokenCount])

  /**
   * Handle save action
   */
  const handleSave = async () => {
    const trimmedContent = content.trim()

    if (!trimmedContent) {
      toastError({
        title: 'Invalid content',
        description: 'Segment content cannot be empty',
      })
      return
    }

    if (trimmedContent === segment.content) {
      onOpenChange(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(trimmedContent)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Handle cancel action
   */
  const handleCancel = () => {
    setContent(segment.content)
    onOpenChange(false)
  }

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Save on Cmd/Ctrl + Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    // Cancel on Escape
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Edit Segment {segment.position}</DialogTitle>
          <DialogDescription>
            Modify the content of this segment. Changes will trigger re-indexing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {/* Position and Token Info */}
          <div className="flex items-center gap-4">
            <Badge variant="outline">Position {segment.position}</Badge>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Tokens:</span>
              <span className="font-medium">{estimatedTokenCount}</span>
              {tokenCountChange.change !== 0 && (
                <span
                  className={tokenCountChange.change > 0 ? 'text-orange-600' : 'text-green-600'}>
                  ({tokenCountChange.change > 0 ? '+' : ''}
                  {tokenCountChange.change}, {tokenCountChange.percentChange.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>

          {/* Content Editor */}
          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter segment content..."
              className="min-h-[300px] font-mono text-sm"
              disabled={isPending || isSaving}
            />
            <p className="text-xs text-muted-foreground">
              {content.length} characters • Press Cmd+Enter to save
            </p>
          </div>

          {/* Warning for significant changes */}
          {Math.abs(tokenCountChange.percentChange) > 50 && (
            <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/10 p-3">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                Warning: Significant token count change detected (
                {tokenCountChange.percentChange > 0 ? '+' : ''}
                {tokenCountChange.percentChange.toFixed(1)}%). This may affect search results and
                embeddings.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isPending || isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            size="sm"
            variant="outline"
            loading={isPending || isSaving}
            loadingText="Saving..."
            disabled={!content.trim() || content.trim() === segment.content}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
