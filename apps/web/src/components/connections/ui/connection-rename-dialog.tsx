// apps/web/src/components/connections/ui/connection-rename-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useEffect, useState } from 'react'

interface ConnectionRenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current display name, used to seed the input. */
  currentName: string
  pending?: boolean
  /** Persist the new name. Only called when non-empty and changed. */
  onSubmit: (name: string) => void
}

/**
 * Minimal single-field dialog for renaming a connection. Writes the user-facing
 * `label` via `connections.update` (the card title shows `label ?? name`).
 */
export function ConnectionRenameDialog({
  open,
  onOpenChange,
  currentName,
  pending,
  onSubmit,
}: ConnectionRenameDialogProps) {
  const [value, setValue] = useState(currentName)

  useEffect(() => {
    if (open) setValue(currentName)
  }, [open, currentName])

  const trimmed = value.trim()
  const canSave = trimmed.length > 0 && trimmed !== currentName && !pending

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    onSubmit(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Rename connection</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave}>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              placeholder='Connection name'
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={pending}
              autoComplete='off'
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onOpenChange(false)}
              disabled={pending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              variant='outline'
              size='sm'
              disabled={!canSave}
              loading={pending}
              loadingText='Saving...'>
              Save <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
