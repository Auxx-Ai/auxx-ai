// apps/web/src/components/manufacturing/parts/vendor-part-dialog.tsx
'use client'

import { getInstanceId, type RecordId, toRecordId } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useState } from 'react'
import { useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import {
  defaultVendorPartValues,
  VendorPartFields,
  type VendorPartFormValues,
} from './vendor-part-fields'

const VENDOR_PART_SYSTEM_ATTRIBUTES = [
  'vendor_part_vendor_sku',
  'vendor_part_unit_price',
  'vendor_part_lead_time',
  'vendor_part_min_order_qty',
  'vendor_part_is_preferred',
  'vendor_part_contact',
  'vendor_part_part',
] as const

/** Props for VendorPartDialog component */
interface VendorPartDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Part ID - provide for part-centric mode (user selects contact) */
  partId?: string
  /** Entity instance ID - provide for contact-centric mode (user selects part) */
  entityInstanceId?: string
  /** RecordId for edit mode (format: "entityDefinitionId:entityInstanceId") */
  recordId?: RecordId
  /** Callback on successful save */
  onSuccess?: () => void
}

/** Dialog for adding/editing a contact-part association (supplier) */
export function VendorPartDialog({
  open,
  onOpenChange,
  partId: partIdProp,
  entityInstanceId: entityInstanceIdProp,
  recordId,
  onSuccess,
}: VendorPartDialogProps) {
  const isEditMode = !!recordId

  // Determine mode: part-centric (select contact) or contact-centric (select part)
  const isPartMode = !!partIdProp
  const isContactMode = !!entityInstanceIdProp

  // Resolve vendor_part entity definition ID
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')

  // Load initial values for edit mode via system attributes
  const { values: systemValues } = useSystemValues(recordId, VENDOR_PART_SYSTEM_ATTRIBUTES, {
    autoFetch: true,
    enabled: isEditMode && open,
  })

  // State - uses shared type plus partId for contact-centric mode
  const [values, setValues] = useState<VendorPartFormValues & { partId: string }>({
    ...defaultVendorPartValues,
    partId: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Initialize/reset values when dialog opens
  useEffect(() => {
    if (open) {
      if (isEditMode && systemValues) {
        setValues({
          entityInstanceId: (systemValues.vendor_part_contact as string) ?? '',
          partId: (systemValues.vendor_part_part as string) ?? '',
          vendorSku: (systemValues.vendor_part_vendor_sku as string) ?? '',
          unitPrice: (systemValues.vendor_part_unit_price as number) ?? null,
          leadTime: (systemValues.vendor_part_lead_time as number) ?? null,
          minOrderQty: (systemValues.vendor_part_min_order_qty as number) ?? null,
          isPreferred: (systemValues.vendor_part_is_preferred as boolean) ?? false,
        })
      } else if (!isEditMode) {
        setValues({
          ...defaultVendorPartValues,
          partId: '',
        })
      }
      setErrors({})
    }
  }, [open, isEditMode, systemValues])

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
    if (isPartMode && !values.entityInstanceId) newErrors.entityInstanceId = 'Contact is required'
    if (isContactMode && !values.partId) newErrors.partId = 'Part is required'
    if (!values.vendorSku) newErrors.vendorSku = 'Supplier SKU is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Create mutation via entity system
  const createRecord = api.record.create.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to add supplier', description: error.message })
    },
  })

  // Save field values for edit mode
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue({})

  const isPending = createRecord.isPending || isSavingFields

  // Submit
  const handleSubmit = async () => {
    if (!validate()) return

    // Resolve partId and entityInstanceId from props or state
    const resolvedPartId = partIdProp ?? values.partId
    const resolvedEntityInstanceId = entityInstanceIdProp ?? values.entityInstanceId

    if (isEditMode && recordId) {
      // Edit mode: use saveMultipleAsync for optimistic updates
      const fieldValues: Array<{ fieldId: string; value: unknown; fieldType: string }> = [
        { fieldId: 'vendor_part_vendor_sku', value: values.vendorSku, fieldType: 'TEXT' },
        { fieldId: 'vendor_part_unit_price', value: values.unitPrice, fieldType: 'CURRENCY' },
        { fieldId: 'vendor_part_lead_time', value: values.leadTime, fieldType: 'NUMBER' },
        { fieldId: 'vendor_part_min_order_qty', value: values.minOrderQty, fieldType: 'NUMBER' },
        { fieldId: 'vendor_part_is_preferred', value: values.isPreferred, fieldType: 'CHECKBOX' },
      ]

      const success = await saveMultipleAsync(recordId, fieldValues)
      if (success) {
        onSuccess?.()
        onOpenChange(false)
      }
    } else {
      // Create mode: use record.create with systemAttribute keys
      await createRecord.mutateAsync({
        entityDefinitionId: vendorPartDefId!,
        values: {
          vendor_part_part: resolvedPartId,
          vendor_part_contact: resolvedEntityInstanceId,
          vendor_part_vendor_sku: values.vendorSku,
          vendor_part_unit_price: values.unitPrice,
          vendor_part_lead_time: values.leadTime,
          vendor_part_min_order_qty: values.minOrderQty,
          vendor_part_is_preferred: values.isPreferred,
        },
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
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

        <VarEditorField className='p-0'>
          {/* Part Selection - only shown in contact-centric mode */}
          {isContactMode && (
            <VarEditorFieldRow
              title='Part'
              isRequired
              validationError={errors.partId}
              validationType='error'>
              <MultiRelationInput
                entityDefinitionId='part'
                value={values.partId ? [toRecordId('part', values.partId)] : []}
                onChange={(recordIds: RecordId[]) =>
                  handleChange('partId', recordIds[0] ? getInstanceId(recordIds[0]) : '')
                }
                placeholder='Select part...'
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
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText={isEditMode ? 'Updating...' : 'Adding...'}
            disabled={!vendorPartDefId}
            data-dialog-submit>
            {isEditMode ? 'Update Supplier' : 'Add Supplier'}{' '}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
