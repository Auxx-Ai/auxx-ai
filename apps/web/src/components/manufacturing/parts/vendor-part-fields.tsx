// apps/web/src/components/manufacturing/parts/vendor-part-fields.tsx
'use client'

import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { toResourceId, getInstanceId, type ResourceId } from '@auxx/lib/field-values/client'

/**
 * Default values for vendor part form fields
 */
export const defaultVendorPartValues = {
  contactId: '',
  vendorSku: '',
  unitPrice: null as number | null,
  leadTime: null as number | null,
  minOrderQty: null as number | null,
  isPreferred: false,
}

/**
 * Type for vendor part form values
 */
export type VendorPartFormValues = typeof defaultVendorPartValues

/**
 * Props for VendorPartFields component
 */
interface VendorPartFieldsProps {
  /** Current form values */
  values: VendorPartFormValues
  /** Handler for field changes */
  onChange: (field: keyof VendorPartFormValues, value: any) => void
  /** Validation errors by field name */
  errors?: Record<string, string>
  /** Whether the form is disabled */
  disabled?: boolean
  /** Whether to disable the contact selection (for edit mode) */
  disableContactEdit?: boolean
  /** Whether to show the contact field (false for contact-centric mode) */
  showContactField?: boolean
}

/**
 * Shared form fields for vendor part creation/editing
 */
export function VendorPartFields({
  values,
  onChange,
  errors,
  disabled,
  disableContactEdit,
  showContactField = true,
}: VendorPartFieldsProps) {
  return (
    <>
      {/* Contact Selection */}
      {showContactField && (
        <VarEditorFieldRow
          title="Vendor"
          isRequired
          validationError={errors?.contactId}
          validationType="error">
          <MultiRelationInput
            entityDefinitionId="contact"
            value={values.contactId ? [toResourceId('contact', values.contactId)] : []}
            onChange={(resourceIds: ResourceId[]) => onChange('contactId', resourceIds[0] ? getInstanceId(resourceIds[0]) : '')}
            placeholder="Select contact..."
            disabled={disabled || disableContactEdit}
            multi={false}
          />
        </VarEditorFieldRow>
      )}

      {/* Vendor SKU */}
      <VarEditorFieldRow
        title="Supplier SKU"
        description="The SKU or part number used by this supplier"
        type={BaseType.STRING}
        showIcon
        isRequired
        validationError={errors?.vendorSku}
        validationType="error">
        <ConstantInputAdapter
          value={values.vendorSku}
          onChange={(_, val) => onChange('vendorSku', val)}
          varType={BaseType.STRING}
          placeholder="Supplier's part number"
          disabled={disabled}
        />
      </VarEditorFieldRow>

      {/* Unit Price */}
      <VarEditorFieldRow title="Unit Price" type={BaseType.CURRENCY} showIcon>
        <ConstantInputAdapter
          value={values.unitPrice}
          onChange={(_, val) => onChange('unitPrice', val)}
          varType={BaseType.CURRENCY}
          placeholder="0.00"
          disabled={disabled}
          fieldOptions={{ currency: { currencyCode: 'USD' } }}
        />
      </VarEditorFieldRow>

      {/* Lead Time */}
      <VarEditorFieldRow
        title="Lead Time"
        description="Days to receive order"
        type={BaseType.NUMBER}
        showIcon>
        <ConstantInputAdapter
          value={values.leadTime}
          onChange={(_, val) => onChange('leadTime', val)}
          varType={BaseType.NUMBER}
          placeholder="Days"
          disabled={disabled}
        />
      </VarEditorFieldRow>

      {/* Min Order Qty */}
      <VarEditorFieldRow
        title="Min Order"
        description="Minimum order quantity"
        type={BaseType.NUMBER}
        showIcon>
        <ConstantInputAdapter
          value={values.minOrderQty}
          onChange={(_, val) => onChange('minOrderQty', val)}
          varType={BaseType.NUMBER}
          placeholder="Qty"
          disabled={disabled}
        />
      </VarEditorFieldRow>

      {/* Is Preferred */}
      <VarEditorFieldRow
        title="Preferred"
        description="Mark as preferred supplier for this part"
        type={BaseType.BOOLEAN}
        showIcon>
        <ConstantInputAdapter
          value={values.isPreferred}
          onChange={(_, val) => onChange('isPreferred', val)}
          varType={BaseType.BOOLEAN}
          disabled={disabled}
          fieldOptions={{ variant: 'switch' }}
        />
      </VarEditorFieldRow>
    </>
  )
}
