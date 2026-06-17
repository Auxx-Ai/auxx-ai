// apps/web/src/components/kbar/pages/record-preview.tsx
'use client'

import { formatToRawValue } from '@auxx/lib/field-values/client'
import {
  getDefinitionId,
  type RecordId,
  type RecordPickerItem,
  type ResourceField,
} from '@auxx/lib/resources/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useMemo } from 'react'
import { FieldDisplay } from '~/components/fields/field-display'
import { useFieldView } from '~/components/fields/hooks/use-field-view'
import { useFieldValues } from '~/components/resources/hooks/use-field-values'
import { useResource } from '~/components/resources/hooks/use-resource'
import { useResourceFields } from '~/components/resources/hooks/use-resource-fields'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useNormalizedRecordId } from '~/components/resources/utils/normalize-record-id'

/** Max field rows to show — the preview is a glance, Enter opens the full record. */
const MAX_FIELDS = 10

interface RecordPreviewProps {
  /** RecordId of the highlighted result (null when nothing is highlighted). */
  recordId: RecordId | null
  /** The highlighted search item — supplies the header instantly, pre-fetch. */
  item: RecordPickerItem | null
}

function isEmptyValue(value: unknown): boolean {
  if (value == null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Passive, read-only preview of the highlighted record's entity fields. Shows
 * the same fields the detail-view panel shows — the org's `panel` field view,
 * sourced through {@link useResourceFields} + {@link useFieldView} exactly like
 * `entity-fields.tsx` — minus the primary display field (it's the header) and
 * any field that's currently empty. Values are fetched lazily into the shared
 * field-value store and read back reactively via {@link useFieldValues}, the
 * same store `PropertyProvider` reads from.
 */
export function RecordPreview({ recordId: rawRecordId, item }: RecordPreviewProps) {
  // The search item's RecordId carries the entity-type/slug prefix, but the
  // field-value store keys (and the resource store) use the real
  // entityDefinitionId. Normalize so fetch-key, read-key, and server-echoed
  // key all align — exactly what useRecord does.
  const recordId = useNormalizedRecordId(rawRecordId) ?? null
  const defId = recordId ? getDefinitionId(recordId) : ''
  const { resource } = useResource(defId)

  // Field list, sourced the same way the detail-view panel sources it:
  // effective fields (with optimistic overlays) ordered + filtered by the
  // org-wide `panel` field view (respects showInPanel, hidden, visibility).
  const { fields: effectiveFields } = useResourceFields(defId)
  const { getVisibleFields } = useFieldView({
    entityDefinitionId: defId,
    contextType: 'panel',
    fields: effectiveFields,
    enabled: effectiveFields.length > 0,
  })

  // Panel-visible fields minus the primary display field (already in the header).
  const previewFields = useMemo<ResourceField[]>(() => {
    const primaryFieldId = resource?.display.primaryDisplayField?.id
    return getVisibleFields().filter((f) => f.id !== primaryFieldId)
  }, [getVisibleFields, resource])

  // Fetch + read values through the same store PropertyProvider uses. Pass bare
  // FieldIds — the fetch queue and store key both normalize FieldId →
  // ResourceFieldId, so reads and fetches align without building refs by hand.
  const fieldRefs = useMemo(() => previewFields.map((f) => f.id), [previewFields])
  const { values } = useFieldValues(recordId ?? ('' as RecordId), fieldRefs, {
    autoFetch: !!recordId && fieldRefs.length > 0,
  })

  const rows = useMemo(() => {
    if (!recordId) return []
    const out: Array<{ field: ResourceField; value: unknown }> = []
    for (const field of previewFields) {
      const value = formatToRawValue(values[field.id], field.fieldType ?? 'TEXT')
      if (isEmptyValue(value)) continue
      out.push({ field, value })
      if (out.length >= MAX_FIELDS) break
    }
    return out
  }, [recordId, previewFields, values])

  if (!recordId || !item) {
    return (
      <div className='hidden min-w-0 items-center justify-center p-6 text-center text-sm text-primary-400 md:flex'>
        Click a record to preview it.
      </div>
    )
  }

  return (
    <div className='hidden min-w-0 flex-col overflow-hidden md:flex'>
      <ScrollArea className='min-h-0 flex-1'>
        {/* Sticky header — pins to the top while the fields scroll under it */}
        <div className='sticky top-0 z-10 flex items-start gap-2.5 bg-background/90 px-4 pt-4 pb-3 backdrop-blur-lg'>
          <RecordIcon
            avatarUrl={item.avatarUrl}
            iconId={item.iconId ?? resource?.icon ?? 'circle'}
            color='gray'
            size='md'
            inverse
            className='shrink-0 inset-shadow-xs inset-shadow-black/20'
          />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <div className='min-w-0 flex-1 truncate font-medium text-sm'>{item.displayName}</div>
              {resource && (
                <Badge
                  variant={(resource.color || 'gray') as Variant}
                  size='xs'
                  className='shrink-0 uppercase tracking-wide'>
                  {resource.label}
                </Badge>
              )}
            </div>
            {item.secondaryInfo && (
              <div className='truncate text-muted-foreground text-xs'>{item.secondaryInfo}</div>
            )}
          </div>
        </div>

        {/* Fields */}
        <div className='flex flex-col gap-1 px-4 pb-4'>
          {rows.length === 0 ? (
            <div className='space-y-2 pt-1'>
              <Skeleton className='h-3.5 w-2/3' />
              <Skeleton className='h-3.5 w-1/2' />
              <Skeleton className='h-3.5 w-3/5' />
            </div>
          ) : (
            rows.map(({ field, value }) => (
              <div key={field.id} className='flex min-w-0 flex-col gap-0.5'>
                <span className='text-[11px] text-muted-foreground'>{field.label}</span>
                {/* Strip the property-row chrome from FieldDisplay: the right-edge
                    mask and single-line clamp are tuned for editable rows, not a
                    read-only preview. Let values wrap and align to the top. */}
                <div className='min-w-0 text-sm [&_[data-slot=field-display-content]]:mask-none [&_[data-slot=field-display-content]]:items-start [&_[data-slot=field-display-value]]:whitespace-normal'>
                  <FieldDisplay field={field} value={value} />
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
