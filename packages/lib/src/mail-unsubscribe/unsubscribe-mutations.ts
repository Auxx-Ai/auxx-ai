// packages/lib/src/mail-unsubscribe/unsubscribe-mutations.ts
// Writes for MailUnsubscribe. Functional Drizzle + neverthrow — no service class.
//
// ZERO permission checks (lib-module-guide §6). The router decides the §7.1
// branch before calling in here; what lives here is integrity only: org scope
// and the `(organizationId, inboxId, subjectKey)` uniqueness that makes "never
// unsubscribe twice from the same list" a database fact rather than a hope.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, NotFoundError } from '../errors'
import type { UnsubscribeMethod, UnsubscribeStatus } from './client'
import { type MailUnsubscribeRow, toMailUnsubscribeRow } from './types'

export interface UpsertMailUnsubscribeInput {
  organizationId: string
  inboxId: string
  subjectKey: string
  method: UnsubscribeMethod
  requestedByUserId: string | null
  status?: UnsubscribeStatus
}

/**
 * Record an unsubscribe request, upserting on the unique
 * `(organizationId, inboxId, subjectKey)` index (§6.4).
 *
 * The conflict branch deliberately does NOT reset `requestedAt` or the
 * `messagesSeenAfter` / `lastSeenAfterAt` counters: those measure "has this
 * sender honored us since we asked", and a re-request that rewound the clock
 * would erase the evidence that they ignored the first one. It updates only the
 * method actually used, the requester and the status — a retry that upgraded
 * from `failed` to `requested` is the case worth reflecting.
 *
 * Callers should still check {@link import('./unsubscribe-queries').getMailUnsubscribe}
 * first and short-circuit; this upsert is the race-safe floor under that check,
 * not a replacement for it — we do not want to POST a third party twice because
 * two tabs clicked at once.
 */
export async function upsertMailUnsubscribe(
  db: Database,
  input: UpsertMailUnsubscribeInput
): Promise<Result<MailUnsubscribeRow, Error>> {
  const now = new Date()
  const [row] = await db
    .insert(schema.MailUnsubscribe)
    .values({
      organizationId: input.organizationId,
      inboxId: input.inboxId,
      subjectKey: input.subjectKey,
      method: input.method,
      requestedByUserId: input.requestedByUserId,
      status: input.status ?? 'requested',
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.MailUnsubscribe.organizationId,
        schema.MailUnsubscribe.inboxId,
        schema.MailUnsubscribe.subjectKey,
      ],
      set: {
        method: sql`excluded."method"`,
        requestedByUserId: sql`excluded."requestedByUserId"`,
        status: sql`excluded."status"`,
        updatedAt: now,
      },
    })
    .returning()

  if (!row) return err(new AuxxError('Failed to record the unsubscribe request'))
  return ok(toMailUnsubscribeRow(row))
}

/**
 * Move one record's status — `failed` when a tier's execution blew up,
 * `confirmed` when the endpoint accepted, `ignored` when the sweep job decides
 * the sender never honored it (§6.4).
 */
export async function setMailUnsubscribeStatus(
  db: Database,
  organizationId: string,
  id: string,
  status: UnsubscribeStatus
): Promise<Result<MailUnsubscribeRow, Error>> {
  const [row] = await db
    .update(schema.MailUnsubscribe)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.MailUnsubscribe.id, id),
        eq(schema.MailUnsubscribe.organizationId, organizationId)
      )
    )
    .returning()

  if (!row) return err(new NotFoundError('Unsubscribe record not found'))
  return ok(toMailUnsubscribeRow(row))
}

/**
 * Persist one sweep observation: how much mail from this group has arrived
 * since we asked, and when the newest of it landed.
 *
 * Absolute values, not increments — the sweep recounts the whole
 * `> requestedAt` window each pass, so a re-run (or a job retry) converges
 * rather than double-counting.
 */
export async function applyUnsubscribeSweepObservation(
  db: Database,
  id: string,
  observation: {
    messagesSeenAfter: number
    lastSeenAfterAt: Date | null
    status?: UnsubscribeStatus
  }
): Promise<Result<void, Error>> {
  await db
    .update(schema.MailUnsubscribe)
    .set({
      messagesSeenAfter: observation.messagesSeenAfter,
      lastSeenAfterAt: observation.lastSeenAfterAt,
      ...(observation.status ? { status: observation.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.MailUnsubscribe.id, id))

  return ok(undefined)
}
