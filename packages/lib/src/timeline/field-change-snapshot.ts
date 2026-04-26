// packages/lib/src/timeline/field-change-snapshot.ts

import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'

/**
 * Self-contained, frozen rendering record for a field-change row on the
 * timeline. The renderer reads these directly — no additional DB lookup.
 *
 * Discriminated by `kind` (NOT by FieldType) so the rendering shape stays
 * stable even when an underlying field is renamed/retyped.
 */

/** Plain text content — TEXT, EMAIL, URL, ADDRESS, NAME (collapsed), PHONE (formatted), RICH_TEXT (truncated). */
export interface TimelineSnapshotText {
  kind: 'text'
  text: string
  /** Set when the source was truncated for storage (rich text bodies, long JSON dumps). */
  truncated?: boolean
}

/** NUMBER and CURRENCY. */
export interface TimelineSnapshotNumber {
  kind: 'number'
  value: number
  /** Pre-formatted human string ("$1,234.56", "1,234.56 EUR"). */
  formatted: string
  currency?: string
}

/** CHECKBOX. */
export interface TimelineSnapshotBoolean {
  kind: 'boolean'
  value: boolean
}

/** DATE / DATETIME / TIME. */
export interface TimelineSnapshotDate {
  kind: 'date'
  iso: string
  /** Discriminator so the renderer picks the right format (date-only vs datetime). */
  variant: 'date' | 'datetime' | 'time'
}

/** SINGLE_SELECT, MULTI_SELECT, TAGS — option label is FROZEN at write time. */
export interface TimelineSnapshotOption {
  kind: 'option'
  optionId: string
  /** Label resolved from CustomField.options at write time. */
  label: string
  /** Optional color, also resolved at write time. */
  color?: string
}

/** RELATIONSHIP — displayName is FROZEN at write time. */
export interface TimelineSnapshotRelationship {
  kind: 'relationship'
  recordId: RecordId
  /** EntityInstance.displayName at write time. */
  label: string
  /** entityType from EntityDefinition (e.g. 'contact', 'ticket'). null = custom entity. */
  entityType: string | null
}

/** ACTOR — user/group display label is FROZEN at write time. */
export interface TimelineSnapshotActor {
  kind: 'actor'
  actorId: ActorId
  actorType: 'user' | 'group'
  label: string
  /** Optional avatar reference at write time. */
  avatarUrl?: string
}

/** FILE — v1 records generic file activity without resolving file metadata. */
export interface TimelineSnapshotFile {
  kind: 'file'
  /** V1 intentionally avoids resolving file metadata. */
  label: string
  count?: number
}

/** ADDRESS_STRUCT, JSON — last-resort variant for shapes we don't render specifically. */
export interface TimelineSnapshotJson {
  kind: 'json'
  value: Record<string, unknown>
  /** Set when the body was truncated (large notes blobs etc.). */
  truncated?: boolean
}

export type TimelineFieldChangeSnapshot =
  | TimelineSnapshotText
  | TimelineSnapshotNumber
  | TimelineSnapshotBoolean
  | TimelineSnapshotDate
  | TimelineSnapshotOption
  | TimelineSnapshotRelationship
  | TimelineSnapshotActor
  | TimelineSnapshotFile
  | TimelineSnapshotJson

/** A field-change snapshot value. `null` when the field was empty. */
export type TimelineFieldChangeSnapshotValue =
  | TimelineFieldChangeSnapshot
  | TimelineFieldChangeSnapshot[]
  | null

// =============================================================================
// SIZE LIMITS
// =============================================================================

/** Cap on relationship/actor labels — anything longer is unusable in the timeline anyway. */
export const TIMELINE_SNAPSHOT_LABEL_LIMIT = 200

/** Cap on text/json snapshot bodies — full value is still on the source FieldValue row. */
export const TIMELINE_SNAPSHOT_BODY_LIMIT = 1000

/** Cap on snapshot arrays — overflow is reflected via `*Truncated` metadata on the change row. */
export const TIMELINE_SNAPSHOT_ARRAY_LIMIT = 25

// =============================================================================
// UTILITIES
// =============================================================================

/** Truncate a string to `limit` chars, returning [truncatedText, wasTruncated]. */
export function truncateForSnapshot(text: string, limit: number): [string, boolean] {
  if (text.length <= limit) return [text, false]
  return [text.slice(0, limit), true]
}
