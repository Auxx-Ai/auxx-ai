// packages/lib/src/permissions/visibility/redact.ts

import type { ThreadMeta } from '../../threads/types'
import { type Lens, satisfiesLens } from './lens'

/**
 * Redaction classification (§ risk register). Tiers are cumulative:
 * metadata ⊂ subject ⊂ full. The metadata + subject sets are an explicit
 * ALLOWLIST — a field not listed is `full`-only, so a newly-added ThreadMeta
 * field is hidden below `full` until someone classifies it here. It can't
 * silently leak (this is the mitigation for "patch redaction drift").
 */

/** Visible whenever the viewer sees the thread at all (`metadata`+). */
export const THREAD_METADATA_FIELDS: readonly (keyof ThreadMeta)[] = [
  'id',
  'status',
  'lastMessageAt',
  'firstMessageAt',
  'messageCount',
  'participantCount',
  'integrationId',
  'integrationProvider',
  'integrationIsExample',
  'assigneeId',
  'inboxId',
  'ticketId',
  'primaryEntity',
  'externalId',
  'tagIds',
  'draftIds',
  'scheduledMessageCount',
  'handoffState',
  'metadata',
  'mergedIntoThreadId',
  'mergeData',
  'latestCommentId',
  'myLens',
  'hasShares',
]

/** Adds to the metadata set at `subject`+. */
export const SUBJECT_TIER_THREAD_FIELDS: readonly (keyof ThreadMeta)[] = ['subject']

/**
 * Everything not in the metadata/subject allowlists is `full`-only. Named
 * explicitly for the full-object blanking path; `isUnread` is full-tier
 * (flagged 2026-07-06 — sub-full threads render read), `latestMessageId`
 * points at message content.
 */
export const FULL_ONLY_THREAD_FIELDS: readonly (keyof ThreadMeta)[] = [
  'isUnread',
  'latestMessageId',
]

/** Message fields that carry content (body / snippet / attachments) — `full` only. */
export const MESSAGE_CONTENT_FIELDS: readonly string[] = [
  'textHtml',
  'textPlain',
  'snippet',
  'htmlBodyStorageLocationId',
  'attachments',
]

/** Blanked values for redacted full-tier fields (keeps the ThreadMeta shape intact). */
const REDACTED_THREAD_DEFAULTS: Partial<ThreadMeta> = {
  subject: '',
  isUnread: false,
  latestMessageId: null,
}

/** The set of ThreadMeta keys a viewer at `lens` may see. `full` sees everything. */
function allowedThreadKeys(lens: Lens): Set<string> {
  const keys = new Set<string>(THREAD_METADATA_FIELDS as readonly string[])
  if (satisfiesLens(lens, 'subject')) {
    for (const f of SUBJECT_TIER_THREAD_FIELDS) keys.add(f)
  }
  return keys
}

/**
 * Project a full {@link ThreadMeta} down to `lens`. Keeps every key (so the FE
 * type holds) but blanks the values above the viewer's tier. Never call at
 * `none` — the row is dropped from the list instead.
 */
export function redactThreadMeta(meta: ThreadMeta, lens: Lens): ThreadMeta {
  if (lens === 'full') return meta
  const out: ThreadMeta = { ...meta }
  for (const field of FULL_ONLY_THREAD_FIELDS) {
    ;(out as Record<string, unknown>)[field] = REDACTED_THREAD_DEFAULTS[field]
  }
  if (!satisfiesLens(lens, 'subject')) {
    for (const field of SUBJECT_TIER_THREAD_FIELDS) {
      ;(out as Record<string, unknown>)[field] = REDACTED_THREAD_DEFAULTS[field]
    }
  }
  return out
}

/**
 * Redact a thread PATCH (§6.2) — ALLOWLIST + key-based: keep only keys visible
 * at `lens`, drop everything else (including unclassified new fields) so a
 * patch can't smuggle a higher-tier field onto a lower-lens channel. Returns a
 * new object; `none` yields `{}`.
 */
export function redactThreadPatch(patch: Partial<ThreadMeta>, lens: Lens): Partial<ThreadMeta> {
  if (lens === 'full') return patch
  if (lens === 'none') return {}
  const allowed = allowedThreadKeys(lens)
  const out: Partial<ThreadMeta> = {}
  for (const key of Object.keys(patch) as (keyof ThreadMeta)[]) {
    if (allowed.has(key)) out[key] = patch[key] as never
  }
  return out
}

/** Blanked values per redacted message content field (shape-preserving). */
const REDACTED_MESSAGE_DEFAULTS: Record<string, unknown> = {
  textHtml: null,
  textPlain: null,
  snippet: null,
  htmlBodyStorageLocationId: null,
  attachments: [],
}

/**
 * Redact a message PATCH (§6.2) — key-based: content fields are DROPPED (not
 * blanked) below `full`, so a lower-lens realtime channel never carries body /
 * snippet / attachment data and never clobbers store state with blanks.
 * Messages are invisible at `metadata` — callers skip publishing entirely
 * there rather than calling this.
 */
export function redactMessagePatch<T extends Record<string, unknown>>(patch: T, lens: Lens): T {
  if (satisfiesLens(lens, 'full')) return patch
  const out = { ...patch }
  for (const field of MESSAGE_CONTENT_FIELDS) {
    delete out[field]
  }
  return out
}

/**
 * Project a message down to `lens`. At `full` it passes through; below `full`
 * (envelope tier) content fields are blanked. Messages are invisible at
 * `metadata` — the caller returns nothing / 404 rather than calling this.
 * Generic so the exact Message meta shape is wired in Phase 2.
 */
export function redactMessage<T extends Record<string, unknown>>(message: T, lens: Lens): T {
  if (satisfiesLens(lens, 'full')) return message
  const out: T = { ...message }
  for (const field of MESSAGE_CONTENT_FIELDS) {
    if (field in out)
      (out as Record<string, unknown>)[field] = REDACTED_MESSAGE_DEFAULTS[field] ?? null
  }
  return out
}
