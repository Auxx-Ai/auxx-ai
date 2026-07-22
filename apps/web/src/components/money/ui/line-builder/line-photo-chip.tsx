// apps/web/src/components/money/ui/line-builder/line-photo-chip.tsx

'use client'

// Per-line scouting-photo affordance (plans/dispatch/37b-scouting-quote-photos.md §4) —
// `line_item` has no generic detail-dialog surface, so this small camera/count chip is
// the line's only entry point for photos. Reuses the existing generic FILE input
// (`FileInputField`, get-input-component.tsx:70) as-is, bound to this line instance's
// `line_item_photos` field through the same `PropertyProvider` context every other field
// input reads from — no bespoke upload/remove logic lives here. Rendered only for real
// (persisted) line rows: a phantom draft has no EntityInstance yet, so there is nowhere
// to attach a FieldValue row until the line's first commit.

import type { ResourceField } from '@auxx/lib/resources/client'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Camera } from 'lucide-react'
import { FileInputField } from '~/components/fields/inputs/file-input-field'
import { PropertyProvider } from '~/components/fields/property-provider'
import type { RecordId } from '~/components/resources'

export function LinePhotoChip({
  recordId,
  field,
  photoCount,
  readOnly,
}: {
  recordId: RecordId
  field: ResourceField
  photoCount: number
  readOnly: boolean
}) {
  // Read-only surfaces (the invoice gather preview, an already-invoiced line
  // builder, …) show a static count badge only — `FileInputField` has no
  // read-only mode of its own (upload/remove always live), so opening it here
  // would silently defeat the surface's read-only contract.
  if (readOnly) {
    if (photoCount === 0) return null
    return (
      <span className='inline-flex shrink-0 items-center gap-0.5 px-1 text-muted-foreground'>
        <Camera className='size-3.5' />
        <span className='text-[10px] tabular-nums'>{photoCount}</span>
      </span>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <TreeRowButton
          persistent={photoCount > 0}
          tabIndex={-1}
          tooltipText={
            photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'Add photos'
          }
          onMouseDown={(e) => e.preventDefault()}>
          <Camera />
          {photoCount > 0 && <span className='ml-0.5 text-[10px] tabular-nums'>{photoCount}</span>}
        </TreeRowButton>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80' onOpenAutoFocus={(e) => e.preventDefault()}>
        <PropertyProvider
          field={field}
          recordId={recordId}
          providerId={`line-photos-${recordId}`}
          readOnly={false}>
          <FileInputField />
        </PropertyProvider>
      </PopoverContent>
    </Popover>
  )
}
