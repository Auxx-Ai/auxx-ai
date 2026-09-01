// apps/web/src/components/manufacturing/parts/vendor-part-fields.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { SegmentedControl } from '@auxx/ui/components/segmented-control'
import { formatCurrency, RATE_DECIMALS, roundMinor } from '@auxx/utils/currency'
import Link from 'next/link'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { TooltipExplanation } from '~/components/global/tooltip'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { BaseType } from '~/components/workflow/types'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'
import { useOfferTariffs } from '../hooks/use-offer-tariffs'
import { OfferTariffReadout } from '../ui/offer-tariff-readout'

/**
 * Default values for vendor part form fields
 */
export const defaultVendorPartValues = {
  /** The part, when the host lets the person pick one (company-centric mode). */
  partId: '',
  /** The supplier company. */
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
  /**
   * `vendor_part_purchase_unit` - the vendor's selling unit, free text
   * ('thousand', 'box of 500', 'kg'). B-lite, plans/money/tasks/31-sub-cent-rates.md
   * §2.9. `null` means the vendor sells by the each.
   */
  purchaseUnit: null as string | null,
  /**
   * `vendor_part_purchase_ratio` - tracking units per purchase unit (`1000`,
   * `500`, `453.592`). `null` or `1` means the vendor sells by the each - the
   * ordinary case, where `unitPrice` above is the whole story.
   */
  purchaseRatio: null as number | null,
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
  /** Whether to show the supplier picker (false for company-centric mode) */
  showContactField?: boolean
  /** Whether to disable the supplier picker (for edit mode) */
  disableContactEdit?: boolean
  /** Whether to show the part picker (true for company-centric mode) */
  showPartField?: boolean
  /** Whether to disable the part picker (for edit mode) */
  disablePartEdit?: boolean
  /**
   * The part's free-text `hsCode`, when the host knows it. Shown as a hint
   * under the code picker so the person can find the right origin for it -
   * the picker cannot be pre-searched, and the field itself is read by nothing
   * (29 §0.1, 30 §3.6).
   */
  partHsCode?: string | null
  /**
   * Shared with every other panel on the host form, so the label column drags
   * together (`docs/ui-design-guide.md` §5).
   */
  resizeId: string
  /** Label column width for the horizontal panels. */
  defaultLabelWidth?: number
}

/**
 * Shared form for a supplier offer: who supplies it, what they charge and in
 * what unit, and what duty it carries. Owns its own panels; the host only
 * supplies values and a change handler.
 */
export function VendorPartFields({
  values,
  onChange,
  errors,
  disabled,
  showContactField = true,
  disableContactEdit,
  showPartField = false,
  disablePartEdit,
  partHsCode,
  resizeId,
  defaultLabelWidth,
}: VendorPartFieldsProps) {
  const contactField = useSystemField('vendor_part_contact')
  const partField = useSystemField('vendor_part_part')
  const tariffCodeField = useSystemField('vendor_part_tariff_code')

  const panelProps = {
    className: 'p-0',
    breakpoint: 'md' as const,
    resizeId,
    defaultLabelWidth,
  }

  return (
    <div className='space-y-3'>
      <FieldPanel {...panelProps}>
        {showPartField && (
          <FieldPanelRow
            title='Part'
            isRequired
            validationError={errors?.partId}
            validationType='error'>
            <FieldInputAdapter
              fieldType={partField?.fieldType ?? FieldType.RELATIONSHIP}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              fieldOptions={partField?.options}
              value={values.partId ? [toRecordId('part', values.partId)] : []}
              onChange={(recordIds) => {
                const ids = recordIds as RecordId[]
                onChange('partId', ids[0] ? getInstanceId(ids[0]) : '')
              }}
              placeholder='Select part...'
              disabled={disabled || disablePartEdit}
            />
          </FieldPanelRow>
        )}

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
              value={
                values.entityInstanceId ? [toRecordId('company', values.entityInstanceId)] : []
              }
              onChange={(recordIds) => {
                const ids = recordIds as RecordId[]
                onChange('entityInstanceId', ids[0] ? getInstanceId(ids[0]) : '')
              }}
              placeholder='Select supplier...'
              disabled={disabled || disableContactEdit}
            />
          </FieldPanelRow>
        )}

        {/* Optional; identity is the (part, supplier) pair above */}
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

        <FieldPanelRow
          title='Lead Time'
          description='Days to receive order'
          type={BaseType.NUMBER}
          showIcon>
          <FieldInputAdapter
            fieldType={FieldType.NUMBER}
            value={values.leadTime}
            onChange={(val) => onChange('leadTime', val ?? null)}
            placeholder='Days'
            disabled={disabled}
          />
        </FieldPanelRow>

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
      </FieldPanel>

      <PricingPanel values={values} onChange={onChange} disabled={disabled} {...panelProps} />

      {/* Tariff - three rows (30 §3.1). The code sets the duty from the
          schedule; the rate is the OVERRIDE; the readout is the only feedback
          that the code picked actually has rates behind it. */}
      <FieldPanel {...panelProps}>
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
            onChange={(val) => onChange('tariffRate', val ?? null)}
            placeholder='Schedule'
            disabled={disabled}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Duty' type={BaseType.NUMBER} showIcon>
          <DutyRow tariffCodeId={values.tariffCodeId} tariffRate={values.tariffRate} />
        </FieldPanelRow>
      </FieldPanel>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

/** The offer's money-per-unit fields. All stored per each, all rates (31 §2.2). */
const MONEY_FIELDS = ['unitPrice', 'shippingCost', 'otherCost'] as const
type MoneyField = (typeof MONEY_FIELDS)[number]

/**
 * What the person typed, in the vendor's unit, while the panel is in pack mode.
 *
 * The stored fields are always per each; these are the per-pack figures they
 * were divided out of. Kept locally so a pack price typed before the ratio is
 * reinterpreted once the ratio lands (rather than stored per each and then
 * multiplied back up), and so `$1.00 per 3` keeps reading `1.00` instead of the
 * `0.99999` its stored per-each re-multiplies to.
 */
interface PackDrafts {
  unitPrice: number | null
  shippingCost: number | null
  otherCost: number | null
  minOrderQty: number | null
}

const CURRENCY_OPTIONS = { currencyCode: 'USD', decimals: RATE_DECIMALS }

function isPackRatio(ratio: number | null): ratio is number {
  return ratio !== null && Number.isFinite(ratio) && ratio > 1
}

/** Five places, enough for a kg ratio without float noise. */
function roundQty(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

/** Per-pack figures from the stored per-each ones. */
function seedDrafts(values: VendorPartFormValues): PackDrafts {
  const factor = isPackRatio(values.purchaseRatio) ? values.purchaseRatio : 1
  const scale = (v: number | null) => (v === null ? null : roundMinor(v * factor, RATE_DECIMALS))
  return {
    unitPrice: scale(values.unitPrice),
    shippingCost: scale(values.shippingCost),
    otherCost: scale(values.otherCost),
    minOrderQty: values.minOrderQty === null ? null : roundQty(values.minOrderQty / factor),
  }
}

interface PricingPanelProps extends Pick<VendorPartFieldsProps, 'resizeId' | 'defaultLabelWidth'> {
  values: VendorPartFormValues
  onChange: VendorPartFieldsProps['onChange']
  disabled?: boolean
  className?: string
  breakpoint?: 'sm' | 'md'
}

/**
 * Price, freight, other cost and minimum order, entered either per each or in
 * the vendor's own unit (B-lite, 31 §2.9).
 *
 * Pack mode is an ENTRY conversion. Every input reads in the purchase unit and
 * the per-each figure the calculator will see is the readout beside it. The
 * stored fields never change meaning: stock, BOM lines, the PO line and the
 * roll all keep reading per each. Freight here is the buyer's own per-unit
 * estimate; the real freight on an order is allocated from the bill.
 */
function PricingPanel({ values, onChange, disabled, ...panelProps }: PricingPanelProps) {
  const [packMode, setPackMode] = useState(() => isPackRatio(values.purchaseRatio))
  const [drafts, setDrafts] = useState<PackDrafts>(() => seedDrafts(values))

  // Edit mode loads its values after mount. A ratio that arrives from outside
  // switches the panel to pack mode and seeds the drafts from what is stored.
  useEffect(() => {
    if (!packMode && isPackRatio(values.purchaseRatio)) {
      setPackMode(true)
      setDrafts(seedDrafts(values))
    }
  }, [packMode, values])

  const factor = isPackRatio(values.purchaseRatio) ? values.purchaseRatio : 1
  const unitLabel = values.purchaseUnit?.trim() || 'purchase unit'

  const setMode = (pack: boolean) => {
    if (pack === packMode) return
    setPackMode(pack)
    if (pack) {
      setDrafts(seedDrafts(values))
    } else {
      // The stored figures are already per each; only the pack goes.
      onChange('purchaseUnit', null)
      onChange('purchaseRatio', null)
    }
  }

  const writeMoney = (field: MoneyField, typed: number | null) => {
    if (!packMode) {
      onChange(field, typed)
      return
    }
    setDrafts((d) => ({ ...d, [field]: typed }))
    onChange(field, typed === null ? null : roundMinor(typed / factor, RATE_DECIMALS))
  }

  const writeMinOrder = (typed: number | null) => {
    if (!packMode) {
      onChange('minOrderQty', typed)
      return
    }
    setDrafts((d) => ({ ...d, minOrderQty: typed }))
    onChange('minOrderQty', typed === null ? null : roundQty(typed * factor))
  }

  // A new ratio re-derives every stored figure from what was typed, so the
  // typed pack price is what survives, not the stale per-each one.
  const writeRatio = (next: number | null) => {
    onChange('purchaseRatio', next)
    const f = isPackRatio(next) ? next : 1
    for (const field of MONEY_FIELDS) {
      const draft = drafts[field]
      onChange(field, draft === null ? null : roundMinor(draft / f, RATE_DECIMALS))
    }
    onChange('minOrderQty', drafts.minOrderQty === null ? null : roundQty(drafts.minOrderQty * f))
  }

  const moneyColumn = (field: MoneyField, title: string, description?: string) => (
    <PricingColumn
      title={title}
      description={description}
      type={BaseType.CURRENCY}
      unit={packMode ? `per ${unitLabel}` : 'each'}
      readout={
        packMode && values[field] !== null
          ? `${formatCurrency(values[field], { decimals: RATE_DECIMALS })} each`
          : undefined
      }>
      <FieldInputAdapter
        fieldType={FieldType.CURRENCY}
        // The symbol prefix carries its own start padding; flush it with the label.
        triggerProps={{ className: '[&_span:first-child]:ps-0' }}
        fieldOptions={CURRENCY_OPTIONS}
        value={packMode ? drafts[field] : values[field]}
        onChange={(val) => writeMoney(field, (val as number | null) ?? null)}
        placeholder='0.00'
        disabled={disabled}
      />
    </PricingColumn>
  )

  return (
    <FieldPanel {...panelProps}>
      <FieldPanelRow
        title='Sold'
        description='Per pack when the supplier quotes in their own unit - per thousand, per box, per kg. Everything typed below is then in that unit, and the per-each figure the cost calculator sees is shown beside it.'>
        <div className='flex h-8 items-center'>
          <SegmentedControl
            mode='toggle'
            toggleMode='single'
            isPill
            value={[packMode ? 1 : 0]}
            onChange={(indices) => {
              if (indices.length) setMode(indices[0] === 1)
            }}>
            <Button variant='transparent' size='xs' disabled={disabled} className={MODE_BUTTON}>
              Per each
            </Button>
            <Button variant='transparent' size='xs' disabled={disabled} className={MODE_BUTTON}>
              Per pack
            </Button>
          </SegmentedControl>
        </div>
      </FieldPanelRow>

      {packMode && (
        <FieldPanelRow
          title='Pack'
          description="How this supplier packs the part. Stock, BOM lines and the purchase order line stay in each; this only converts what's typed here and on the PO line."
          type={BaseType.STRING}
          showIcon>
          <Sentence>
            <Word>1</Word>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              triggerProps={{ className: 'w-20' }}
              value={values.purchaseUnit ?? ''}
              onChange={(val) => onChange('purchaseUnit', (val as string) || null)}
              placeholder='thousand'
              disabled={disabled}
            />
            <Word>=</Word>
            <FieldInputAdapter
              fieldType={FieldType.NUMBER}
              triggerProps={{ className: 'w-20' }}
              value={values.purchaseRatio}
              onChange={(val) => writeRatio((val as number | null) ?? null)}
              placeholder='1000'
              disabled={disabled}
            />
            <Word>each</Word>
          </Sentence>
        </FieldPanelRow>
      )}

      {/* One block, four columns: label, input, unit, per-each readout. Carries
          the row slot so the panel's border rules treat it as a row. */}
      <div data-slot='field-row' className='border-b'>
        <div className='grid w-full grid-cols-2 gap-x-3 gap-y-3 px-2 py-2 sm:grid-cols-4'>
          {moneyColumn('unitPrice', 'Price')}
          {moneyColumn(
            'shippingCost',
            'Shipping',
            'Your own per-unit freight estimate, for costing'
          )}
          {moneyColumn('otherCost', 'Other', 'Insurance, brokerage, handling')}
          <PricingColumn
            title='Min order'
            description='Minimum order quantity'
            type={BaseType.NUMBER}
            unit={packMode ? unitLabel : 'each'}
            readout={
              packMode && values.minOrderQty !== null
                ? `${values.minOrderQty.toLocaleString()} each`
                : undefined
            }>
            <FieldInputAdapter
              fieldType={FieldType.NUMBER}
              value={packMode ? drafts.minOrderQty : values.minOrderQty}
              onChange={(val) => writeMinOrder((val as number | null) ?? null)}
              placeholder='Qty'
              disabled={disabled}
            />
          </PricingColumn>
        </div>
      </div>
    </FieldPanel>
  )
}

interface PricingColumnProps {
  title: string
  description?: string
  type: BaseType
  /** What the input is in: `each`, `per thousand`. */
  unit: string
  /** The stored per-each figure, shown only when it differs from what was typed. */
  readout?: string
  children: ReactNode
}

/** Label over input over unit, the same label styling as a `FieldPanelRow`. */
function PricingColumn({ title, description, type, unit, readout, children }: PricingColumnProps) {
  return (
    <div className='flex min-w-0 flex-col'>
      <div className='flex items-center gap-1 text-sm [&_svg]:size-4'>
        <VarTypeIcon type={type} />
        <span className='text-primary-600'>{title}</span>
        {description && <TooltipExplanation text={description} />}
      </div>
      {/* Fixed height: the number input's stepper is taller than the currency
          group, and the unit lines below must sit on one baseline. */}
      <div className='flex h-8 items-center [&>*]:w-full'>{children}</div>
      <div className='text-muted-foreground text-xs'>{unit}</div>
      {readout && <div className='text-muted-foreground text-xs tabular-nums'>{readout}</div>}
    </div>
  )
}

const MODE_BUTTON =
  'aria-checked:inset-shadow-black/20 rounded-full aria-checked:bg-info aria-checked:to-info aria-checked:from-info aria-checked:text-white duration-0'

/** Inputs and connector words on one wrapping line. */
function Sentence({ children }: { children: ReactNode }) {
  return (
    <div className='flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 pe-2 text-sm'>
      {children}
    </div>
  )
}

function Word({ children }: { children: ReactNode }) {
  return <span className='text-muted-foreground'>{children}</span>
}

// ─────────────────────────────────────────────────────────────────────────────
// Duty
// ─────────────────────────────────────────────────────────────────────────────

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
