// apps/web/src/components/manufacturing/parts/subpart-dialog.tsx
'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import type { SubpartEntity as Subpart } from '@auxx/database/models'

/** Props for SubpartDialog component */
interface SubpartDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Parent part ID */
  parentPartId: string
  /** Subpart to edit (null for add mode) */
  subpart?: Subpart | null
  /** Callback on successful save */
  onSuccess?: () => void
}

/** Dialog for adding/editing a subpart */
export function SubpartDialog({
  open,
  onOpenChange,
  parentPartId,
  subpart,
  onSuccess,
}: SubpartDialogProps) {
  const isEditMode = !!subpart

  // State
  const [values, setValues] = useState({
    childPartId: '',
    quantity: 1,
    notes: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [hasCyclicDependency, setHasCyclicDependency] = useState(false)

  // Fetch all parts for selection
  const { data: partsData, isLoading: isLoadingParts } = api.part.all.useQuery(
    {},
    { enabled: open }
  )
  const allParts = partsData?.parts ?? []

  // Fetch parent part details
  const { data: parentPart } = api.part.byId.useQuery(
    { id: parentPartId },
    { enabled: open && !!parentPartId }
  )

  // Fetch existing subparts to filter out already-added parts
  const { data: existingSubparts = [] } = api.subpart.all.useQuery(
    { parentPartId },
    { enabled: open && !!parentPartId }
  )

  // Check for cyclic dependencies
  const { data: childSubparts = [] } = api.subpart.all.useQuery(
    { parentPartId: values.childPartId },
    { enabled: open && !isEditMode && !!values.childPartId }
  )

  // Update cyclic dependency check when child subparts load
  useEffect(() => {
    if (!isEditMode && values.childPartId && childSubparts.length > 0) {
      const directCycle = childSubparts.some((sp: Subpart) => sp.childPartId === parentPartId)
      setHasCyclicDependency(directCycle)
    } else {
      setHasCyclicDependency(false)
    }
  }, [isEditMode, values.childPartId, parentPartId, childSubparts])

  // Filter available parts
  const availableParts = useMemo(() => {
    if (isEditMode) return allParts
    return allParts.filter((part) => {
      // Exclude the parent part itself
      if (part.id === parentPartId) return false
      // Exclude parts that are already parent parts of the current part
      if (parentPart?.parentParts?.some((p: any) => p.parentPart?.id === part.id)) {
        return false
      }
      // Exclude parts that are already subparts
      if (existingSubparts.some((sp: any) => sp.childPartId === part.id)) {
        return false
      }
      return true
    })
  }, [allParts, isEditMode, parentPartId, parentPart, existingSubparts])

  // Part options for ENUM
  const partOptions = useMemo(
    () => availableParts.map((p) => ({ label: `${p.title} - ${p.sku}`, value: p.id })),
    [availableParts]
  )

  // Initialize/reset values when dialog opens
  useEffect(() => {
    if (open) {
      setValues({
        childPartId: subpart?.childPartId ?? '',
        quantity: subpart?.quantity ?? 1,
        notes: subpart?.notes ?? '',
      })
      setErrors({})
      setHasCyclicDependency(false)
    }
  }, [open, subpart])

  // Field change handler
  const handleChange = useCallback((field: string, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    // Clear error when user edits
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return prev
    })
  }, [])

  // Validation
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!values.childPartId) newErrors.childPartId = 'Subpart is required'
    if (!values.quantity || values.quantity < 1) newErrors.quantity = 'Quantity must be at least 1'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Mutations
  const createSubpart = api.subpart.create.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to add subpart', description: error.message })
    },
  })

  const updateSubpart = api.subpart.update.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to update subpart', description: error.message })
    },
  })

  const isPending = createSubpart.isPending || updateSubpart.isPending
  const noAvailableParts = availableParts.length === 0 && !isLoadingParts && !isEditMode

  // Submit
  const handleSubmit = async () => {
    if (hasCyclicDependency) {
      toastError({ title: 'Cannot create a cyclic dependency between parts' })
      return
    }
    if (!validate()) return

    const payload = {
      parentPartId,
      childPartId: values.childPartId,
      quantity: values.quantity,
      notes: values.notes || undefined,
    }

    if (isEditMode && subpart) {
      await updateSubpart.mutateAsync({ id: subpart.id, ...payload })
    } else {
      await createSubpart.mutateAsync(payload)
    }
  }

  // Register Meta+Enter submit handler
  useDialogSubmit({
    onSubmit: handleSubmit,
    disabled: noAvailableParts || hasCyclicDependency || isPending,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" position="tc">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Subpart' : 'Add Subpart'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the subpart configuration'
              : 'Add a component that will be used in the assembly of this part'}
          </DialogDescription>
        </DialogHeader>

        <VarEditorField className="p-0">
          {/* Subpart Selection */}
          <VarEditorFieldRow
            title="Subpart"
            description="Component to add"
            isRequired
            validationError={
              errors.childPartId || (noAvailableParts ? 'No available parts to add' : undefined)
            }
            validationType={noAvailableParts ? 'warning' : 'error'}>
            <ConstantInputAdapter
              value={values.childPartId}
              onChange={(_, val) => handleChange('childPartId', val)}
              varType={BaseType.ENUM}
              placeholder={isLoadingParts ? 'Loading...' : 'Select a component...'}
              disabled={isPending || isEditMode || isLoadingParts || noAvailableParts}
              fieldOptions={{ enum: partOptions }}
            />
          </VarEditorFieldRow>

          {/* Quantity */}
          <VarEditorFieldRow
            title="Quantity"
            description="Number of units required per parent part"
            type={BaseType.NUMBER}
            showIcon
            isRequired
            validationError={errors.quantity}
            validationType="error">
            <ConstantInputAdapter
              value={values.quantity}
              onChange={(_, val) => handleChange('quantity', val ?? 1)}
              varType={BaseType.NUMBER}
              placeholder="1"
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* Notes */}
          <VarEditorFieldRow
            title="Notes"
            description="Optional notes about this component usage"
            type={BaseType.STRING}
            showIcon>
            <ConstantInputAdapter
              value={values.notes}
              onChange={(_, val) => handleChange('notes', val ?? '')}
              varType={BaseType.STRING}
              placeholder="Optional notes..."
              disabled={isPending}
              fieldOptions={{ string: { multiline: true } }}
            />
          </VarEditorFieldRow>
        </VarEditorField>

        {/* Cyclic Dependency Warning */}
        {hasCyclicDependency && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              Cyclic dependency detected: This would create a circular reference.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button
            onClick={handleSubmit}
            size="sm"
            variant="outline"
            loading={isPending}
            loadingText={isEditMode ? 'Updating...' : 'Adding...'}
            disabled={noAvailableParts || hasCyclicDependency}>
            {isEditMode ? 'Update Subpart' : 'Add Subpart'} <KbdSubmit variant="outline" size="sm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
