// apps/web/src/components/datasets/create-dataset-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { DatasetForm } from './dataset-form'

interface CreateDatasetDialogProps {
  trigger?: React.ReactNode
  onSuccess?: (dataset: unknown) => void
}

/**
 * Thin modal wrapper around {@link DatasetForm}. Supplies the `Dialog` shell, the
 * trigger button, and the header; all form logic lives in the core, which the
 * command palette hosts directly as a page. Public API is unchanged.
 */
export function CreateDatasetDialog({ trigger, onSuccess }: CreateDatasetDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size='sm'>
            <Plus />
            Create Dataset
          </Button>
        )}
      </DialogTrigger>
      <DialogContent position='tc' size='sm'>
        {open && (
          <DatasetForm
            onSuccess={onSuccess}
            onClose={() => setOpen(false)}
            header={({ title }) => (
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                  Create a new dataset to organize and manage your documents.
                </DialogDescription>
              </DialogHeader>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
