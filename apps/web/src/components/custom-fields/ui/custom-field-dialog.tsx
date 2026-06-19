// apps/web/src/components/custom-fields/ui/custom-field-dialog.tsx
'use client'

import type { ResourceFieldId } from '@auxx/types/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useState } from 'react'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { CustomFieldForm } from './custom-field-form'

/** Props for CustomFieldDialog */
interface CustomFieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** ResourceFieldId for edit mode (replaces editingField), null/undefined for create mode */
  resourceFieldId?: ResourceFieldId | null
  /** Entity definition ID - required for creating fields. For edit mode, derived from resourceFieldId if not provided */
  entityDefinitionId?: string
  /** Called after successful save - receives the created/updated field */
  onSuccess?: (field: { id: string; name: string }) => void
}

/**
 * Thin modal shell around {@link CustomFieldForm}. Owns the `Dialog` /
 * `DialogContent` chrome, the `DialogHeader`, and the unsaved-changes guard
 * (whose `guardProps` only work spread on `DialogContent`). All field logic
 * lives in the form core, which is also hosted un-modaled by the command
 * palette's create-field page. Public API is unchanged.
 *
 * - Create mode: shows field type dropdown
 * - Edit mode: hides field type (cannot be changed)
 */
export function CustomFieldDialog({
  open,
  onOpenChange,
  resourceFieldId,
  entityDefinitionId,
  onSuccess,
}: CustomFieldDialogProps) {
  // The form core reports its dirty state up so the guard (Esc / outside click)
  // can intercept a close while there are unsaved changes.
  const [isDirty, setIsDirty] = useState(false)
  // RELATIONSHIP wants a wider shell; the form signals it via onWideChange.
  const [wide, setWide] = useState(false)

  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: () => onOpenChange(false),
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size={wide ? 'xxl' : 'md'} position='tc' {...guardProps}>
          <CustomFieldForm
            open={open}
            entityDefinitionId={entityDefinitionId}
            resourceFieldId={resourceFieldId}
            onSuccess={onSuccess}
            onClose={() => onOpenChange(false)}
            onRequestClose={guardedClose}
            onDirtyChange={setIsDirty}
            onWideChange={setWide}
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
