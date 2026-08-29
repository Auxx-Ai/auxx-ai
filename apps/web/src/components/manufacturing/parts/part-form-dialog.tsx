// apps/web/src/components/manufacturing/parts/part-form-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { getInstanceId, PartKind, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
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
import { formatCurrency } from '@auxx/utils/currency'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceProperty } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import {
  buildOpeningStockInput,
  defaultOpeningStockValues,
  isOpeningStockEmpty,
  type OpeningStockFormValues,
  openingStockAccountLabel,
  validateOpeningStock,
} from './opening-stock-input'
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

/**
 * Synthetic relationship config for the ad-hoc Product picker (not backed by a
 * real field on this form) — the `subpart-dialog` pattern.
 */
const PRODUCT_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('product', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

/** Props for PartFormDialog component */
interface PartFormDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** RecordId for edit mode */
  recordId?: RecordId
  /** Callback on successful save */
  /** Called after a successful save. Carries the new instance id on CREATE
   *  so the caller can open what was just made; absent on edit. */
  onSuccess?: (instanceId?: string) => void
  /**
   * Product family to create this part into — prefills and LOCKS the Product
   * row (plans/products/09-variant-ui.md §3.1).
   *
   * CREATE mode only. In edit mode the Details panel owns `part.product`, and
   * two writers for one relation is exactly what D15 rejected for price.
   */
  productId?: string
}

/** Dialog for creating/editing a part */
export function PartFormDialog({
  open,
  onOpenChange,
  recordId,
  onSuccess,
  productId: lockedProductId,
}: PartFormDialogProps) {
  const isEditMode = !!recordId

  // Resolve entity definition IDs
  const partDefId = useResourceProperty('part', 'id')
  const productDefId = useResourceProperty('product', 'id')
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')
  const companyDefId = useResourceProperty('company', 'id')

  // Live field def for the Category TAGS input (sources existing option pool).
  // Def-scoped on purpose: bare `category` is owned by BOTH `part` and
  // `product`, and the bare tie-break resolves to whichever def id sorts first
  // — which is how this dialog once showed (and would have written!) the
  // products taxonomy's option ids into part records.
  const categoryField = useSystemField('category', partDefId)

  // The Kind select's preselection comes from the FIELD, not from a literal in
  // this file, so an org that changes the default gets it everywhere and there
  // is one source of truth for the fact (task 15 §4c).
  const partKindField = useSystemField('part_kind', partDefId)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

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
    productId: '',
    // Seeded from `part_kind`'s own `defaultValue` in the reset effect below.
    //
    // 🛑 Preselecting is NOT the silent default Gap C §3.2 rules out. That rule
    // asks for `part_kind` to be human-confirmed and auditable, and a value
    // shown in the form, before save, changeable in one click, IS confirmed —
    // the person saw it and pressed the button. A server-side fill on a key the
    // form never sent is what it refuses, because nobody was ever shown it.
    kind: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showSupplier, setShowSupplier] = useState(false)
  const [vendorPartValues, setVendorPartValues] =
    useState<VendorPartFormValues>(defaultVendorPartValues)
  const [vendorPartErrors, setVendorPartErrors] = useState<Record<string, string>>({})
  const [showOpeningStock, setShowOpeningStock] = useState(false)
  const [openingStockValues, setOpeningStockValues] =
    useState<OpeningStockFormValues>(defaultOpeningStockValues)
  const [openingStockErrors, setOpeningStockErrors] = useState<Record<string, string>>({})

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
          // Edit mode ignores the prop: the Details panel owns this relation.
          productId: '',
          kind: '',
        })
      } else if (!isEditMode) {
        setValues({
          title: '',
          description: '',
          sku: '',
          hsCode: '',
          category: [],
          productId: lockedProductId ?? '',
          kind: '',
        })
      }
      setErrors({})
      setShowSupplier(false)
      setVendorPartValues(defaultVendorPartValues)
      setVendorPartErrors({})
      setShowOpeningStock(false)
      setOpeningStockValues(defaultOpeningStockValues())
      setOpeningStockErrors({})
    }
  }, [open, isEditMode, systemValues, lockedProductId])

  // Preselect Kind from the field's own `defaultValue` (task 15 §4c).
  //
  // Kept out of the reset effect above on purpose: the field store hydrates
  // independently of this dialog, so the default can land AFTER somebody has
  // started typing, and re-running the reset then would wipe the form. This one
  // only ever fills a Kind that is still blank.
  //
  // The `?? ''` case is the field carrying no default, which is the state before
  // the registry sets one — the select simply shows its placeholder, as it did
  // before.
  useEffect(() => {
    if (!open || isEditMode) return
    const preselect = partKindField?.defaultValue
    if (typeof preselect !== 'string' || !preselect) return
    setValues((prev) => (prev.kind ? prev : { ...prev, kind: preselect }))
  }, [open, isEditMode, partKindField?.defaultValue])

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

    // The opening-stock section is optional as a whole and complete once opened
    // and answered: a quantity with no cost is not an opening balance, it is a
    // hand-valued adjustment, which §2.2 refuses outright.
    const osErrors =
      showOpeningStock && !isOpeningStockEmpty(openingStockValues)
        ? validateOpeningStock(openingStockValues)
        : {}
    setOpeningStockErrors(osErrors)

    return (
      Object.keys(newErrors).length === 0 &&
      Object.keys(vpErrors).length === 0 &&
      Object.keys(osErrors).length === 0
    )
  }

  // Create mutation via entity system
  const createRecord = api.record.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Error creating part', description: error.message })
    },
  })

  /**
   * The part's opening balance: one `initial` movement, its first standard cost.
   *
   * A separate procedure and a separate call on purpose — it is chained AFTER
   * the part exists (see `handleSubmit`), because a failure here leaves a part
   * somebody can open the drawer on and set stock for, while the reverse order
   * would leave a movement pointing at nothing.
   */
  const openStockBalance = api.purchasing.openStockBalance.useMutation({
    onError: (error) => {
      toastError({ title: 'Part created, opening stock failed', description: error.message })
    },
  })

  // Save field values for edit mode
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue({})

  const isPending = createRecord.isPending || isSavingFields || openStockBalance.isPending

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
            part_product:
              values.productId && productDefId
                ? toRecordId(productDefId, values.productId)
                : undefined,
            part_kind: values.kind || undefined,
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

        // Opening stock LAST, and never inside the try that would abandon the
        // rest: the part is already saved by now, so a refused opening balance
        // is a toast and a drawer to finish the job in, not a lost form.
        const openingStock =
          showOpeningStock && !isOpeningStockEmpty(openingStockValues)
            ? buildOpeningStockInput(result.instance.id, openingStockValues)
            : null
        if (openingStock) {
          try {
            await openStockBalance.mutateAsync(openingStock)
          } catch {
            // Surfaced by the mutation's onError. The part still stands.
          }
        }

        onSuccess?.(result.instance.id)
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

  // Handler for opening-stock field changes
  const handleOpeningStockChange = useCallback(
    (field: keyof OpeningStockFormValues, value: any) => {
      setOpeningStockValues((prev) => ({ ...prev, [field]: value }))
      setOpeningStockErrors((prev) => {
        if (prev[field]) {
          const next = { ...prev }
          delete next[field]
          return next
        }
        return prev
      })
    },
    []
  )

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

          {/* Product family — locked when the dialog was opened from a product.
              Create mode only: in edit mode the Details panel owns the relation. */}
          {!isEditMode && (
            <FieldPanelRow
              title='Product'
              description='Optional product family this part is a variant of'
              type={BaseType.RELATION}
              showIcon>
              <FieldInputAdapter
                fieldType={FieldType.RELATIONSHIP}
                value={
                  values.productId && productDefId
                    ? [toRecordId(productDefId, values.productId)]
                    : []
                }
                onChange={(value) => {
                  const recordIds = value as RecordId[]
                  const first = recordIds[0]
                  handleChange('productId', first ? getInstanceId(first) : '')
                }}
                triggerProps={{ className: 'ps-0 pe-1 w-full' }}
                placeholder='Select a product...'
                disabled={isPending || !!lockedProductId}
                fieldOptions={{
                  relationship: PRODUCT_RELATIONSHIP,
                  showDefinitionIcon: true,
                }}
              />
            </FieldPanelRow>
          )}

          {/* Kind — the GL classification. Preselected from the field's own
              `defaultValue`, visibly and changeably (see the effect above). */}
          {!isEditMode && (
            <FieldPanelRow
              title='Kind'
              description='Which inventory account this part belongs to'
              type={BaseType.ENUM}
              showIcon>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: PartKind.values }}
                triggerProps={{ className: 'ps-0 pe-1 w-full' }}
                value={values.kind}
                onChange={(val) => handleChange('kind', (Array.isArray(val) ? val[0] : val) ?? '')}
                placeholder='Select a kind...'
                disabled={isPending}
              />
            </FieldPanelRow>
          )}

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

        {/* Opening stock — the same collapsible-optional pattern as Supplier,
            chained into a second mutation after the part is created.

            Never gated on Kind (task 15 §2.2, "DECIDED: no gate"). A disabled
            section teaches nobody anything; naming the account the movement will
            be stamped with does, and somebody creating a lift who reads "Raw
            Materials" under it notices. */}
        {!isEditMode && (
          <div className='border-t pt-4 mt-4'>
            <button
              type='button'
              onClick={() => setShowOpeningStock(!showOpeningStock)}
              className='flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors'>
              {showOpeningStock ? (
                <ChevronDown className='h-4 w-4' />
              ) : (
                <ChevronRight className='h-4 w-4' />
              )}
              Add Opening Stock (Optional)
            </button>

            {showOpeningStock && (
              <>
                <FieldPanel
                  className='p-0 mt-4'
                  orientation='responsive'
                  breakpoint='md'
                  resizeId='part-form'
                  defaultLabelWidth={200}>
                  <FieldPanelRow
                    title='Quantity'
                    description='Units on hand at the opening date'
                    type={BaseType.NUMBER}
                    showIcon
                    validationError={openingStockErrors.quantity}
                    validationType='error'>
                    <FieldInputAdapter
                      fieldType={FieldType.NUMBER}
                      value={openingStockValues.quantity}
                      onChange={(val) => handleOpeningStockChange('quantity', val ?? null)}
                      placeholder='0'
                      disabled={isPending}
                    />
                  </FieldPanelRow>

                  <FieldPanelRow
                    title='Unit Cost'
                    description='What a unit cost when it was bought'
                    type={BaseType.CURRENCY}
                    showIcon
                    validationError={openingStockErrors.unitCost}
                    validationType='error'>
                    <FieldInputAdapter
                      fieldType={FieldType.CURRENCY}
                      fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                      value={openingStockValues.unitCost}
                      onChange={(val) => handleOpeningStockChange('unitCost', val ?? null)}
                      placeholder='0.00'
                      disabled={isPending}
                    />
                  </FieldPanelRow>

                  <FieldPanelRow
                    title='As of'
                    description='The accounting date, which is not when it was keyed'
                    type={BaseType.DATE}
                    showIcon>
                    <FieldInputAdapter
                      fieldType={FieldType.DATETIME}
                      value={openingStockValues.occurredAt}
                      onChange={(val) =>
                        handleOpeningStockChange(
                          'occurredAt',
                          (val as string) ?? new Date().toISOString()
                        )
                      }
                      disabled={isPending}
                    />
                  </FieldPanelRow>
                </FieldPanel>

                <OpeningStockConsequence
                  quantity={openingStockValues.quantity}
                  unitCost={openingStockValues.unitCost}
                  kind={values.kind}
                  currencyCode={currencyCode}
                />
              </>
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

/**
 * What the opening balance will actually do, in one sentence, live.
 *
 * 🛑 The account name is recomputed from the Kind select on every change, and it
 * is resolved through the SAME `resolveInventoryRoleForPartKind` the write uses
 * (via `openingStockAccountLabel`). This is the house pattern the complete-build
 * dialog uses for scrap: state the consequence at the input rather than block
 * the input. It matters more here because `stock_movement_gl_account` is frozen
 * at write time on an `updatable: false` row, so a finished good stamped raw
 * materials stays that way — the sentence is the only chance to catch it.
 */
function OpeningStockConsequence({
  quantity,
  unitCost,
  kind,
  currencyCode,
}: {
  quantity: number | null
  unitCost: number | null
  kind: string
  currencyCode: string
}) {
  const account = openingStockAccountLabel(kind || null)
  const units = quantity != null && quantity > 0 ? formatQuantity(quantity) : 'N'
  const each = unitCost != null && unitCost > 0 ? formatCurrency(unitCost, { currencyCode }) : '$X'

  return (
    <div className='mt-3 space-y-1 text-muted-foreground text-xs'>
      <p>
        Records {units} units at {each} into <span className='font-medium'>{account}</span>.
      </p>
      <p>
        This is the part&apos;s opening balance and its first standard cost, and it can only be set
        once.
      </p>
    </div>
  )
}

/** Trim a quantity's trailing zeros — `10` not `10.00`, `2.5` kept. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}
