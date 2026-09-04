// packages/lib/src/signals/record-signal.ts
// The ONLY writer for `EntitySignal`/`EntitySignalLink` rows (client-notifications plan
// §4.1 decision #16 — a scoped slice of plans/signals/01-signal-store.md). Every signal
// writer — the sequence send node, the manual document-send path (a later phase) — must go
// through `recordSignal()` (or the `recordSignals()` bulk variant for webhook batches), never
// an inline insert, so the full signals plan builds additively on these rows later.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { publisher } from '../events/publisher'
import { Result, type TypedResult } from '../result'
import { applyRollupForSignal } from './rollup'
import type { SignalKind } from './types'

const logger = createScopedLogger('signals-record')

/**
 * `EntitySignalLink.recordKey` root — string keys because visits aren't `EntityInstance`s.
 *
 * ⚠️ Every `DocumentType` must be a member: `recordDocumentSendSignal` passes its
 * `documentType` straight into {@link toSignalRecordKey}, so a document type missing here is
 * a compile error at that call site (purchasing plan 07 §2.2 relies on that coupling).
 * `'purchase_order'` was added for the PO send path.
 *
 * Readers key off the composed string, not this union — `listSignalsForRecordKeys` takes
 * caller-built `recordKey`s and the rollup writer only ever looks at the `contact:` root — so
 * adding a member widens what can be LINKED without obliging any consumer to handle it.
 */
export type SignalRecordKind =
  | 'contact'
  | 'work_order'
  | 'visit'
  | 'invoice'
  | 'quote'
  | 'purchase_order'
  // Registered because `recordDocumentSendSignal` links whatever document type it
  // was handed, and the printing registry now holds a fourth. In practice a
  // deposit slip never reaches it - the send path refuses first - but the union
  // has to admit it or the shared helper stops compiling.
  | 'bank_deposit'

/**
 * Compose an `EntitySignalLink.recordKey` — the one place every writer/reader builds this
 * string, so `'contact:<id>'` / `'work_order:<id>'` / etc. stay consistent everywhere a
 * signal gets linked to or queried by record.
 */
export function toSignalRecordKey(kind: SignalRecordKind, id: string): string {
  return `${kind}:${id}`
}

export interface RecordSignalInput {
  organizationId: string
  /** Namespaced verb, e.g. `'message:sent'`. */
  kind: string
  /** Sub-discriminator, e.g. `'sequence_step' | 'document_send'`. */
  subtype: string
  /** Defaults to `new Date()`. */
  occurredAt?: Date
  /** Idempotency key (e.g. `'seq:<runId>:<stepIndex>'`) — a conflicting insert is a silent
   * no-op, returning `Result.ok(null)`. Omit for signals with no natural dedup key. */
  dedupeKey?: string
  contactEntityInstanceId?: string
  messageId?: string
  threadId?: string
  /** Subject-line snapshot — shown as the communications-timeline row's title. */
  title: string
  metadata?: Record<string, unknown>
  /** `toSignalRecordKey(...)` strings — the multi-record fan-out (`EntitySignalLink`). */
  links: string[]
  /** MPP/proxy/crawler verdict (signals plan 02). Bot-flagged signals still get inserted +
   * linked (for audit) but skip the rollup update entirely. Defaults to `false`. */
  isBot?: boolean
  /** True for identity-backfill writes (rollups still update — a backfilled open should still
   * move `lastOpenedAt` — but the count only increments when `occurredAt` is inside the
   * current 30d window, same as any other write). Flows into the published event so
   * automation consumers (Today nudges, sequence exits) can skip backfilled rows. Defaults
   * to `false`. */
  backfill?: boolean
}

/**
 * Insert an `EntitySignal` + one `EntitySignalLink` per `links` entry, then update the
 * contact's `EntitySignalRollup` row — all inside one transaction — then, once that commits,
 * publish a `'signal:recorded'` bus event (plans/signals/01-signal-store.md "Write path").
 * Insert-only — rows are never updated.
 *
 * Dedupe is a DB-level `onConflictDoNothing` against the partial unique index on
 * `(organizationId, dedupeKey) WHERE dedupeKey IS NOT NULL`. A conflicting insert writes
 * nothing — no links, no rollup, no publish — and returns `Result.ok(null)`: an engine retry
 * that re-runs a send node after its signal write already landed must not double-write or
 * re-fire rollups/rules/Today nudges.
 */
export async function recordSignal(
  input: RecordSignalInput
): Promise<TypedResult<{ id: string } | null, Error>> {
  const {
    organizationId,
    kind,
    subtype,
    occurredAt = new Date(),
    dedupeKey,
    contactEntityInstanceId,
    messageId,
    threadId,
    title,
    metadata,
    links,
    isBot = false,
    backfill = false,
  } = input

  try {
    let insertedId: string | null = null

    await database.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.EntitySignal)
        .values({
          organizationId,
          kind,
          subtype,
          occurredAt,
          dedupeKey: dedupeKey ?? null,
          isBot,
          contactEntityInstanceId: contactEntityInstanceId ?? null,
          messageId: messageId ?? null,
          threadId: threadId ?? null,
          title,
          metadata: metadata ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.EntitySignal.id })

      // Dedupe hit — the partial unique index on (organizationId, dedupeKey) rejected the
      // insert. Stop here: no links, no rollup, no publish.
      if (!inserted) return

      insertedId = inserted.id

      if (links.length > 0) {
        await tx.insert(schema.EntitySignalLink).values(
          links.map((recordKey) => ({
            organizationId,
            signalId: inserted.id,
            recordKey,
          }))
        )
      }

      if (contactEntityInstanceId && !isBot) {
        await applyRollupForSignal(tx, {
          organizationId,
          entityInstanceId: contactEntityInstanceId,
          kind,
          occurredAt,
          metadata,
        })
      }
    })

    if (!insertedId) return Result.ok(null)

    // Publish after the transaction commits — rollup state must be visible to any consumer
    // that reacts to this event and reads the rollup row (e.g. a record-rule condition).
    await publisher.publishLater({
      type: 'signal:recorded',
      data: {
        signalId: insertedId,
        organizationId,
        kind: kind as SignalKind,
        subtype,
        occurredAt,
        contactEntityInstanceId: contactEntityInstanceId ?? null,
        recordKeys: links,
        isBot,
        backfill,
      },
    })

    return Result.ok({ id: insertedId })
  } catch (error) {
    logger.error('recordSignal failed', {
      organizationId,
      kind,
      subtype,
      dedupeKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return Result.error(error instanceof Error ? error : new Error('recordSignal failed'))
  }
}

/** One prepared row awaiting insertion — id assigned up front so the post-insert `returning()`
 * set can be correlated back to its originating `RecordSignalInput` (needed to fan out links
 * and group publishes per contact). */
interface PreparedSignal {
  id: string
  input: RecordSignalInput
}

/**
 * Bulk variant of `recordSignal()` for webhook batches (e.g. a single SES/SNS delivery
 * notification batch touching many recipients). One transaction: bulk-insert every signal
 * (`onConflictDoNothing().returning()` — dedupe hits simply don't come back), bulk-insert
 * links for the inserted rows only, then one rollup application per inserted signal (grouped
 * conceptually per contact, applied in a loop — correctness over cleverness).
 *
 * After commit, publishes **one** `'signal:recorded'` event per distinct non-null contact
 * among the inserted rows (carrying the first inserted signal's fields plus `signalIds` for
 * the whole group — avoids bus flooding on a large batch), and one event per inserted signal
 * with a null contact (no grouping key, but its `recordKeys` still matter to consumers).
 * Deduped rows publish nothing.
 */
export async function recordSignals(
  inputs: RecordSignalInput[]
): Promise<TypedResult<{ id: string }[], Error>> {
  if (inputs.length === 0) return Result.ok([])

  const prepared: PreparedSignal[] = inputs.map((input) => ({ id: generateId(), input }))

  try {
    const insertedIds = new Set<string>()

    await database.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.EntitySignal)
        .values(
          prepared.map(({ id, input }) => ({
            id,
            organizationId: input.organizationId,
            kind: input.kind,
            subtype: input.subtype,
            occurredAt: input.occurredAt ?? new Date(),
            dedupeKey: input.dedupeKey ?? null,
            isBot: input.isBot ?? false,
            contactEntityInstanceId: input.contactEntityInstanceId ?? null,
            messageId: input.messageId ?? null,
            threadId: input.threadId ?? null,
            title: input.title,
            metadata: input.metadata ?? null,
          }))
        )
        .onConflictDoNothing()
        .returning({ id: schema.EntitySignal.id })

      for (const row of rows) insertedIds.add(row.id)

      const linkRows = prepared
        .filter(({ id }) => insertedIds.has(id))
        .flatMap(({ id, input }) =>
          input.links.map((recordKey) => ({
            organizationId: input.organizationId,
            signalId: id,
            recordKey,
          }))
        )
      if (linkRows.length > 0) {
        await tx.insert(schema.EntitySignalLink).values(linkRows)
      }

      for (const { id, input } of prepared) {
        if (!insertedIds.has(id)) continue
        if (!input.contactEntityInstanceId || input.isBot) continue
        await applyRollupForSignal(tx, {
          organizationId: input.organizationId,
          entityInstanceId: input.contactEntityInstanceId,
          kind: input.kind,
          occurredAt: input.occurredAt ?? new Date(),
          metadata: input.metadata,
        })
      }
    })

    const insertedRows = prepared.filter(({ id }) => insertedIds.has(id))

    const byContact = new Map<string, PreparedSignal[]>()
    const noContact: PreparedSignal[] = []
    for (const row of insertedRows) {
      const contactId = row.input.contactEntityInstanceId
      if (!contactId) {
        noContact.push(row)
        continue
      }
      const bucket = byContact.get(contactId)
      if (bucket) bucket.push(row)
      else byContact.set(contactId, [row])
    }

    const publishes: Promise<void>[] = []
    for (const rows of byContact.values()) {
      const first = rows[0]!
      publishes.push(
        publisher.publishLater({
          type: 'signal:recorded',
          data: {
            signalId: first.id,
            organizationId: first.input.organizationId,
            kind: first.input.kind as SignalKind,
            subtype: first.input.subtype,
            occurredAt: first.input.occurredAt ?? new Date(),
            contactEntityInstanceId: first.input.contactEntityInstanceId ?? null,
            recordKeys: [...new Set(rows.flatMap((row) => row.input.links))],
            isBot: first.input.isBot ?? false,
            backfill: first.input.backfill ?? false,
            signalIds: rows.map((row) => row.id),
          },
        })
      )
    }
    for (const row of noContact) {
      publishes.push(
        publisher.publishLater({
          type: 'signal:recorded',
          data: {
            signalId: row.id,
            organizationId: row.input.organizationId,
            kind: row.input.kind as SignalKind,
            subtype: row.input.subtype,
            occurredAt: row.input.occurredAt ?? new Date(),
            contactEntityInstanceId: null,
            recordKeys: row.input.links,
            isBot: row.input.isBot ?? false,
            backfill: row.input.backfill ?? false,
          },
        })
      )
    }
    await Promise.all(publishes)

    return Result.ok(insertedRows.map(({ id }) => ({ id })))
  } catch (error) {
    logger.error('recordSignals failed', {
      count: inputs.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return Result.error(error instanceof Error ? error : new Error('recordSignals failed'))
  }
}
