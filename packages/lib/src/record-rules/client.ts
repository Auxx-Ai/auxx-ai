// packages/lib/src/record-rules/client.ts
// Client-safe exports — types + pure constants/helpers only. No server dependencies.
// Action-token helpers (plans/signals/07-action-placeholders.md): the three text-bearing
// rule-action fields (`create-task.title`, `set-field.value`, `notify.message`) store
// tiptap JSON docs with `placeholder` token nodes (`attrs: { id, fallback?, format? }` —
// the snippet editor's node). Field tokens use the shared placeholder-id scheme
// (`@auxx/lib/placeholders/client` `tryParsePlaceholderId`); the ids below are the
// rule-specific additions resolved by `resolve-action-tokens.ts`.

import { docToText } from '../tiptap/doc-to-text'
import type { TiptapDoc, TiptapNode } from '../tiptap/types'

export {
  type CachedRecordRule,
  FIELD_TRANSITIONS,
  LIFECYCLE_TRANSITIONS,
  type RecordRuleAction,
  type RecordRuleActionOutcome,
  type RecordRuleOn,
} from './types'

/**
 * Token id for the fired record's display name — the successor of the legacy v1
 * `{{record}}` string interpolation.
 */
export const ACTION_TOKEN_RECORD_NAME = 'record:name'

/**
 * Signal-context tokens, offered only on `on: 'signal'` rules and resolved from
 * `RecordRuleFireContext.signal` at execution.
 */
export const SIGNAL_CONTEXT_TOKENS: { id: string; label: string }[] = [
  { id: 'signal:kind', label: 'Signal kind' },
  { id: 'signal:subtype', label: 'Signal subtype' },
  { id: 'signal:occurredAt', label: 'Signal date' },
]

/**
 * Is `id` one of the rule-specific action tokens (`record:name` + the signal-context
 * ids) — i.e. NOT part of the shared placeholder catalog? The web badge/picker and the
 * server resolver's pre-pass both branch on this.
 */
export function isRuleActionToken(id: string): boolean {
  return id === ACTION_TOKEN_RECORD_NAME || SIGNAL_CONTEXT_TOKENS.some((t) => t.id === id)
}

/**
 * Is `v` a tiptap-doc-shaped action value (`{ type: 'doc' }`)? Distinguishes the 07 doc
 * shape from legacy pre-07 plain-string (and, for set-field, raw) values.
 */
export function isActionDoc(v: unknown): v is TiptapDoc {
  return typeof v === 'object' && v !== null && (v as { type?: unknown }).type === 'doc'
}

/**
 * Convert a plain action string to the 07 doc shape: a single paragraph where each
 * literal `{{record}}` becomes a `record:name` placeholder node and the remaining text
 * becomes text nodes. Used by the seeds and as the UI's defensive normalizer (also a
 * convenient doc-fixture builder in tests).
 */
export function legacyActionTextToDoc(text: string): TiptapDoc {
  const content: TiptapNode[] = []
  const parts = text.split('{{record}}')
  parts.forEach((part, i) => {
    if (i > 0) content.push({ type: 'placeholder', attrs: { id: ACTION_TOKEN_RECORD_NAME } })
    if (part.length > 0) content.push({ type: 'text', text: part })
  })
  return {
    type: 'doc',
    content: [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }],
  }
}

/**
 * Flatten an action field value to display text for UI summaries. Legacy strings pass
 * through verbatim; docs flatten with each token rendered as `{Label}` via `resolveLabel`
 * (falling back to `{id}` when unresolved).
 */
export function actionDocToSummaryText(
  v: TiptapDoc | string,
  resolveLabel?: (id: string) => string | undefined
): string {
  if (typeof v === 'string') return v
  return docToText(v, { placeholders: (id) => `{${resolveLabel?.(id) ?? id}}` })
}
