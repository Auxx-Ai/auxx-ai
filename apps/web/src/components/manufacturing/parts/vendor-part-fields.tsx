// apps/web/src/components/manufacturing/parts/vendor-part-fields.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/lib/field-values/client'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { BaseType } from '~/components/workflow/types'

/**
 * Default values for vendor part form fields
 */
export const defaultVendorPartValues = {
  entityInstanceId: '',
  vendorSku: '',
  unitPrice: null as number | null,
  shippingCost: null as number | null,
  tariffRate: null as number | null,
  otherCost: null as number | null,
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
  const contactField = useSystemField('vendor_part_contact')

  return (
    <>
      {/* Supplier (company) Selection */}
      {showContactField && (
        <FieldPanelRow
          title='Supplier'
          isRequired
          validationError={errors?.entityInstanceId}
          validationType='error'>
          <FieldInputAdapter
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            fieldType={contactField?.fieldType ?? FieldType.RELATIONSHIP}
            fieldOptions={contactField?.options}
            value={values.entityInstanceId ? [toRecordId('company', values.entityInstanceId)] : []}
            onChange={(recordIds) => {
              const ids = recordIds as RecordId[]
              onChange('entityInstanceId', ids[0] ? getInstanceId(ids[0]) : '')
            }}
            placeholder='Select supplier...'
            disabled={disabled || disableContactEdit}
          />
        </FieldPanelRow>
      )}

      {/* Vendor SKU */}
      <FieldPanelRow
        title='Supplier SKU'
        description='The SKU or part number used by this supplier'
        type={BaseType.STRING}
        showIcon
        isRequired
        validationError={errors?.vendorSku}
        validationType='error'>
        <FieldInputAdapter
          fieldType={FieldType.TEXT}
          value={values.vendorSku}
          onChange={(val) => onChange('vendorSku', val)}
          placeholder="Supplier's part number"
          disabled={disabled}
        />
      </FieldPanelRow>

      {/* Unit Price */}
      <FieldPanelRow title='Unit Price' type={BaseType.CURRENCY} showIcon>
        <FieldInputAdapter
          fieldType={FieldType.CURRENCY}
          value={values.unitPrice}
          onChange={(val) => onChange('unitPrice', val)}
          placeholder='0.00'
          disabled={disabled}
          fieldOptions={{ currencyCode: 'USD' }}
        />
      </FieldPanelRow>

      {/* Tariff Rate */}
      <FieldPanelRow
        title='Tariff Rate (%)'
        description='Percentage of unit price'
        type={BaseType.NUMBER}
        showIcon>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={values.tariffRate}
          onChange={(val) => onChange('tariffRate', val)}
          placeholder='0'
          disabled={disabled}
        />
      </FieldPanelRow>

      {/* Shipping Cost */}
      <FieldPanelRow
        title='Shipping Cost'
        description='Per-unit shipping/freight'
        type={BaseType.CURRENCY}
        showIcon>
        <FieldInputAdapter
          fieldType={FieldType.CURRENCY}
          value={values.shippingCost}
          onChange={(val) => onChange('shippingCost', val)}
          placeholder='0.00'
          disabled={disabled}
          fieldOptions={{ currencyCode: 'USD' }}
        />
      </FieldPanelRow>

      {/* Other Cost */}
      <FieldPanelRow
        title='Other Cost'
        description='Insurance, brokerage, handling'
        type={BaseType.CURRENCY}
        showIcon>
        <FieldInputAdapter
          fieldType={FieldType.CURRENCY}
          value={values.otherCost}
          onChange={(val) => onChange('otherCost', val)}
          placeholder='0.00'
          disabled={disabled}
          fieldOptions={{ currencyCode: 'USD' }}
        />
      </FieldPanelRow>

      {/* Lead Time */}
      <FieldPanelRow
        title='Lead Time'
        description='Days to receive order'
        type={BaseType.NUMBER}
        showIcon>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={values.leadTime}
          onChange={(val) => onChange('leadTime', val)}
          placeholder='Days'
          disabled={disabled}
        />
      </FieldPanelRow>

      {/* Min Order Qty */}
      <FieldPanelRow
        title='Min Order'
        description='Minimum order quantity'
        type={BaseType.NUMBER}
        showIcon>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={values.minOrderQty}
          onChange={(val) => onChange('minOrderQty', val)}
          placeholder='Qty'
          disabled={disabled}
        />
      </FieldPanelRow>

      {/* Is Preferred */}
      <FieldPanelRow
        title='Preferred'
        description='Mark as preferred supplier for this part'
        type={BaseType.BOOLEAN}
        showIcon>
        <FieldInputAdapter
          fieldType={FieldType.CHECKBOX}
          value={values.isPreferred}
          onChange={(val) => onChange('isPreferred', val)}
          disabled={disabled}
          fieldOptions={{ variant: 'switch' }}
        />
      </FieldPanelRow>
    </>
  )
}
