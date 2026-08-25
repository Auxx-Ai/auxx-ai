// apps/web/src/components/manufacturing/parts/part-form-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
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
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { PartInventoryLinkRows } from '~/components/inventory-bridge/ui/part-inventory-link-rows'
import { useResourceProperty } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BaseType } from '~/components/workflow/types'
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

  // Resolve entity definition IDs
  const partDefId = useResourceProperty('part', 'id')
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')
  const companyDefId = useResourceProperty('company', 'id')

  // Live field def for the Category TAGS input (sources existing option pool).
  // Def-scoped on purpose: bare `category` is owned by BOTH `part` and
  // `product`, and the bare tie-break resolves to whichever def id sorts first
  // — which is how this dialog once showed (and would have written!) the
  // products taxonomy's option ids into part records.
  const categoryField = useSystemField('category', partDefId)

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
    category: [] as string[],
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
          // TAGS reads back as an array of option ids
          category: Array.isArray(systemValues.category) ? (systemValues.category as string[]) : [],
        })
      } else if (!isEditMode) {
        setValues({
          title: '',
          description: '',
          sku: '',
          hsCode: '',
          category: [],
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
      if (!vendorPartValues.entityInstanceId) vpErrors.entityInstanceId = 'Supplier is required'
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
        const fieldValues = [
          { fieldId: 'part_title', value: values.title, fieldType: FieldType.TEXT },
          { fieldId: 'part_sku', value: values.sku, fieldType: FieldType.TEXT },
          {
            fieldId: 'part_description',
            value: values.description || undefined,
            fieldType: FieldType.TEXT,
          },
          { fieldId: 'category', value: values.category, fieldType: FieldType.TAGS },
          { fieldId: 'hs_code', value: values.hsCode || undefined, fieldType: FieldType.TEXT },
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
            category: values.category.length ? values.category : undefined,
            hs_code: values.hsCode || undefined,
          },
        })

        // Chain vendor part creation if supplier section is shown
        if (showSupplier && vendorPartValues.entityInstanceId && vendorPartDefId) {
          await createRecord.mutateAsync({
            entityDefinitionId: vendorPartDefId,
            values: {
              vendor_part_part: toRecordId(partDefId!, result.instance.id),
              vendor_part_contact: toRecordId(companyDefId!, vendorPartValues.entityInstanceId),
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

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='part-form'
          defaultLabelWidth={200}
          className='p-0'>
          {/* Title */}
          <FieldPanelRow
            title='Title'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.title}
            validationType='error'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.title}
              onChange={(val) => handleChange('title', val)}
              placeholder='Part name'
              disabled={isPending}
            />
          </FieldPanelRow>

          {/* SKU */}
          <FieldPanelRow
            title='SKU'
            description='This must be unique across all parts'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.sku}
            validationType='error'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.sku}
              onChange={(val) => handleChange('sku', val)}
              placeholder='Unique part number'
              disabled={isPending}
            />
          </FieldPanelRow>

          {/* Category — inline TAGS (free-form, multi-value) */}
          <FieldPanelRow title='Category' type={BaseType.TAGS} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TAGS}
              fieldOptions={categoryField?.options}
              resourceFieldId={categoryField?.resourceFieldId}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              value={values.category}
              onChange={(val) => handleChange('category', val)}
              placeholder='Add categories'
              disabled={isPending}
            />
          </FieldPanelRow>

          {/* HS Code */}
          <FieldPanelRow
            title='HS Code'
            description='Harmonized System Code for customs'
            type={BaseType.STRING}
            showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.hsCode}
              onChange={(val) => handleChange('hsCode', val)}
              placeholder='Harmonized System Code'
              disabled={isPending}
            />
          </FieldPanelRow>

          {/* Description */}
          <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.description}
              onChange={(val) => handleChange('description', val)}
              placeholder='Enter a detailed description of the part'
              disabled={isPending}
              fieldOptions={{ multiline: true }}
            />
          </FieldPanelRow>

          {/* Linked inventory sources — edit mode only (a link needs the part instance) */}
          {isEditMode && recordId && (
            <PartInventoryLinkRows
              partId={parseRecordId(recordId).entityInstanceId}
              disabled={isPending}
            />
          )}
        </FieldPanel>

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
              <FieldPanel
                className='p-0 mt-4'
                orientation='responsive'
                breakpoint='md'
                resizeId='part-form'
                defaultLabelWidth={200}>
                <VendorPartFields
                  values={vendorPartValues}
                  onChange={handleVendorPartChange}
                  errors={vendorPartErrors}
                  disabled={isPending}
                />
              </FieldPanel>
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
