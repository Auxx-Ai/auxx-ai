// apps/web/src/components/manufacturing/parts/vendor-part-fields.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/lib/field-values/client'
import Link from 'next/link'
import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { BaseType } from '~/components/workflow/types'
import { useOfferTariffs } from '../hooks/use-offer-tariffs'
import { OfferTariffReadout } from '../ui/offer-tariff-readout'

/**
 * Default values for vendor part form fields
 */
export const defaultVendorPartValues = {
  entityInstanceId: '',
  vendorSku: '',
  unitPrice: null as number | null,
  shippingCost: null as number | null,
  /** `tariff_code` instance id. The classification and origin the duty resolves from. */
  tariffCodeId: null as string | null,
  /** The OVERRIDE. `null` means "use the schedule" (29 §3.1). */
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
  /**
   * The part's free-text `hsCode`, when the host knows it. Shown as a hint
   * under the code picker so the person can find the right origin for it -
   * the picker cannot be pre-searched, and the field itself is read by nothing
   * (29 §0.1, 30 §3.6).
   */
  partHsCode?: string | null
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
  partHsCode,
}: VendorPartFieldsProps) {
  const contactField = useSystemField('vendor_part_contact')
  const tariffCodeField = useSystemField('vendor_part_tariff_code')

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
            fieldOptions={{ ...contactField?.options, showDefinitionIcon: true }}
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

      {/* Vendor SKU — optional; identity is the (part, supplier) pair above */}
      <FieldPanelRow
        title='Supplier SKU'
        description='The SKU or part number used by this supplier'
        type={BaseType.STRING}
        showIcon
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

      {/* Tariff — three rows where there was one (30 §3.1). The code sets the
          duty from the schedule; the rate is the OVERRIDE; the readout is the
          only feedback that the code picked actually has rates behind it. */}
      <FieldPanelRow
        title='Tariff code'
        description='Classification and country of origin. Sets the duty from the schedule.'
        type={BaseType.RELATION}
        showIcon>
        <FieldInputAdapter
          triggerProps={{ className: 'w-full ps-0 pe-1' }}
          fieldType={tariffCodeField?.fieldType ?? FieldType.RELATIONSHIP}
          fieldOptions={tariffCodeField?.options}
          value={values.tariffCodeId ? [toRecordId('tariff_code', values.tariffCodeId)] : []}
          onChange={(recordIds) => {
            const ids = recordIds as RecordId[]
            onChange('tariffCodeId', ids[0] ? getInstanceId(ids[0]) : null)
          }}
          placeholder='Select tariff code...'
          disabled={disabled}
        />
        <TariffCodeHint tariffCodeId={values.tariffCodeId} partHsCode={partHsCode} />
      </FieldPanelRow>

      <FieldPanelRow
        title='Override rate (%)'
        description='Leave blank to use the schedule. Set it for a DDP price that already includes duty, a Section 301 exclusion, or an unclassified part.'
        type={BaseType.NUMBER}
        showIcon>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={values.tariffRate}
          onChange={(val) => onChange('tariffRate', val)}
          placeholder='Schedule'
          disabled={disabled}
        />
      </FieldPanelRow>

      <FieldPanelRow title='Duty' type={BaseType.NUMBER} showIcon>
        <DutyRow tariffCodeId={values.tariffCodeId} tariffRate={values.tariffRate} />
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

/** The form's own draft, resolved through the shared seam like any saved offer. */
function DutyRow({
  tariffCodeId,
  tariffRate,
}: {
  tariffCodeId: string | null
  tariffRate: number | null
}) {
  const offers = useMemo(
    () => [{ id: 'draft', tariffCodeId, tariffRate }],
    [tariffCodeId, tariffRate]
  )
  const { byId, scheduleById, codeLabelById, unavailable } = useOfferTariffs(offers)
  const tariff = byId.get('draft')
  if (!tariff) return null
  return (
    <OfferTariffReadout
      tariff={tariff}
      scheduleTariff={scheduleById.get('draft')}
      codeLabel={tariffCodeId ? codeLabelById.get(tariffCodeId) : undefined}
      unavailable={unavailable}
    />
  )
}

/**
 * Under the code picker: the empty-state link when the org has no codes yet
 * (an empty picker is a dead control), or the part's free-text HS code as a
 * search hint when no code is chosen yet.
 */
function TariffCodeHint({
  tariffCodeId,
  partHsCode,
}: {
  tariffCodeId: string | null
  partHsCode?: string | null
}) {
  const { hasCodes, isLoading } = useOfferTariffs(NO_OFFERS)
  if (isLoading) return null
  if (!hasCodes) {
    return (
      <p className='mt-1 text-muted-foreground text-xs'>
        No tariff codes yet.{' '}
        <Link
          href='/app/parts/settings/tariffs'
          className='underline underline-offset-2 hover:text-foreground'>
          Add them in Parts &rsaquo; Settings &rsaquo; Tariffs
        </Link>
      </p>
    )
  }
  if (!tariffCodeId && partHsCode?.trim()) {
    return (
      <p className='mt-1 text-muted-foreground text-xs'>
        The part's HS code is <span className='tabular-nums'>{partHsCode.trim()}</span> - search for
        it and pick the country of origin.
      </p>
    )
  }
  return null
}

const NO_OFFERS: never[] = []
