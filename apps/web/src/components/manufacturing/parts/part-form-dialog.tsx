// apps/web/src/components/manufacturing/parts/part-form-dialog.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
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
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BaseType } from '~/components/workflow/types'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import {
  defaultVendorPartValues,
  VendorPartFields,
  type VendorPartFormValues,
} from './vendor-part-fields'

const PART_SYSTEM_ATTRIBUTES = [
  'part_title',
  'part_sku',
  'part_description',
  'category',
  'hs_code',
  'shopify_product_link_id',
] as const

/** Props for PartFormDialog component */
interface PartFormDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** RecordId for edit mode */
  recordId?: RecordId
  /** Callback on successful save */
  onSuccess?: () => void
}

/** Dialog for creating/editing a part */
export function PartFormDialog({ open, onOpenChange, recordId, onSuccess }: PartFormDialogProps) {
  const isEditMode = !!recordId
  console.log('part dialog')
  // Resolve entity definition IDs
  const partDefId = useResourceProperty('part', 'id')
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')

  // Load initial values for edit mode
  const { values: systemValues } = useSystemValues(recordId, PART_SYSTEM_ATTRIBUTES, {
    autoFetch: true,
    enabled: isEditMode && open,
  })

  // State
  const [values, setValues] = useState({
    title: '',
    description: '',
    sku: '',
    hsCode: '',
    category: '',
    shopifyProductLinkId: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showSupplier, setShowSupplier] = useState(false)
  const [vendorPartValues, setVendorPartValues] =
    useState<VendorPartFormValues>(defaultVendorPartValues)
  const [vendorPartErrors, setVendorPartErrors] = useState<Record<string, string>>({})

  // Initialize/reset values when dialog opens
  useEffect(() => {
    if (open) {
      if (isEditMode && systemValues) {
        setValues({
          title: (systemValues.part_title as string) ?? '',
          description: (systemValues.part_description as string) ?? '',
          sku: (systemValues.part_sku as string) ?? '',
          hsCode: (systemValues.hs_code as string) ?? '',
          category: (systemValues.category as string) ?? '',
          shopifyProductLinkId: (systemValues.shopify_product_link_id as string) ?? '',
        })
      } else if (!isEditMode) {
        setValues({
          title: '',
          description: '',
          sku: '',
          hsCode: '',
          category: '',
          shopifyProductLinkId: '',
        })
      }
      setErrors({})
      setShowSupplier(false)
      setVendorPartValues(defaultVendorPartValues)
      setVendorPartErrors({})
    }
  }, [open, isEditMode, systemValues])

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
    if (!values.title) newErrors.title = 'Title is required'
    if (!values.sku) newErrors.sku = 'SKU is required'
    setErrors(newErrors)

    // Validate vendor part fields if supplier section is shown
    const vpErrors: Record<string, string> = {}
    if (showSupplier) {
      if (!vendorPartValues.entityInstanceId) vpErrors.entityInstanceId = 'Contact is required'
      if (!vendorPartValues.vendorSku) vpErrors.vendorSku = 'Supplier SKU is required'
    }
    setVendorPartErrors(vpErrors)

    return Object.keys(newErrors).length === 0 && Object.keys(vpErrors).length === 0
  }

  // Create mutation via entity system
  const createRecord = api.record.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Error creating part', description: error.message })
    },
  })

  // Save field values for edit mode
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue({})

  const isPending = createRecord.isPending || isSavingFields

  // Submit
  const handleSubmit = async () => {
    if (!validate()) return

    try {
      if (isEditMode && recordId) {
        // Edit mode: use saveMultipleAsync for optimistic updates
        const fieldValues: Array<{ fieldId: string; value: unknown; fieldType: string }> = [
          { fieldId: 'part_title', value: values.title, fieldType: 'TEXT' },
          { fieldId: 'part_sku', value: values.sku, fieldType: 'TEXT' },
          {
            fieldId: 'part_description',
            value: values.description || undefined,
            fieldType: 'TEXT',
          },
          { fieldId: 'category', value: values.category || undefined, fieldType: 'TEXT' },
          { fieldId: 'hs_code', value: values.hsCode || undefined, fieldType: 'TEXT' },
          {
            fieldId: 'shopify_product_link_id',
            value: values.shopifyProductLinkId || undefined,
            fieldType: 'TEXT',
          },
        ]

        const success = await saveMultipleAsync(recordId, fieldValues)
        if (success) {
          onSuccess?.()
          onOpenChange(false)
        }
      } else {
        // Create mode: use record.create with systemAttribute keys
        const result = await createRecord.mutateAsync({
          entityDefinitionId: partDefId!,
          values: {
            part_title: values.title,
            part_sku: values.sku,
            part_description: values.description || undefined,
            category: values.category || undefined,
            hs_code: values.hsCode || undefined,
            shopify_product_link_id: values.shopifyProductLinkId || undefined,
          },
        })

        // Chain vendor part creation if supplier section is shown
        if (showSupplier && vendorPartValues.entityInstanceId && vendorPartDefId) {
          await createRecord.mutateAsync({
            entityDefinitionId: vendorPartDefId,
            values: {
              vendor_part_part: result.instance.id,
              vendor_part_contact: vendorPartValues.entityInstanceId,
              vendor_part_vendor_sku: vendorPartValues.vendorSku,
              vendor_part_unit_price: vendorPartValues.unitPrice,
              vendor_part_lead_time: vendorPartValues.leadTime,
              vendor_part_min_order_qty: vendorPartValues.minOrderQty,
              vendor_part_is_preferred: vendorPartValues.isPreferred,
            },
          })
        }

        onSuccess?.()
        onOpenChange(false)
      }
    } catch {
      // Errors handled by mutation onError
    }
  }

  // Handler for vendor part field changes
  const handleVendorPartChange = useCallback((field: keyof VendorPartFormValues, value: any) => {
    setVendorPartValues((prev) => ({ ...prev, [field]: value }))
    setVendorPartErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return prev
    })
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Part' : 'Create New Part'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Make changes to this part' : 'Add a new part to your inventory system'}
          </DialogDescription>
        </DialogHeader>

        <VarEditorField className='p-0 [&_[data-slot=field-row-label]]:w-50'>
          {/* Title */}
          <VarEditorFieldRow
            title='Title'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.title}
            validationType='error'>
            <ConstantInputAdapter
              value={values.title}
              onChange={(_, val) => handleChange('title', val)}
              varType={BaseType.STRING}
              placeholder='Part name'
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* SKU */}
          <VarEditorFieldRow
            title='SKU'
            description='This must be unique across all parts'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.sku}
            validationType='error'>
            <ConstantInputAdapter
              value={values.sku}
              onChange={(_, val) => handleChange('sku', val)}
              varType={BaseType.STRING}
              placeholder='Unique part number'
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* Category */}
          <VarEditorFieldRow title='Category' type={BaseType.STRING} showIcon>
            <ConstantInputAdapter
              value={values.category}
              onChange={(_, val) => handleChange('category', val)}
              varType={BaseType.STRING}
              placeholder='Category'
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* HS Code */}
          <VarEditorFieldRow
            title='HS Code'
            description='Harmonized System Code for customs'
            type={BaseType.STRING}
            showIcon>
            <ConstantInputAdapter
              value={values.hsCode}
              onChange={(_, val) => handleChange('hsCode', val)}
              varType={BaseType.STRING}
              placeholder='Harmonized System Code'
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* Shopify Product Link ID */}
          <VarEditorFieldRow
            title='Shopify Product ID'
            description='Link to a Shopify product'
            type={BaseType.STRING}
            showIcon>
            <ConstantInputAdapter
              value={values.shopifyProductLinkId}
              onChange={(_, val) => handleChange('shopifyProductLinkId', val)}
              varType={BaseType.STRING}
              placeholder='Shopify Product ID (optional)'
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* Description */}
          <VarEditorFieldRow title='Description' type={BaseType.STRING} showIcon>
            <ConstantInputAdapter
              value={values.description}
              onChange={(_, val) => handleChange('description', val)}
              varType={BaseType.STRING}
              placeholder='Enter a detailed description of the part'
              disabled={isPending}
              fieldOptions={{ string: { multiline: true } }}
            />
          </VarEditorFieldRow>
        </VarEditorField>

        {/* Collapsible Supplier Section - Only shown in create mode */}
        {!isEditMode && (
          <div className='border-t pt-4 mt-4'>
            <button
              type='button'
              onClick={() => setShowSupplier(!showSupplier)}
              className='flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors'>
              {showSupplier ? (
                <ChevronDown className='h-4 w-4' />
              ) : (
                <ChevronRight className='h-4 w-4' />
              )}
              Add Supplier (Optional)
            </button>

            {showSupplier && (
              <VarEditorField className='p-0 mt-4 [&_[data-slot=field-row-label]]:w-50'>
                <VendorPartFields
                  values={vendorPartValues}
                  onChange={handleVendorPartChange}
                  errors={vendorPartErrors}
                  disabled={isPending}
                />
              </VarEditorField>
            )}
          </div>
        )}

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
            loadingText={isEditMode ? 'Updating...' : 'Creating...'}
            disabled={!partDefId}
            data-dialog-submit>
            {isEditMode ? 'Update Part' : 'Create Part'} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
