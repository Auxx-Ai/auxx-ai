// apps/web/src/components/purchasing/intake/ui/intake-header-panel.tsx
'use client'

// The proposed order's header, and the totals confrontation beside it
// (plans/money/tasks/38 §3.1 / §6.2).

import { FieldType } from '@auxx/database/enums'
import {
  type IntakeDraftPayload,
  lineSumCents,
  parseIntakeTotal,
  rateRoundingAllowance,
} from '@auxx/lib/purchasing/intake/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { cn } from '@auxx/ui/lib/utils'
import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { CurrencyCellInput } from '~/components/money/ui/line-builder/line-rows'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { BaseType } from '~/components/workflow/types'

/**
 * Ad-hoc vendor picker, the `build-form-dialog` / `subpart-dialog` pattern.
 *
 * 🛑 `company`, NOT `contact`. `purchase_order_vendor` declares
 * `relationshipConfig.relatedEntityType: 'company'`
 * (`purchase-order-fields.ts:110`), and so does `vendor_part_contact` despite its
 * name. A contact RecordId in `IntakeDraftPayload.vendorRecordId` would survive
 * the whole review screen and then be rejected at the create path on commit,
 * which is the worst possible moment to find out.
 */
const VENDOR_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('company', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

interface IntakeHeaderPanelProps {
  payload: IntakeDraftPayload
  onUpdate: (next: (current: IntakeDraftPayload) => IntakeDraftPayload) => void
}

export function IntakeHeaderPanel({ payload, onUpdate }: IntakeHeaderPanelProps) {
  const vendorValue = useMemo(
    () => (payload.vendorRecordId ? [payload.vendorRecordId] : []),
    [payload.vendorRecordId]
  )

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]'>
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='intake-header'
        defaultLabelWidth={150}
        className='p-0'>
        <FieldPanelRow
          title='Vendor'
          type={BaseType.RELATION}
          showIcon
          isRequired
          description='Who the order goes to'>
          <FieldInputAdapter
            fieldType={FieldType.RELATIONSHIP}
            value={vendorValue}
            onChange={(value) => {
              const first = (value as RecordId[])[0] ?? null
              onUpdate((current) => ({ ...current, vendorRecordId: first }))
            }}
            triggerProps={{ className: 'ps-0 pe-1 w-full' }}
            placeholder='Select a vendor...'
            fieldOptions={{
              relationship: VENDOR_RELATIONSHIP,
              showDefinitionIcon: true,
              showSecondary: true,
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Quote number' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={payload.quoteNumber ?? ''}
            onChange={(val) =>
              onUpdate((current) => ({ ...current, quoteNumber: (val as string) || null }))
            }
            placeholder="The vendor's own reference"
          />
        </FieldPanelRow>

        <FieldPanelRow title='Quote date' type={BaseType.DATE} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.DATE}
            value={payload.quoteDate}
            onChange={(val) =>
              onUpdate((current) => ({ ...current, quoteDate: (val as string) || null }))
            }
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Expected delivery'
          type={BaseType.DATE}
          showIcon
          description='When the vendor said it lands'>
          <FieldInputAdapter
            fieldType={FieldType.DATE}
            value={payload.expectedDeliveryDate}
            onChange={(val) =>
              onUpdate((current) => ({
                ...current,
                expectedDeliveryDate: (val as string) || null,
              }))
            }
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Currency'
          type={BaseType.STRING}
          showIcon
          description='What the order is placed in'>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={payload.currency}
            onChange={(val) =>
              onUpdate((current) => ({
                ...current,
                currency: ((val as string) || current.currency).toUpperCase(),
              }))
            }
            placeholder='EUR'
          />
        </FieldPanelRow>
      </FieldPanel>

      <TotalsConfrontation payload={payload} onUpdate={onUpdate} />
    </div>
  )
}

/**
 * Their printed total against the sum of our lines.
 *
 * 🛑 It renders when the numbers AGREE too. A block that appears only on
 * disagreement makes its absence read as "not checked", which is the opposite of
 * what it is for.
 *
 * 🛑 **Which of these four numbers may be typed into is the whole design, and it
 * is not uniform.**
 *
 * *Their printed total* is EVIDENCE — `transcription.totalText`, the vendor's own
 * paper. Editing it would destroy the only thing this block confronts our
 * arithmetic against, so it is read-only and always will be. *Sum of our lines*
 * and *Ours, all in* are derived; they move by editing the lines.
 *
 * *Shipping* and *Tax* are neither. They are OUR ORDER'S HEADER FIELDS —
 * `commit.ts` writes them straight to `purchase_order_shipping_total` and
 * `purchase_order_tax_total` — and the transcription only SEEDS them. They had no
 * editor anywhere: the only writers were the model's parse at draft creation and
 * folding a line in or out, and the rows were hidden entirely at `0`, so a
 * shipping charge the model misread (or missed) reached the committed purchase
 * order with no way to correct it and nothing on screen even naming the field.
 * They are inputs now, and they render at `0` precisely so an absent charge is
 * visible and typeable.
 *
 * A typed value and a fold are additive: folding a freight line ADDS its amount
 * here and unfolding subtracts it again, clamped at zero (see `unfoldLine`).
 */
function TotalsConfrontation({
  payload,
  onUpdate,
}: {
  payload: IntakeDraftPayload
  onUpdate: IntakeHeaderPanelProps['onUpdate']
}) {
  const currency = payload.currency
  const printed = parseIntakeTotal(payload.transcription.totalText, currency)
  const lines = lineSumCents(payload.lines)
  const ours = lines + payload.shippingCents + payload.taxCents
  const difference = printed === null ? null : printed - ours
  const differs = difference !== null && difference !== 0
  // 🛑 Three verdicts, not two. See `rateRoundingAllowance`: a residue inside
  // this bound is arithmetic OUR rate-only line model caused, and reporting it in
  // the same amber sentence used for a missed line told the reader to go audit a
  // vendor whose totals were correct.
  const allowance = rateRoundingAllowance(payload.lines, currency)
  const rounding = differs && Math.abs(difference) <= allowance

  return (
    <div className='flex h-fit flex-col gap-1.5 rounded-lg border p-3 text-sm'>
      <TotalRow label='Their printed total' value={formatCurrency(printed, currency)} />
      <TotalRow label='Sum of our lines' value={formatCurrency(lines, currency)} />
      <EditableTotalRow
        label='Shipping'
        value={payload.shippingCents}
        currencyCode={currency}
        onCommit={(next) => onUpdate((current) => ({ ...current, shippingCents: next ?? 0 }))}
      />
      <EditableTotalRow
        label='Tax'
        value={payload.taxCents}
        currencyCode={currency}
        onCommit={(next) => onUpdate((current) => ({ ...current, taxCents: next ?? 0 }))}
      />
      <div className='mt-1 border-t pt-1.5'>
        <TotalRow label='Ours, all in' value={formatCurrency(ours, currency)} />
      </div>

      {printed === null ? (
        <p className='pt-1 text-muted-foreground text-xs'>
          The document prints no total, so there is nothing to check this sum against.
        </p>
      ) : rounding ? (
        <p className='pt-1 text-muted-foreground text-xs'>
          Matches to within {formatCurrency(Math.abs(difference), currency)} — a purchase order line
          stores a price per unit, not an amount, so a vendor total carrying more decimals than the
          rate can hold leaves a few cents behind. Nothing to fix.
        </p>
      ) : differs ? (
        <p className='flex items-start gap-1.5 pt-1 text-amber-700 text-xs dark:text-amber-400'>
          <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
          <span>
            Differs by {formatCurrency(Math.abs(difference), currency)}. Check the lines, the
            shipping and tax above, or their arithmetic. Their printed total is never edited.
          </span>
        </p>
      ) : (
        <p className='pt-1 text-muted-foreground text-xs'>Matches the vendor's printed total.</p>
      )}
    </div>
  )
}

function TotalRow({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <span className={cn('text-muted-foreground text-xs', muted && 'pl-2')}>{label}</span>
      <span className='tabular-nums'>{value}</span>
    </div>
  )
}

/**
 * A totals row somebody may type over — shipping and tax only, per
 * {@link TotalsConfrontation}'s own doc.
 *
 * Reuses the line builder's `CurrencyCellInput` rather than a `FieldInputAdapter`
 * so the number reads and edits exactly like the amount cells in the table right
 * below it: minor units in and out, the currency's own exponent, chromeless at
 * rest. The fixed-width wrapper is what keeps it from stretching across the
 * `justify-between` row.
 */
function EditableTotalRow({
  label,
  value,
  currencyCode,
  onCommit,
}: {
  label: string
  value: number
  currencyCode: string
  onCommit: (next: number | null) => void
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <span className='pl-2 text-muted-foreground text-xs'>{label}</span>
      <div className='h-6 w-28 rounded-sm hover:bg-muted/60 focus-within:bg-muted/60'>
        <CurrencyCellInput
          value={value}
          readOnly={false}
          currencyCode={currencyCode}
          onCommit={onCommit}
          ariaLabel={label}
        />
      </div>
    </div>
  )
}

/** Exported for the commit dialog, which restates the same arithmetic. */
export function intakeTotals(payload: IntakeDraftPayload): {
  lines: number
  ours: number
  printed: number | null
} {
  const lines = lineSumCents(payload.lines)
  return {
    lines,
    ours: lines + payload.shippingCents + payload.taxCents,
    printed: parseIntakeTotal(payload.transcription.totalText, payload.currency),
  }
}
