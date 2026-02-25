// apps/web/src/components/manufacturing/parts/part-form-dialog.tsx
'use client'

import type { PartEntity as Part } from '@auxx/database/types'
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
import { BaseType } from '~/components/workflow/types'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import {
  defaultVendorPartValues,
  VendorPartFields,
  type VendorPartFormValues,
} from './vendor-part-fields'

/** Props for PartFormDialog component */
interface PartFormDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Part to edit (null for create mode) */
  part?: Part | null
  /** Callback on successful save */
  onSuccess?: () => void
}

/** Dialog for creating/editing a part */
export function PartFormDialog({ open, onOpenChange, part, onSuccess }: PartFormDialogProps) {
  const utils = api.useUtils()
  const isEditMode = !!part

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
      setValues({
        title: part?.title ?? '',
        description: part?.description ?? '',
        sku: part?.sku ?? '',
        hsCode: part?.hsCode ?? '',
        category: part?.category ?? '',
        shopifyProductLinkId: part?.shopifyProductLinkId ?? '',
      })
      setErrors({})
      setShowSupplier(false)
      setVendorPartValues(defaultVendorPartValues)
      setVendorPartErrors({})
    }
  }, [open, part])

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

  // Mutations
  const createPart = api.part.create.useMutation({
    onSuccess: () => {
      utils.part.all.invalidate()
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error creating part', description: error.message })
    },
  })

  const updatePart = api.part.update.useMutation({
    onSuccess: () => {
      utils.part.all.invalidate()
      if (part?.id) {
        utils.part.byId.invalidate({ id: part.id })
      }
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error updating part', description: error.message })
    },
  })

  const isPending = createPart.isPending || updatePart.isPending

  // Submit
  const handleSubmit = async () => {
    if (!validate()) return

    if (isEditMode && part?.id) {
      await updatePart.mutateAsync({ ...values, id: part.id })
    } else {
      await createPart.mutateAsync({
        ...values,
        vendorPart: showSupplier ? vendorPartValues : undefined,
      })
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
            data-dialog-submit>
            {isEditMode ? 'Update Part' : 'Create Part'} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
