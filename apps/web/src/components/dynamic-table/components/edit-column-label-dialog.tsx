// apps/web/src/components/dynamic-table/components/edit-column-label-dialog.tsx

'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'

interface EditColumnLabelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  columnId: string
  originalLabel: string
  currentLabel: string | undefined
  onSave: (label: string | null) => void
}

/**
 * Dialog for editing a column's display label
 */
export function EditColumnLabelDialog({
  open,
  onOpenChange,
  columnId,
  originalLabel,
  currentLabel,
  onSave,
}: EditColumnLabelDialogProps) {
  const [value, setValue] = useState(currentLabel ?? originalLabel)
  const hasCustomLabel = currentLabel !== undefined

  useEffect(() => {
    if (open) {
      setValue(currentLabel ?? originalLabel)
    }
  }, [open, currentLabel, originalLabel])

  const handleSave = () => {
    const trimmed = value.trim()
    // If empty or same as original, clear the custom label
    if (!trimmed || trimmed === originalLabel) {
      onSave(null)
    } else {
      onSave(trimmed)
    }
    onOpenChange(false)
  }

  const handleClear = () => {
    onSave(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>Edit Column Label</DialogTitle>
          <DialogDescription>Customize the display name for "{originalLabel}"</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Input
            id="column-label"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={originalLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSave()
              }
            }}
          />
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <div>
              {hasCustomLabel && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                  onClick={handleClear}>
                  Clear label
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} size="sm" variant="outline">
                Save
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
