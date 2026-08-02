// packages/lib/src/mail-unsubscribe/types.ts
// Row shapes + input/output types for the mail-unsubscribe module. The
// client-safe vocabulary (tiers, refusals, subject keys) lives in `./client`;
// this file adds the DB-facing half.

// `@auxx/database/types` does not re-export the mail-suggestion entities; the
// package root does (`export * from './db/schema'`), and `import type` is fully
// erased so this costs nothing at runtime.
import type { AuditContext, MailUnsubscribeEntity } from '@auxx/database'
import type {
  UnsubscribeMethod,
  UnsubscribeOffer,
  UnsubscribeRefusal,
  UnsubscribeStatus,
} from './client'

/**
 * One `MailUnsubscribe` row, narrowed.
 *
 * `method` and `status` are `text` columns with `$type<...>()` on the schema, so
 * a row read straight from Drizzle is already narrow — this alias exists so
 * consumers import a stable name instead of the generated entity, and so the
 * mapper below is the one place a widening ever happens.
 */
export interface MailUnsubscribeRow {
  id: string
  organizationId: string
  inboxId: string
  /** `list:<listId>` or `domain:<senderDomain>`. */
  subjectKey: string
  method: UnsubscribeMethod
  requestedByUserId: string | null
  requestedAt: Date
  status: UnsubscribeStatus
  /** Newest inbound message from this group that arrived AFTER `requestedAt`. */
  lastSeenAfterAt: Date | null
  /** How many arrived after `requestedAt` — the "6 more since" number (§6.4). */
  messagesSeenAfter: number
  createdAt: Date
  updatedAt: Date
}

/** Narrow a raw `MailUnsubscribe` select into {@link MailUnsubscribeRow}. */
export function toMailUnsubscribeRow(row: MailUnsubscribeEntity): MailUnsubscribeRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    inboxId: row.inboxId,
    subjectKey: row.subjectKey,
    method: row.method,
    requestedByUserId: row.requestedByUserId,
    requestedAt: row.requestedAt,
    status: row.status,
    lastSeenAfterAt: row.lastSeenAfterAt,
    messagesSeenAfter: row.messagesSeenAfter,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * The newest inbound message for a subject key in one inbox — everything the
 * executor needs, read once.
 */
export interface UnsubscribeTarget {
  messageId: string
  threadId: string
  /** The channel the mail arrived on — the one the `mailto` tier replies FROM. */
  integrationId: string
  subject: string | null
  /** From-address of the sample message, for the audit/signal title. */
  senderIdentifier: string | null
  /** The CRM contact the sender maps to, when it maps to one. Null is normal. */
  contactEntityInstanceId: string | null
  /** The gate + tier decision for this group. */
  offer: UnsubscribeOffer
}

/** What {@link import('./execute-unsubscribe').executeUnsubscribe} was asked to do. */
export interface ExecuteUnsubscribeInput {
  organizationId: string
  /** The inbox `EntityInstance` id. */
  inboxId: string
  /** `list:<listId>` or `domain:<senderDomain>`. */
  subjectKey: string
  /** Who asked. Stamped on the row, the audit entry and the outbound send. */
  userId: string
  /**
   * Whether this inbox is SHARED (an `inbox` def instance rather than a
   * `personal_inbox` one). Supplied by the router, never derived here: lib holds
   * no authority. Drives the audit row (§6.4, invariant 11) — a shared-inbox
   * unsubscribe stops the mail for colleagues who never saw the dialog.
   */
  isSharedInbox: boolean
  /** Request IP/UA/session for the audit row, when the caller has them. */
  auditContext?: AuditContext
}

/**
 * The outcome of an unsubscribe attempt.
 *
 * `refused` is an OUTCOME, not an error: the UI renders the alternative
 * ("block sender / filter to spam") rather than a failure toast.
 */
export type ExecuteUnsubscribeOutcome =
  | { status: 'refused'; refusal: UnsubscribeRefusal }
  /** Already unsubscribed from this list in this inbox — never twice (§6.4). */
  | { status: 'already-requested'; record: MailUnsubscribeRow }
  | {
      status: 'requested'
      method: UnsubscribeMethod
      /**
       * ONLY set for the `http` tier: the URL the CLIENT must open in a new
       * tab. We never POST a URL without the RFC 8058 one-click header.
       */
      openUrl?: string
      record: MailUnsubscribeRow
    }
