// apps/web/src/components/timeline/snapshot-chip.tsx
import type {
  TimelineFieldChangeSnapshot,
  TimelineFieldChangeSnapshotValue,
} from '@auxx/lib/timeline/client'
import { legacyTypedFieldValueToSnapshot } from '@auxx/lib/timeline/client'

/**
 * Field-change row payload as it appears on the timeline. New rows carry
 * `oldDisplay` / `newDisplay` snapshots; legacy rows only carry the raw
 * `oldValue` / `newValue` and we fall back to a best-effort unwrap.
 */
export interface SnapshotChange {
  field: string
  fieldType?: string
  oldDisplay?: TimelineFieldChangeSnapshotValue
  newDisplay?: TimelineFieldChangeSnapshotValue
  oldValue?: unknown
  newValue?: unknown
}

/**
 * Pick the renderable snapshot for a side of a change row. Prefers the
 * frozen snapshot; falls back to a pure unwrap of the raw legacy value.
 */
export function pickRenderable(
  change: SnapshotChange,
  side: 'old' | 'new'
): TimelineFieldChangeSnapshotValue {
  const snap = side === 'old' ? change.oldDisplay : change.newDisplay
  if (snap !== undefined) return snap
  const raw = side === 'old' ? change.oldValue : change.newValue
  return legacyTypedFieldValueToSnapshot(raw, change.fieldType)
}

/**
 * Render the chosen snapshot — single, array, or null.
 */
export function SnapshotValue({ snap }: { snap: TimelineFieldChangeSnapshotValue }) {
  if (snap === null || snap === undefined) {
    return <span className='italic text-primary-400'>empty</span>
  }
  if (Array.isArray(snap)) {
    if (snap.length === 0) return <span className='italic text-primary-400'>empty</span>
    return (
      <span className='inline-flex flex-wrap items-center gap-1'>
        {snap.map((s, i) => (
          <SnapshotChip key={i} snap={s} />
        ))}
      </span>
    )
  }
  return <SnapshotChip snap={snap} />
}

/**
 * Render a single snapshot chip per `kind`.
 */
export function SnapshotChip({ snap }: { snap: TimelineFieldChangeSnapshot }) {
  switch (snap.kind) {
    case 'text':
      return (
        <span>
          {snap.text}
          {snap.truncated ? '…' : ''}
        </span>
      )
    case 'number':
      return <span>{snap.formatted}</span>
    case 'boolean':
      return <span>{snap.value ? 'true' : 'false'}</span>
    case 'date':
      return <FormattedDate iso={snap.iso} variant={snap.variant} />
    case 'option':
      return <OptionBadge label={snap.label} color={snap.color} />
    case 'relationship':
      return <span className='font-medium'>{snap.label}</span>
    case 'actor':
      return <span className='font-medium'>{snap.label}</span>
    case 'file':
      return (
        <span>{snap.count && snap.count > 1 ? `${snap.count} files` : snap.label || 'File'}</span>
      )
    case 'json':
      return (
        <code className='text-xs'>
          {JSON.stringify(snap.value)}
          {snap.truncated ? '…' : ''}
        </code>
      )
  }
}

function FormattedDate({ iso, variant }: { iso: string; variant: 'date' | 'datetime' | 'time' }) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return <span>{iso}</span>
  const formatted =
    variant === 'time'
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : variant === 'datetime'
        ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
  return <span>{formatted}</span>
}

function OptionBadge({ label, color }: { label: string; color?: string }) {
  const style = color
    ? ({ backgroundColor: `var(--color-${color}-100, ${color})` } as React.CSSProperties)
    : undefined
  return (
    <span
      className='inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-accent-50 text-accent-700'
      style={style}>
      {label}
    </span>
  )
}
