// apps/web/src/components/purchasing/record-documents-card.tsx
'use client'

// `purchase_order:documents` / `vendor_bill:documents` — the files that belong to
// this record (plans/purchasing/08-documents-on-records.md P21).
//
// Both fields it renders are `showInPanel: false`, so this card is their ONLY
// surface. That is the whole point: the Details panel keeps showing business
// fields, and files get a row that shows a type icon, a name and a download,
// none of which a bare field row in a list of twenty does well.
//
// 🛑 Nothing here special-cases the generated PDF into read-only. `toPanelField`
// derives `readOnly` from `capabilities.updatable === false`, which the three
// `*_pdf_asset` fields carry — and that is deliberately the same question the
// Details panel and the record header ask, so no surface can disagree and offer
// an editor for a write the server would reject.

import { isValueEmpty } from '@auxx/lib/field-values/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { CompactFieldRow } from '~/components/fields/compact-field-row'
import { useFieldPopoverCoordination } from '~/components/fields/hooks/use-field-popover-coordination'
import { toPanelField } from '~/components/fields/rows/to-panel-field'
import { useResourceFields } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'

interface DocumentSlots {
  /**
   * System-written and read-only — the PDF we rendered. Hidden entirely until one
   * exists, because an empty read-only row is noise a person cannot act on.
   */
  generated?: string
  /**
   * The one document a person owns — the vendor's bill. Always offered, INCLUDING
   * when empty: an empty row is how the file gets uploaded in the first place.
   */
  primary?: string
  /** Everything else: packing slips, confirmations, drawings, photos. */
  attachments: string
}

function RecordDocumentsCard({ recordId, slots }: DrawerTabProps & { slots: DocumentSlots }) {
  const { entityDefinitionId } = parseRecordId(recordId)
  const { fields, isLoading: fieldsLoading } = useResourceFields(entityDefinitionId)

  // Only the generated slot needs its value here — the others render whether or
  // not they hold anything. `useSystemValues` reads the same field-value store
  // the rows subscribe to, so this is a subscription, not a second fetch.
  const generatedAttrs = useMemo(
    () => (slots.generated ? ([slots.generated] as const) : ([] as const)),
    [slots.generated]
  )
  const { values } = useSystemValues(recordId, generatedAttrs, { autoFetch: true })

  const { onOpenChange, registerClose, unregisterClose } = useFieldPopoverCoordination()

  const rows = useMemo(() => {
    const byAttribute = new Map(
      fields.filter((f) => f.systemAttribute).map((f) => [f.systemAttribute as string, f])
    )

    const wanted: string[] = []
    // Order is the reading order, not the registry's: what we produced, then what
    // they sent, then everything else.
    if (slots.generated) wanted.push(slots.generated)
    if (slots.primary) wanted.push(slots.primary)
    wanted.push(slots.attachments)

    return wanted.flatMap((attribute) => {
      const field = byAttribute.get(attribute)
      // An org that has not run migration 112 has no `attachments` field at all.
      // Skipping is right: the card degrades to the slots that exist rather than
      // rendering a row bound to a field id that does not resolve. A field with
      // no `fieldType` is the same case — nothing can render it.
      if (!field?.fieldType) return []
      if (attribute === slots.generated && isValueEmpty(values[attribute], field.fieldType)) {
        return []
      }
      return [toPanelField(field)]
    })
  }, [fields, slots, values])

  if (rows.length === 0) return null

  return (
    <div className='flex flex-col'>
      {rows.map((field) => (
        <CompactFieldRow
          key={field.id}
          providerId={field.id}
          field={field}
          loading={fieldsLoading}
          recordId={recordId}
          readOnly={field.readOnly}
          onOpenChange={onOpenChange}
          registerClose={registerClose}
          unregisterClose={unregisterClose}
        />
      ))}
    </div>
  )
}

/**
 * The PO's own PDF plus whatever the vendor sent back.
 *
 * The generated row appears only once a PDF exists, which for a PO means once it
 * has been sent or previewed — before that the card is just Attachments.
 */
export function PurchaseOrderDocumentsCard(props: DrawerTabProps) {
  return (
    <RecordDocumentsCard
      {...props}
      slots={{
        generated: 'purchase_order_pdf_asset',
        attachments: 'purchase_order_attachments',
      }}
    />
  )
}

/**
 * The bill's paper.
 *
 * `document` is a single slot on purpose (P18) — it is what a phase-2 extraction
 * would parse, and "the first element of the attachments array" is a convention
 * that survives exactly until somebody reorders. Nothing renders INTO this field,
 * so unlike the PO's generated slot it is fully user-writable.
 */
export function VendorBillDocumentsCard(props: DrawerTabProps) {
  return (
    <RecordDocumentsCard
      {...props}
      slots={{ primary: 'vendor_bill_document', attachments: 'vendor_bill_attachments' }}
    />
  )
}
