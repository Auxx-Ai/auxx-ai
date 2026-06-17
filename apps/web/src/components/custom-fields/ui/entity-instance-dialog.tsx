// apps/web/src/components/custom-fields/ui/entity-instance-dialog.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useState } from 'react'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { EntityInstanceForm } from './entity-instance/entity-instance-form'

interface EntityInstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entity definition ID */
  entityDefinitionId: string
  /** RecordId for edit mode (format: "entityDefinitionId:entityInstanceId"), undefined for create */
  recordId?: RecordId
  /** Callback after successful save */
  onSaved?: (instanceId: string) => void
  /** Preset field values for CREATE mode. Format: { fieldId: value } */
  presetValues?: Record<string, unknown>
}

/**
 * Dialog for creating/editing entity instances. Thin modal shell around
 * {@link EntityInstanceForm} — it owns the `Dialog`/`DialogContent` chrome, the
 * `DialogHeader`, and the unsaved-changes guard (whose `guardProps` only work
 * spread on `DialogContent`). All field logic lives in the form core, which is
 * also hosted un-modaled by the command palette. Public API is unchanged.
 */
export function EntityInstanceDialog({
  open,
  onOpenChange,
  entityDefinitionId,
  recordId,
  onSaved,
  presetValues,
}: EntityInstanceDialogProps) {
  // The form core reports its dirty state up so the guard (Esc / outside click)
  // can intercept a close while there are unsaved changes.
  const [isDirty, setIsDirty] = useState(false)

  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: () => onOpenChange(false),
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size='lg' position='tc' {...guardProps}>
          <EntityInstanceForm
            open={open}
            entityDefinitionId={entityDefinitionId}
            recordId={recordId}
            onSaved={onSaved}
            presetValues={presetValues}
            onClose={() => onOpenChange(false)}
            onRequestClose={guardedClose}
            onDirtyChange={setIsDirty}
            header={({ title, description }) => (
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </DialogHeader>
            )}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
