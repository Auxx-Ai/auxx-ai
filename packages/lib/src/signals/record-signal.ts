// packages/lib/src/signals/record-signal.ts
// The ONLY writer for `EntitySignal`/`EntitySignalLink` rows (client-notifications plan
// §4.1 decision #16 — a scoped slice of plans/signals/01-signal-store.md). Every signal
// writer — the sequence send node, the manual document-send path (a later phase) — must go
// through `recordSignal()`, never an inline insert, so the full signals plan builds
// additively on these rows later.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { Result, type TypedResult } from '../result'

const logger = createScopedLogger('signals-record')

/** `EntitySignalLink.recordKey` root — string keys because visits aren't `EntityInstance`s. */
export type SignalRecordKind = 'contact' | 'work_order' | 'visit' | 'invoice' | 'quote'

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
}

/**
 * Insert an `EntitySignal` + one `EntitySignalLink` per `links` entry. Insert-only — rows are
 * never updated. On a `dedupeKey` conflict (checked up front, and again via the unique index
 * if two writers race), does nothing and returns `Result.ok(null)` — an engine retry that
 * re-runs a send node after its signal write already landed must not double-write.
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
  } = input

  try {
    if (dedupeKey) {
      const existing = await database.query.EntitySignal.findFirst({
        where: and(
          eq(schema.EntitySignal.organizationId, organizationId),
          eq(schema.EntitySignal.dedupeKey, dedupeKey)
        ),
        columns: { id: true },
      })
      if (existing) return Result.ok(null)
    }

    const signalId = generateId()
    await database.transaction(async (tx) => {
      await tx.insert(schema.EntitySignal).values({
        id: signalId,
        organizationId,
        kind,
        subtype,
        occurredAt,
        dedupeKey: dedupeKey ?? null,
        contactEntityInstanceId: contactEntityInstanceId ?? null,
        messageId: messageId ?? null,
        threadId: threadId ?? null,
        title,
        metadata: metadata ?? null,
      })

      if (links.length > 0) {
        await tx.insert(schema.EntitySignalLink).values(
          links.map((recordKey) => ({
            id: generateId(),
            organizationId,
            signalId,
            recordKey,
          }))
        )
      }
    })

    return Result.ok({ id: signalId })
  } catch (error) {
    // A dedupeKey race (two concurrent writers passing the pre-check above at the same
    // time) surfaces as a unique-constraint violation here — treat it the same as the
    // pre-check hit, not a hard failure.
    if (dedupeKey && error instanceof Error && /unique|duplicate/i.test(error.message)) {
      return Result.ok(null)
    }
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
