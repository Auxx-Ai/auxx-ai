// apps/extension/src/iframe/components/record-detail-skeleton.tsx

import { Button } from '@auxx/ui/components/button'
import { ExternalLink } from 'lucide-react'
import type { RecordFetchState } from '../routes/contact-route'
import type { RecordFieldValue } from '../trpc'

/**
 * Read-only skeleton for the contact / company detail routes. Renders
 * displayName + every field value via a generic `formatFieldValue` switch
 * over the typed FieldValue columns. The full editor (typed renderer per
 * FieldType, edit mode, mutations) is the next plan; this exists so the
 * navigation + fetch path can ship now.
 *
 * `openHref` puts the "Open in Auxx" link inline next to the displayName
 * so the header stays minimal (dropdown + back chevron only) — folk's
 * pattern.
 */
export function RecordDetailSkeleton({
  state,
  openHref,
}: {
  state: RecordFetchState
  openHref: string
}) {
  if (state.status === 'loading') {
    return <p className='text-sm text-muted-foreground'>Loading…</p>
  }
  if (state.status === 'error') {
    return <p className='text-sm text-destructive'>{state.message}</p>
  }
  const { record } = state
  const rows = record.values
    .map((v) => ({
      key: v.field.id,
      label: v.field.label ?? v.field.systemAttribute ?? v.field.id,
      value: formatFieldValue(v),
    }))
    .filter((r) => r.value.length > 0)

  return (
    <div className='space-y-4'>
      <div className='flex items-start justify-between gap-2'>
        <h2 className='min-w-0 flex-1 truncate text-base font-medium'>
          {record.displayName ?? 'Untitled'}
        </h2>
        <Button asChild variant='ghost' size='sm' className='shrink-0 gap-1'>
          <a href={openHref} target='_blank' rel='noreferrer'>
            <ExternalLink className='size-3.5' />
            Open
          </a>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No field values yet.</p>
      ) : (
        <dl className='grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm'>
          {rows.map((row) => (
            <div key={row.key} className='contents'>
              <dt className='text-xs text-muted-foreground'>{row.label}</dt>
              <dd className='m-0 break-words'>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/**
 * Pick whichever typed column the FieldValue row populated. Skeleton-grade —
 * we don't try to format dates/numbers prettily yet, and we collapse JSON
 * (multi-value fields, file refs, relationship pointers) to its serialized
 * form so the user can at least see *something* for every field. The real
 * field renderer lives in the follow-up plan.
 */
function formatFieldValue(v: RecordFieldValue): string {
  if (v.valueText != null && v.valueText !== '') return v.valueText
  if (v.valueNumber != null) return String(v.valueNumber)
  if (v.valueBoolean != null) return v.valueBoolean ? 'Yes' : 'No'
  if (v.valueDate != null && v.valueDate !== '') return v.valueDate
  if (v.valueJson != null) {
    try {
      return typeof v.valueJson === 'string' ? v.valueJson : JSON.stringify(v.valueJson)
    } catch {
      return ''
    }
  }
  return ''
}
