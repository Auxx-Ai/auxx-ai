// packages/lib/src/mail-filters/mutations.ts
// Writes for MailFilter. Functional Drizzle + neverthrow — no service class.
//
// ZERO permission checks (§5, lib-module-guide §6). The router decides the §5.1
// branch (own personal inbox ⇒ allowed; shared inbox ⇒ automationRules.manage +
// inbox write) and rejects the keyed actions for an unkeyed author (invariant
// 15) BEFORE calling in here. What lives here is shape and integrity only: org
// scope, FK ownership, and the ordering invariant.

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, NotFoundError } from '../errors'
import {
  MAIL_FILTER_ACTION_TYPES,
  MAIL_FILTER_STATUSES,
  type MailFilterAction,
  type MailFilterInput,
  type MailFilterRow,
  toMailFilterRow,
} from './types'

/**
 * Validate a filter's shape before it is persisted (the tRPC create/update path).
 *
 * Invariants:
 * - `name` is non-empty — a filter is addressed by name in the list, the thread
 *   badge and the run history; an unnamed one is unreferenceable.
 * - `actions` is a non-empty array. A filter with no action is not a
 *   no-op — it still writes a run row and can `stopProcessing` the filters
 *   below it, so it silently swallows mail without doing anything.
 * - Every action's `type` is in the {@link MailFilterAction} union. jsonb accepts
 *   anything; an unknown type would be stored happily and then be skipped at
 *   fire time forever.
 * - Every action carries the operands its executor dereferences:
 *   `add-tag`/`remove-tag` a non-empty `tagIds`, `assign` an `assigneeId`,
 *   `move-inbox` an `inboxId`, `run-workflow` a `workflowAppId`, and `run-agent`
 *   BOTH `agentId` and `agentTriggerId` (the `executeAgentEventTrigger` payload
 *   requires the trigger — there is no "just run agent X" entry point).
 * - `set-status` writes one of the four statuses `ThreadUpdates.status` accepts
 *   for mail (`RESOLVED` is excluded — see {@link MailFilterAction}).
 *
 * Throws {@link BadRequestError}, which `auxxErrorMiddleware` maps to a 400.
 * Never a `TRPCError`: the same validator runs from the seeder and the worker.
 */
export function assertFilterShape(input: { name: string; actions: unknown }): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new BadRequestError('A filter needs a name')
  }
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new BadRequestError('A filter needs at least one action')
  }

  for (const raw of input.actions) {
    const action = raw as Partial<MailFilterAction> & Record<string, unknown>
    if (!action?.type || !MAIL_FILTER_ACTION_TYPES.includes(action.type)) {
      throw new BadRequestError(`Unknown filter action '${String(action?.type)}'`)
    }

    switch (action.type) {
      case 'set-status': {
        const status = action.status as (typeof MAIL_FILTER_STATUSES)[number]
        if (!status || !MAIL_FILTER_STATUSES.includes(status)) {
          throw new BadRequestError(`Unsupported filter status '${String(action.status)}'`)
        }
        break
      }
      case 'add-tag':
      case 'remove-tag': {
        const tagIds = action.tagIds
        if (!Array.isArray(tagIds) || tagIds.length === 0) {
          throw new BadRequestError(`A '${action.type}' action needs at least one tag`)
        }
        break
      }
      case 'assign':
        if (!action.assigneeId) throw new BadRequestError("An 'assign' action needs an assignee")
        break
      case 'move-inbox':
        if (!action.inboxId) throw new BadRequestError("A 'move-inbox' action needs an inbox")
        break
      case 'run-agent':
        if (!action.agentId || !action.agentTriggerId) {
          throw new BadRequestError("A 'run-agent' action needs both an agent and a trigger")
        }
        break
      case 'run-workflow':
        if (!action.workflowAppId) {
          throw new BadRequestError("A 'run-workflow' action needs a workflow")
        }
        break
      default:
        break
    }
  }
}

/**
 * Create a filter at the end of its inbox's evaluation order.
 *
 * `order` is computed by a scalar subquery INSIDE the INSERT rather than by a
 * read-then-write: two members adding a filter to the same shared inbox
 * concurrently would otherwise both read the same `max(order)` and land on the
 * same slot, which makes their relative evaluation order — and therefore
 * `stopProcessing` — arbitrary.
 */
export async function createMailFilter(
  db: Database,
  organizationId: string,
  input: MailFilterInput,
  createdByUserId?: string
): Promise<Result<MailFilterRow, Error>> {
  try {
    assertFilterShape(input)
  } catch (error) {
    return err(error as Error)
  }

  const [row] = await db
    .insert(schema.MailFilter)
    .values({
      organizationId,
      inboxId: input.inboxId,
      name: input.name.trim(),
      order: sql<number>`(
        SELECT COALESCE(MAX(${schema.MailFilter.order}), -1) + 1
        FROM ${schema.MailFilter}
        WHERE ${schema.MailFilter.organizationId} = ${organizationId}
          AND ${schema.MailFilter.inboxId} = ${input.inboxId}
      )`,
      conditions: input.conditions ?? [],
      actions: input.actions,
      stopProcessing: input.stopProcessing ?? false,
      enabled: input.enabled ?? true,
      createdByUserId: createdByUserId ?? null,
      templateKey: input.templateKey ?? null,
    })
    .returning()

  return ok(toMailFilterRow(row!))
}

/**
 * Editable fields.
 *
 * `inboxId` is deliberately not patchable: it is the containment boundary
 * (§4.4) AND the namespace `order` is unique within, so a move would have to
 * re-authorize against the destination inbox and re-slot the filter in one go.
 * Moving a filter is delete-and-recreate, which re-runs both checks by
 * construction. `templateKey` is likewise fixed — it is a seed identity, not a
 * user field.
 */
export type UpdateMailFilterInput = Partial<Omit<MailFilterInput, 'inboxId' | 'templateKey'>>

/**
 * Patch a filter. The merged result is re-validated, not just the delta — an
 * `actions`-only edit must still be checked against the row's `name`, and vice
 * versa (the record-rules precedent in `assertRuleShape`'s caller).
 */
export async function updateMailFilter(
  db: Database,
  organizationId: string,
  filterId: string,
  input: UpdateMailFilterInput
): Promise<Result<MailFilterRow, Error>> {
  const [existing] = await db
    .select()
    .from(schema.MailFilter)
    .where(
      and(eq(schema.MailFilter.id, filterId), eq(schema.MailFilter.organizationId, organizationId))
    )
    .limit(1)
  if (!existing) return err(new NotFoundError('Filter not found'))

  try {
    assertFilterShape({
      name: input.name ?? existing.name,
      actions: input.actions ?? existing.actions,
    })
  } catch (error) {
    return err(error as Error)
  }

  const [row] = await db
    .update(schema.MailFilter)
    .set({
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.conditions !== undefined && { conditions: input.conditions }),
      ...(input.actions !== undefined && { actions: input.actions }),
      ...(input.stopProcessing !== undefined && { stopProcessing: input.stopProcessing }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.MailFilter.id, filterId), eq(schema.MailFilter.organizationId, organizationId))
    )
    .returning()

  return ok(toMailFilterRow(row!))
}

/**
 * Enable/disable one filter. Separate from {@link updateMailFilter} because the
 * list card toggles it without opening the dialog — and because a disabled
 * filter still occupies a plan slot (§5.2), so this is not a soft delete.
 */
export async function setMailFilterEnabled(
  db: Database,
  organizationId: string,
  filterId: string,
  enabled: boolean
): Promise<Result<MailFilterRow, Error>> {
  const [row] = await db
    .update(schema.MailFilter)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(eq(schema.MailFilter.id, filterId), eq(schema.MailFilter.organizationId, organizationId))
    )
    .returning()

  if (!row) return err(new NotFoundError('Filter not found'))
  return ok(toMailFilterRow(row))
}

/**
 * Rewrite the evaluation order of ONE inbox's filters in a single transaction.
 *
 * Two guards, both load-bearing:
 * - every supplied id must belong to this org AND this inbox, or a caller could
 *   renumber another inbox's (or another org's) filters by id;
 * - the list must be COMPLETE. `order` has to stay a total order within the
 *   inbox: a partial rewrite leaves the omitted filters on their old numbers,
 *   which collides with the new ones and makes evaluation order — and therefore
 *   `stopProcessing` — arbitrary. The UI always reorders a full inbox group, so
 *   an incomplete list is a bug, not a use case.
 */
export async function reorderMailFilters(
  db: Database,
  organizationId: string,
  inboxId: string,
  orderedFilterIds: string[]
): Promise<Result<void, Error>> {
  if (orderedFilterIds.length === 0) return ok(undefined)

  const unique = new Set(orderedFilterIds)
  if (unique.size !== orderedFilterIds.length) {
    return err(new BadRequestError('Reorder contains duplicate filter ids'))
  }

  const existing = await db
    .select({ id: schema.MailFilter.id })
    .from(schema.MailFilter)
    .where(
      and(
        eq(schema.MailFilter.organizationId, organizationId),
        eq(schema.MailFilter.inboxId, inboxId)
      )
    )
    .orderBy(asc(schema.MailFilter.order))

  const existingIds = new Set(existing.map((r) => r.id))
  const foreign = orderedFilterIds.find((id) => !existingIds.has(id))
  if (foreign) {
    return err(new BadRequestError(`Filter ${foreign} does not belong to this inbox`))
  }
  if (existingIds.size !== unique.size) {
    return err(new BadRequestError('Reorder must list every filter in the inbox'))
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    for (const [index, filterId] of orderedFilterIds.entries()) {
      await tx
        .update(schema.MailFilter)
        .set({ order: index, updatedAt: now })
        .where(
          and(
            eq(schema.MailFilter.id, filterId),
            eq(schema.MailFilter.organizationId, organizationId),
            eq(schema.MailFilter.inboxId, inboxId)
          )
        )
    }
  })

  return ok(undefined)
}

/**
 * Delete a filter.
 *
 * **Seeded filters (`templateKey` set) ARE deletable** — unlike seeded
 * sequences, which `deleteSequence` refuses. A suggested filter is a suggestion:
 * it mutates the user's own mail on our recommendation, so "no, you may not
 * remove it" is the wrong answer, and disable-only would leave a permanently
 * unwanted card in their list. They stay excluded from the billable count
 * (`limits.ts`) for the separate reason that we provisioned them.
 *
 * `MailFilterRun` rows survive on purpose (no FK, plan §1): deleting a filter
 * must not erase the audit trail of what it already did to people's mail.
 */
export async function deleteMailFilter(
  db: Database,
  organizationId: string,
  filterId: string
): Promise<Result<void, Error>> {
  const rows = await db
    .delete(schema.MailFilter)
    .where(
      and(eq(schema.MailFilter.id, filterId), eq(schema.MailFilter.organizationId, organizationId))
    )
    .returning({ id: schema.MailFilter.id })

  if (rows.length === 0) return err(new NotFoundError('Filter not found'))
  return ok(undefined)
}

/**
 * Stamp `lastFiredAt` on every filter that fired in one batch. DISPLAY ONLY —
 * list subtitles and staleness hints. It is never part of the idempotency
 * decision, which is the `MailFilterRun` claim (§3); treating this timestamp as a
 * "did it already run" signal would double-fire on any clock or replication skew.
 *
 * One statement per firing batch, and deliberately the ONLY variant: the engine
 * always has the fired set in hand, so a single-id twin was dead weight that
 * would drift.
 *
 * Best-effort: the engine wraps it, and a failed stamp must not fail the run.
 */
export async function touchLastFiredAtMany(
  db: Database,
  organizationId: string,
  filterIds: string[]
): Promise<void> {
  if (filterIds.length === 0) return
  await db
    .update(schema.MailFilter)
    .set({ lastFiredAt: new Date() })
    .where(
      and(
        eq(schema.MailFilter.organizationId, organizationId),
        inArray(schema.MailFilter.id, filterIds)
      )
    )
}
