// apps/web/src/components/timeline/snapshot-chip.tsx
'use client'

import type {
  TimelineActorSnapshot,
  TimelineFieldChangeSnapshot,
  TimelineFieldChangeSnapshotValue,
  TimelineOptionSnapshot,
  TimelineRelationshipSnapshot,
} from '@auxx/lib/timeline/client'
import { legacyTypedFieldValueToSnapshot } from '@auxx/lib/timeline/client'
import type { SelectOption } from '@auxx/types/custom-field'
import DOMPurify from 'dompurify'
import { useActor } from '~/components/resources/hooks/use-actor'
import { useRecord } from '~/components/resources/hooks/use-record'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { TagsView } from '~/components/ui/tags-view'

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
 * Render the chosen snapshot — single, array, or null. Multi-value option
 * types (SINGLE_SELECT/MULTI_SELECT/TAGS) collapse into a single TagsView so
 * the array renders as a row of styled chips rather than N inline spans.
 */
export function SnapshotValue({ snap }: { snap: TimelineFieldChangeSnapshotValue }) {
  if (snap === null || snap === undefined) {
    return <span className='italic text-primary-400'>empty</span>
  }
  if (Array.isArray(snap)) {
    if (snap.length === 0) return <span className='italic text-primary-400'>empty</span>
    if (isOptionSnapshot(snap[0]!)) {
      return <OptionTagsView snaps={snap as TimelineOptionSnapshot[]} />
    }
    return (
      <span className='inline-flex flex-wrap items-center gap-1'>
        {snap.map((s, i) => (
          <SnapshotChip key={i} snap={s} />
        ))}
      </span>
    )
  }
  if (isOptionSnapshot(snap)) {
    return <OptionTagsView snaps={[snap]} />
  }
  return <SnapshotChip snap={snap} />
}

/**
 * Render a single snapshot chip per `fieldType`.
 */
export function SnapshotChip({ snap }: { snap: TimelineFieldChangeSnapshot }) {
  switch (snap.fieldType) {
    case 'TEXT':
    case 'EMAIL':
    case 'URL':
    case 'NAME':
    case 'PHONE_INTL':
      return (
        <span>
          {snap.text}
          {snap.truncated ? '…' : ''}
        </span>
      )

    case 'RICH_TEXT':
      return (
        <span
          className='[&_p]:inline'
          // eslint-disable-next-line react/no-danger -- sanitized via DOMPurify
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(snap.html) + (snap.truncated ? '…' : ''),
          }}
        />
      )

    case 'NUMBER':
    case 'CURRENCY':
      return <span>{snap.formatted}</span>

    case 'CHECKBOX':
      return <span>{snap.value ? 'true' : 'false'}</span>

    case 'DATE':
    case 'DATETIME':
    case 'TIME':
      return <FormattedDate iso={snap.iso} fieldType={snap.fieldType} />

    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
    case 'TAGS':
      // Single-option case — wrap into a one-item TagsView so the styling
      // matches the array path.
      return <OptionTagsView snaps={[snap]} />

    case 'RELATIONSHIP':
      return <RelationshipChip snap={snap} />

    case 'ACTOR':
      return <ActorChip snap={snap} />

    case 'FILE':
      return (
        <span>{snap.count && snap.count > 1 ? `${snap.count} files` : snap.label || 'File'}</span>
      )

    case 'JSON':
    case 'ADDRESS_STRUCT':
      return (
        <code className='text-xs'>
          {JSON.stringify(snap.value)}
          {snap.truncated ? '…' : ''}
        </code>
      )
  }
}

function isOptionSnapshot(s: TimelineFieldChangeSnapshot): s is TimelineOptionSnapshot {
  return s.fieldType === 'SINGLE_SELECT' || s.fieldType === 'MULTI_SELECT' || s.fieldType === 'TAGS'
}

/**
 * Render a list of option snapshots through the shared `TagsView` so the
 * timeline matches the rest of the app's tag styling. Snapshots are
 * self-contained (each carries its frozen label + color), so we synthesize
 * the option list inline without any cache/store lookup.
 */
function OptionTagsView({ snaps }: { snaps: TimelineOptionSnapshot[] }) {
  const value = snaps.map((s) => s.optionId)
  const options: SelectOption[] = snaps.map((s) => ({
    value: s.optionId,
    label: s.label,
    ...(s.color ? { color: s.color as SelectOption['color'] } : {}),
  }))
  return <TagsView value={value} options={options} variant='pill' />
}

/**
 * Render a relationship via `RecordBadge`, falling back to the snapshot's
 * frozen label when the referenced record is no longer resolvable in the
 * client cache (deleted / no permission / cross-org reference).
 */
function RelationshipChip({ snap }: { snap: TimelineRelationshipSnapshot }) {
  const { isNotFound } = useRecord({ recordId: snap.recordId })
  if (isNotFound) {
    return <span className='font-medium'>{snap.label}</span>
  }
  return (
    <span className='inline-flex align-middle'>
      <RecordBadge recordId={snap.recordId} />
    </span>
  )
}

/**
 * Render an actor via `ActorBadge`, falling back to the snapshot's frozen
 * label when the actor has been removed or can't be resolved.
 */
function ActorChip({ snap }: { snap: TimelineActorSnapshot }) {
  const { isNotFound } = useActor({ actorId: snap.actorId })
  if (isNotFound) {
    return <span className='font-medium'>{snap.label}</span>
  }
  return (
    <span className='inline-flex align-middle'>
      <ActorBadge actorId={snap.actorId} />
    </span>
  )
}

function FormattedDate({
  iso,
  fieldType,
}: {
  iso: string
  fieldType: 'DATE' | 'DATETIME' | 'TIME'
}) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return <span>{iso}</span>
  const formatted =
    fieldType === 'TIME'
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : fieldType === 'DATETIME'
        ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
  return <span>{formatted}</span>
}
