// packages/lib/src/timeline/field-change-snapshot.ts

import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'

/**
 * Self-contained, frozen rendering record for a field-change row on the
 * timeline. The renderer reads these directly — no additional DB lookup.
 *
 * Discriminated by `fieldType` (the same FieldType enum used everywhere
 * else in the codebase). CALC fields are resolved to their underlying
 * `resultFieldType` at write time so the renderer never sees `CALC`.
 */

// =============================================================================
// SHARED FIELD-TYPE LITERALS
// =============================================================================

/** Plain-text content. PHONE_INTL is pre-formatted; NAME is collapsed. */
export type TimelineSnapshotTextFieldType = 'TEXT' | 'EMAIL' | 'URL' | 'NAME' | 'PHONE_INTL'

/** Numeric content with a pre-formatted human string. */
export type TimelineSnapshotNumberFieldType = 'NUMBER' | 'CURRENCY'

/** Date variants. */
export type TimelineSnapshotDateFieldType = 'DATE' | 'DATETIME' | 'TIME'

/** Option-style content (label + color frozen at write time). */
export type TimelineSnapshotOptionFieldType = 'SINGLE_SELECT' | 'MULTI_SELECT' | 'TAGS'

/** Structured/unstructured object content. */
export type TimelineSnapshotJsonFieldType = 'JSON' | 'ADDRESS_STRUCT'

// =============================================================================
// SNAPSHOT VARIANTS
// =============================================================================

/** Single text-like value. */
export interface TimelineTextSnapshot {
  fieldType: TimelineSnapshotTextFieldType
  text: string
  /** Set when the source was truncated for storage. */
  truncated?: boolean
}

/** RICH_TEXT — sanitized HTML body with optional truncation. */
export interface TimelineRichTextSnapshot {
  fieldType: 'RICH_TEXT'
  /** Sanitized HTML — re-sanitized in the renderer before insertion. */
  html: string
  truncated?: boolean
}

/** NUMBER / CURRENCY. */
export interface TimelineNumberSnapshot {
  fieldType: TimelineSnapshotNumberFieldType
  value: number
  /** Pre-formatted human string ("$1,234.56", "1,234.56 EUR"). */
  formatted: string
  currency?: string
}

/** CHECKBOX. */
export interface TimelineBooleanSnapshot {
  fieldType: 'CHECKBOX'
  value: boolean
}

/** DATE / DATETIME / TIME. */
export interface TimelineDateSnapshot {
  fieldType: TimelineSnapshotDateFieldType
  iso: string
}

/** SINGLE_SELECT / MULTI_SELECT / TAGS — option label + color FROZEN at write time. */
export interface TimelineOptionSnapshot {
  fieldType: TimelineSnapshotOptionFieldType
  optionId: string
  /** Label resolved from CustomField.options at write time. */
  label: string
  /** Optional color, also resolved at write time. */
  color?: string
}

/** RELATIONSHIP — displayName FROZEN at write time. */
export interface TimelineRelationshipSnapshot {
  fieldType: 'RELATIONSHIP'
  recordId: RecordId
  /** EntityInstance.displayName at write time — used as fallback when the
   * record can no longer be resolved client-side. */
  label: string
  /** entityType from EntityDefinition (e.g. 'contact', 'ticket'). null = custom entity. */
  entityType: string | null
}

/** ACTOR — user/group display label FROZEN at write time. */
export interface TimelineActorSnapshot {
  fieldType: 'ACTOR'
  /** Pre-formatted ActorId (`user:<id>` / `group:<id>`). */
  actorId: ActorId
  actorType: 'user' | 'group'
  /** Used as fallback when the actor can no longer be resolved client-side. */
  label: string
  /** Optional avatar reference at write time. */
  avatarUrl?: string
}

/** FILE — v1 records generic file activity without resolving file metadata. */
export interface TimelineFileSnapshot {
  fieldType: 'FILE'
  /** V1 intentionally avoids resolving file metadata. */
  label: string
  count?: number
}

/** ADDRESS_STRUCT / JSON — structured fallback. */
export interface TimelineJsonSnapshot {
  fieldType: TimelineSnapshotJsonFieldType
  value: Record<string, unknown>
  /** Set when the body was truncated. */
  truncated?: boolean
}

export type TimelineFieldChangeSnapshot =
  | TimelineTextSnapshot
  | TimelineRichTextSnapshot
  | TimelineNumberSnapshot
  | TimelineBooleanSnapshot
  | TimelineDateSnapshot
  | TimelineOptionSnapshot
  | TimelineRelationshipSnapshot
  | TimelineActorSnapshot
  | TimelineFileSnapshot
  | TimelineJsonSnapshot

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

/** Cap on text/json/html snapshot bodies — full value is still on the source FieldValue row. */
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
