// apps/web/src/components/manufacturing/parts/vendor-part-dialog.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { toResourceId, getInstanceId, type ResourceId } from '@auxx/lib/field-values/client'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import type { VendorPartEntity as VendorPart } from '@auxx/database/models'
import { VendorPartFields, defaultVendorPartValues, type VendorPartFormValues } from './vendor-part-fields'

/** Props for VendorPartDialog component */
interface VendorPartDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Part ID - provide for part-centric mode (user selects contact) */
  partId?: string
  /** Contact ID - provide for contact-centric mode (user selects part) */
  contactId?: string
  /** VendorPart to edit (null for add mode) */
  vendorPart?: VendorPart | null
  /** Callback on successful save */
  onSuccess?: () => void
}

/** Dialog for adding/editing a contact-part association (supplier) */
export function VendorPartDialog({
  open,
  onOpenChange,
  partId: partIdProp,
  contactId: contactIdProp,
  vendorPart,
  onSuccess,
}: VendorPartDialogProps) {
  const isEditMode = !!vendorPart

  // Determine mode: part-centric (select contact) or contact-centric (select part)
  const isPartMode = !!partIdProp
  const isContactMode = !!contactIdProp

  // State - uses shared type plus partId for contact-centric mode
  const [values, setValues] = useState<VendorPartFormValues & { partId: string }>({
    ...defaultVendorPartValues,
    partId: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Initialize/reset values when dialog opens
  useEffect(() => {
    if (open) {
      setValues({
        contactId: (vendorPart as any)?.contactId ?? '',
        partId: (vendorPart as any)?.partId ?? '',
        vendorSku: vendorPart?.vendorSku ?? '',
        unitPrice: vendorPart?.unitPrice ?? null,
        leadTime: vendorPart?.leadTime ?? null,
        minOrderQty: vendorPart?.minOrderQty ?? null,
        isPreferred: vendorPart?.isPreferred ?? false,
      })
      setErrors({})
    }
  }, [open, vendorPart])

  // Handler for vendor part field changes
  const handleVendorPartChange = useCallback((field: keyof VendorPartFormValues, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return prev
    })
  }, [])

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
    if (isPartMode && !values.contactId) newErrors.contactId = 'Contact is required'
    if (isContactMode && !values.partId) newErrors.partId = 'Part is required'
    if (!values.vendorSku) newErrors.vendorSku = 'Supplier SKU is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Mutations
  const createVendorPart = api.vendorPart.create.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to add supplier', description: error.message })
    },
  })

  const updateVendorPart = api.vendorPart.update.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to update supplier', description: error.message })
    },
  })

  const isPending = createVendorPart.isPending || updateVendorPart.isPending

  // Submit
  const handleSubmit = async () => {
    if (!validate()) return

    // Resolve partId and contactId from props or state
    const resolvedPartId = partIdProp ?? values.partId
    const resolvedContactId = contactIdProp ?? values.contactId

    const payload = {
      contactId: resolvedContactId,
      partId: resolvedPartId,
      vendorSku: values.vendorSku,
      unitPrice: values.unitPrice,
      leadTime: values.leadTime,
      minOrderQty: values.minOrderQty,
      isPreferred: values.isPreferred,
    }

    if (isEditMode && vendorPart) {
      await updateVendorPart.mutateAsync({ id: vendorPart.id, ...payload })
    } else {
      await createVendorPart.mutateAsync(payload)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" position="tc">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the supplier configuration'
              : isPartMode
                ? 'Associate a contact as a supplier for this part'
                : 'Add a part that this contact supplies'}
          </DialogDescription>
        </DialogHeader>

        <VarEditorField className="p-0">
          {/* Part Selection - only shown in contact-centric mode */}
          {isContactMode && (
            <VarEditorFieldRow
              title="Part"
              isRequired
              validationError={errors.partId}
              validationType="error">
              <MultiRelationInput
                entityDefinitionId="part"
                value={values.partId ? [toResourceId('part', values.partId)] : []}
                onChange={(resourceIds: ResourceId[]) => handleChange('partId', resourceIds[0] ? getInstanceId(resourceIds[0]) : '')}
                placeholder="Select part..."
                disabled={isPending || isEditMode}
                multi={false}
              />
            </VarEditorFieldRow>
          )}

          {/* Shared vendor part fields */}
          <VendorPartFields
            values={values}
            onChange={handleVendorPartChange}
            errors={errors}
            disabled={isPending}
            disableContactEdit={isEditMode}
            showContactField={isPartMode}
          />
        </VarEditorField>

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
            variant="outline"
            size="sm"
            loading={isPending}
            loadingText={isEditMode ? 'Updating...' : 'Adding...'}
            data-dialog-submit>
            {isEditMode ? 'Update Supplier' : 'Add Supplier'} <KbdSubmit variant="outline" size="sm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
