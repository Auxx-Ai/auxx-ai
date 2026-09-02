// apps/web/src/components/purchasing/intake/ui/intake-header-panel.tsx
'use client'

// The proposed order's header, and the totals confrontation beside it
// (plans/money/tasks/38 §3.1 / §6.2).

import { FieldType } from '@auxx/database/enums'
import {
  type IntakeDraftPayload,
  lineSumCents,
  parseIntakeTotal,
} from '@auxx/lib/purchasing/intake/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { cn } from '@auxx/ui/lib/utils'
import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
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

      <TotalsConfrontation payload={payload} />
    </div>
  )
}

/**
 * Their printed total against the sum of our lines.
 *
 * 🛑 It renders when the numbers AGREE too. A block that appears only on
 * disagreement makes its absence read as "not checked", which is the opposite of
 * what it is for. Neither number is ever edited: the difference is either the
 * vendor's own arithmetic (real, and theirs to explain) or a line we failed to
 * read (a defect that a silent fix would hide).
 */
function TotalsConfrontation({ payload }: { payload: IntakeDraftPayload }) {
  const currency = payload.currency
  const printed = parseIntakeTotal(payload.transcription.totalText, currency)
  const lines = lineSumCents(payload.lines)
  const ours = lines + payload.shippingCents + payload.taxCents
  const difference = printed === null ? null : printed - ours
  const differs = difference !== null && difference !== 0

  return (
    <div className='flex h-fit flex-col gap-1.5 rounded-lg border p-3 text-sm'>
      <TotalRow label='Their printed total' value={formatCurrency(printed, currency)} />
      <TotalRow label='Sum of our lines' value={formatCurrency(lines, currency)} />
      {payload.shippingCents !== 0 && (
        <TotalRow label='Shipping' value={formatCurrency(payload.shippingCents, currency)} muted />
      )}
      {payload.taxCents !== 0 && (
        <TotalRow label='Tax' value={formatCurrency(payload.taxCents, currency)} muted />
      )}
      <div className='mt-1 border-t pt-1.5'>
        <TotalRow label='Ours, all in' value={formatCurrency(ours, currency)} />
      </div>

      {printed === null ? (
        <p className='pt-1 text-muted-foreground text-xs'>
          The document prints no total, so there is nothing to check this sum against.
        </p>
      ) : differs ? (
        <p className='flex items-start gap-1.5 pt-1 text-amber-700 text-xs dark:text-amber-400'>
          <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
          <span>
            Differs by {formatCurrency(Math.abs(difference), currency)}. Check the lines, or their
            arithmetic. Neither number is edited.
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
