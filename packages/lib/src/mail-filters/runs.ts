// packages/lib/src/mail-filters/runs.ts
// The MailFilterRun claim protocol (plan §3, invariant 4).
//
// These functions may throw; the never-throws contract lives in the engine,
// which wraps them (the gate fails open — invariant 3).

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import type {
  MailFilterActionOutcome,
  MailFilterRunSource,
  MailFilterRunStatus,
  MailFilterUndoState,
} from './types'

export interface ClaimMailFilterRunInput {
  organizationId: string
  filterId: string
  threadId: string
  messageId: string
  source: MailFilterRunSource
}

/**
 * Claim the right to execute one filter against one message — **before** the
 * actions run.
 *
 * ⚠️ THIS IS NOT A LOG WRITE. The row is inserted with
 * `ON CONFLICT ("filterId","messageId","source") DO NOTHING RETURNING id`, so
 * the unique index gates **execution**, not merely the audit trail. Callers MUST
 * bail when this returns `null`: a `null` means another attempt already owns
 * this (filter, message, source) and the actions must not run again.
 *
 * Why it has to be this way round: a `publishEventJob` retry re-runs the gate.
 * The six mail actions are repeat-safe (set-status, add-tag, assign, move-inbox,
 * set-read and suppress are last-writer-identical), but **`run-agent` and
 * `run-workflow` are not** — they enqueue work that replies to a customer. If
 * the run row were written *after* execution, the retry would enqueue first and
 * no-op the log write second: two agent replies to the same customer, which is
 * precisely the failure the gate exists to prevent, arriving through the back
 * door. The claim is their ONLY protection.
 *
 * A refactor that moves this to "log after execution" silently reintroduces
 * double-replies — it will pass every test that only checks the run history.
 *
 * The row is claimed with `status: 'failed'` so a process that dies mid-run
 * leaves a visible failure rather than a phantom success;
 * {@link completeMailFilterRun} overwrites it with the real outcome. `undo` is
 * left null for the same reason it must be: the pre-action state has not been
 * captured yet at claim time.
 */
export async function claimMailFilterRun(
  db: Database,
  input: ClaimMailFilterRunInput
): Promise<string | null> {
  const [row] = await db
    .insert(schema.MailFilterRun)
    .values({
      organizationId: input.organizationId,
      filterId: input.filterId,
      threadId: input.threadId,
      messageId: input.messageId,
      source: input.source,
      outcomes: [],
      status: 'failed',
    })
    .onConflictDoNothing({
      target: [
        schema.MailFilterRun.filterId,
        schema.MailFilterRun.messageId,
        schema.MailFilterRun.source,
      ],
    })
    .returning({ id: schema.MailFilterRun.id })

  return row?.id ?? null
}

export interface CompleteMailFilterRunInput {
  outcomes: MailFilterActionOutcome[]
  status: MailFilterRunStatus
  /**
   * Pre-action thread state, captured by the executor before it wrote anything.
   * Null when the filter's actions are all irreversible (e.g. only
   * `suppress-automations` / `run-workflow`), which is what disables Undo in the
   * UI rather than offering a button that does nothing.
   */
  undo?: MailFilterUndoState | null
}

/**
 * Close out a claimed run with its per-action outcomes and the undo blob.
 *
 * The counterpart of {@link claimMailFilterRun} — the UPDATE half of the claim
 * protocol. Keyed by run id alone: the id came from our own claim insert, and
 * scoping it again by org would only hide a bug in the caller.
 */
export async function completeMailFilterRun(
  db: Database,
  runId: string,
  input: CompleteMailFilterRunInput
): Promise<void> {
  await db
    .update(schema.MailFilterRun)
    .set({
      outcomes: input.outcomes,
      status: input.status,
      undo: input.undo ?? null,
    })
    .where(eq(schema.MailFilterRun.id, runId))
}

/**
 * Stamp a run as reversed (§6.3's thread-badge Undo).
 *
 * Idempotent by construction: the WHERE clause requires `undoneAt IS NULL`, so a
 * second Undo click writes nothing and returns `false` rather than re-stamping a
 * newer timestamp over the original reversal. The caller reverses the thread
 * state from `undo` FIRST and stamps second — a `false` here means someone else
 * already undid this firing.
 */
export async function markMailFilterRunUndone(
  db: Database,
  organizationId: string,
  runId: string
): Promise<boolean> {
  const rows = await db
    .update(schema.MailFilterRun)
    .set({ undoneAt: new Date() })
    .where(
      and(
        eq(schema.MailFilterRun.id, runId),
        eq(schema.MailFilterRun.organizationId, organizationId),
        isNull(schema.MailFilterRun.undoneAt)
      )
    )
    .returning({ id: schema.MailFilterRun.id })

  return rows.length > 0
}
