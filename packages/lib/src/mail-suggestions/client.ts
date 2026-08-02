// packages/lib/src/mail-suggestions/client.ts
// Client-safe entry point for mined mail suggestions — types, the subjectKey
// keyspace helpers and pure card-copy builders. No database/server imports.
//
// NOTE: no 'use client' directive. Server code imports this file too (the miner
// builds every subjectKey through `toSubjectKey` and the evidence line through
// `describeMailSuggestion`), and the directive would turn every export into a
// client-reference proxy there.

import type {
  MailSuggestionEvidence,
  MailSuggestionKind,
  MailUnsubscribeMeta,
  MailUnsubscribeMethod,
} from './types'

export {
  type MailSuggestionDraft,
  type MailSuggestionEvidence,
  type MailSuggestionKind,
  type MailSuggestionRow,
  type MailSuggestionStatus,
  type MailUnsubscribeMeta,
  type MailUnsubscribeMethod,
  toMailSuggestionRow,
} from './types'

/**
 * The `subjectKey` keyspace: `list:<listId>` or `domain:<senderDomain>`.
 *
 * `listId` and `senderDomain` stay TWO columns and this stays a discriminated
 * key (S7 / invariant 8): the unsubscribe safety gate has to tell a real
 * mailing list from a domain heuristic, and a fused key destroys exactly that.
 */
export const LIST_SUBJECT_PREFIX = 'list:'
/** @see LIST_SUBJECT_PREFIX */
export const DOMAIN_SUBJECT_PREFIX = 'domain:'

/**
 * Build the group key for one bulk-mail group. `listId` wins whenever present —
 * it is the STABLE identity that survives VERP and per-campaign from-addresses.
 */
export function toSubjectKey(listId: string | null, senderDomain: string | null): string | null {
  if (listId) return `${LIST_SUBJECT_PREFIX}${listId}`
  if (senderDomain) return `${DOMAIN_SUBJECT_PREFIX}${senderDomain}`
  return null
}

/**
 * Split a `subjectKey` back into its kind and value.
 *
 * A bare prefix with no value (`list:`) parses as `null`, NOT as an empty value.
 * `mail-unsubscribe`'s `buildSubjectKeyPredicate` throws on a null parse, so this
 * guard is what stops a malformed key compiling to `listId = ''` — a predicate that
 * matches nothing and would report every sender as honoring their unsubscribe.
 */
export function parseSubjectKey(
  subjectKey: string
): { kind: 'list' | 'domain'; value: string } | null {
  if (subjectKey.startsWith(LIST_SUBJECT_PREFIX)) {
    const value = subjectKey.slice(LIST_SUBJECT_PREFIX.length)
    return value ? { kind: 'list', value } : null
  }
  if (subjectKey.startsWith(DOMAIN_SUBJECT_PREFIX)) {
    const value = subjectKey.slice(DOMAIN_SUBJECT_PREFIX.length)
    return value ? { kind: 'domain', value } : null
  }
  return null
}

/** The card's title: the list or domain, without the keyspace prefix. */
export function describeSubjectKey(subjectKey: string): string {
  return parseSubjectKey(subjectKey)?.value ?? subjectKey
}

/** Human labels for the card headings and the accept buttons. */
export const MAIL_SUGGESTION_KIND_LABELS: Record<MailSuggestionKind, string> = {
  unsubscribe: 'Unsubscribe & archive',
  'auto-archive': 'Archive automatically',
  'auto-tag': 'Tag automatically',
  'auto-assign': 'Assign automatically',
  'route-inbox': 'Move to another inbox',
}

/**
 * Which unsubscribe tier the parsed headers support (§6.1).
 *
 * `oneClick` requires the RFC 8058 `List-Unsubscribe-Post` header AND an http
 * URL — we never POST a URL without it, because a bare GET target is usually a
 * confirmation page and POSTing an arbitrary URL on a user's behalf is not ours
 * to do.
 */
export function resolveUnsubscribeMethod(
  meta: MailUnsubscribeMeta | null | undefined
): MailUnsubscribeMethod | null {
  if (!meta) return null
  if (meta.oneClick === true && meta.httpUrl) return 'one-click'
  if (meta.httpUrl) return 'http'
  if (meta.mailto) return 'mailto'
  return null
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The evidence line under the card title — *"34 emails in 90 days · none opened
 * · never replied"*.
 *
 * Reads only {@link MailSuggestionEvidence}, never the database: the whole point
 * of storing evidence on the row is that rendering a card costs no query.
 */
export function describeMailSuggestion(evidence: MailSuggestionEvidence): string {
  const parts: string[] = [
    `${plural(evidence.messageCount, 'email')} in ${evidence.windowDays} days`,
  ]

  if (evidence.unreadRate >= 0.999) parts.push('none opened')
  else if (evidence.unreadRate > 0) parts.push(`${Math.round(evidence.unreadRate * 100)}% unopened`)

  if (evidence.manualArchiveRate > 0) {
    parts.push(`${Math.round(evidence.manualArchiveRate * 100)}% archived by hand`)
  }

  parts.push(evidence.everReplied ? 'replied at least once' : 'never replied')
  return parts.join(' · ')
}
