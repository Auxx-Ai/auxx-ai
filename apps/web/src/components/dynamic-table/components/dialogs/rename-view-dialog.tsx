// apps/web/src/components/dynamic-table/components/dialogs/rename-view-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { useEffect, useState } from 'react'
import { useViewMutations } from '../../hooks/use-view-mutations'
import type { TableView } from '../../types'

export interface RenameViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: TableView | null
  tableId: string
  /** Callback when view is successfully renamed */
  onViewRenamed?: () => void
}

/**
 * Dialog for renaming existing views
 */
export function RenameViewDialog({
  open,
  onOpenChange,
  view,
  tableId,
  onViewRenamed,
}: RenameViewDialogProps) {
  const [newViewName, setNewViewName] = useState('')

  const { updateView } = useViewMutations(tableId)

  // Initialize name from view when dialog opens
  useEffect(() => {
    if (open && view) {
      setNewViewName(view.name)
    }
  }, [open, view])

  /** Handle view rename */
  const handleRenameView = async () => {
    if (!view || !newViewName.trim()) return

    await updateView.mutateAsync({ id: view.id, name: newViewName })
    onViewRenamed?.()
    onOpenChange(false)
  }

  /** Handle dialog close */
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setNewViewName('')
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Rename View</DialogTitle>
          <DialogDescription>Enter a new name for this view</DialogDescription>
        </DialogHeader>

        <div className='grid gap-2'>
          <Label htmlFor='rename-view'>View name</Label>
          <Input
            id='rename-view'
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            placeholder='My custom view'
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRenameView()
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button size='sm' variant='ghost' onClick={() => handleOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            data-dialog-submit
            size='sm'
            variant='outline'
            onClick={handleRenameView}
            disabled={!newViewName.trim() || updateView.isPending}>
            Rename View <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
