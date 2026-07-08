// apps/web/src/components/workflow/nodes/shared/trace-primitives.tsx

'use client'

import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

/** camelCase / snake_case → "Title Case" for field keys. */
export function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

/** Scalars render inline; everything else (object/array) gets a collapsed JSON disclosure. */
export function isScalar(value: unknown): boolean {
  return (
    value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)
  )
}

/** Collapsed `<details>` JSON disclosure — used for nested objects/arrays. */
export function CollapsedJson({ title, value }: { title: ReactNode; value: unknown }) {
  return (
    <details className='group rounded-xl bg-background ring-1 ring-border'>
      <summary className='flex cursor-pointer items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground select-none'>
        <ChevronRight className='size-3 transition-transform group-open:rotate-90' />
        {title}
      </summary>
      <pre className='max-h-[200px] overflow-auto p-2 pt-0 font-mono text-xs'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

/** A single value: scalar inline (null/undefined → muted "—"), object/array as collapsed JSON. */
export function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className='text-neutral-400'>—</span>
  }
  if (isScalar(value)) {
    return <span className='font-medium break-words'>{String(value)}</span>
  }
  return <CollapsedJson title='Value' value={value} />
}

/**
 * Label/value rows for a flat record. Scalars render as aligned rows; nested
 * objects/arrays render as collapsed JSON disclosures below.
 */
export function FieldRows({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values)
  const scalars = entries.filter(([, v]) => isScalar(v))
  const complex = entries.filter(([, v]) => !isScalar(v))

  return (
    <div className='space-y-1'>
      {scalars.map(([key, value]) => (
        <div key={key} className='flex min-h-[26px] w-full items-center gap-1 text-sm'>
          <div className='w-[120px] shrink-0 truncate text-neutral-400'>{formatFieldKey(key)}</div>
          <div className='min-w-0 flex-1 truncate font-medium'>{String(value ?? '')}</div>
        </div>
      ))}
      {complex.map(([key, value]) => (
        <CollapsedJson key={key} title={formatFieldKey(key)} value={value} />
      ))}
    </div>
  )
}

/** Milliseconds → compact human duration: "800ms", "5s", "1m 30s", "2h 5m". */
export function humanizeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return String(ms)
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.round(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const parts: string[] = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s && !h) parts.push(`${s}s`)
  return parts.join(' ') || '0s'
}

/** Best-effort readable rendering of a date-ish value (ISO string, number, or Date-parseable). */
export function formatDateValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    if (/\d{4}-\d{2}-\d{2}|T\d{2}:/.test(value)) {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) return d.toLocaleString()
    }
    return value
  }
  return JSON.stringify(value)
}
