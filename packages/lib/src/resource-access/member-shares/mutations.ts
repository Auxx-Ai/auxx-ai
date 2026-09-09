// packages/lib/src/resource-access/member-shares/mutations.ts

import { schema } from '@auxx/database'
import { ResourceGranteeType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNotNull, notInArray, or, type SQL } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../../errors'
import { isMailSharingDef } from '../mail-sharing-defs'
import {
  emitResourceAccessChanged,
  emitResourceAccessInstanceChanged,
} from '../resource-access-service'
import type { MailRefusal, MemberShareCtx } from './queries'
import { memberGranteePredicate, resolveMailRefusals, sharedRowPredicate } from './queries'

const logger = createScopedLogger('member-shares')

const RA = schema.ResourceAccess

/**
 * Upper bound on an `{ kind: 'ids' }` revoke.
 *
 * Not a row cap on the write — the `all` and `type` scopes exist precisely so a
 * sweep never has to enumerate ids — but a bound on how large a single tRPC
 * input may be. A caller that wants more than this wants a scope.
 */
export const MAX_REVOKE_RECORD_IDS = 500

/**
 * What a bulk revoke targets.
 *
 * A SCOPE, not a list of ids, and that is the whole design (§4.1): a paginated
 * list plus an id-list mutation means "Remove all" silently misses every unloaded
 * row — the exact failure this feature exists to prevent.
 */
export type RevokeMemberSharesScope =
  | { kind: 'all' }
  | { kind: 'type'; entityDefinitionId: string }
  | { kind: 'ids'; recordIds: RecordId[] }

export interface RevokeMemberSharesResult {
  revoked: number
  refused: Array<{ reason: 'mail-authority'; count: number; label: string }>
  /**
   * Exactly which rows were left behind — the same rows the {@link refused}
   * counts summarize, itemized.
   *
   * The counts alone are what the summary toast reads ("Removed 380. 20
   * conversations in Support need inbox access"), but a bulk runner that marked
   * every selected row pending cannot tell from a count WHICH overlays to clear,
   * so it has to clear all of them on any partial refusal. These ids make that
   * exact. Free to produce: the refusal pass already reads each row's def and
   * instance id to run the per-inbox check.
   *
   * Empty whenever `refused` is empty, and empty when the mail guard is skipped
   * (the offboarding sweep, §7).
   */
  refusedIds: RecordId[]
}

/**
 * Revoke, in ONE `DELETE ... RETURNING`, the `ResourceAccess` rows addressed
 * directly to a member (plan 46 §4).
 *
 * Three things are non-negotiable here:
 *
 * 1. **Owner rows are excluded in SQL, in every scope.** 96% of the `user`-grantee
 *    rows in the dev database are self-granted — the member's own snippets,
 *    dashboards, signature and personal mailbox. Filtering them out in the caller
 *    would make the UI the safety mechanism; {@link sharedRowPredicate} makes the
 *    database it.
 * 2. **Type-level rows are never swept** (decision 8). They are the largest grant
 *    a member can hold, they are a permissions decision rather than a share, and
 *    they are edited on the Permissions tab. Hence `isNotNull(entityInstanceId)`.
 * 3. **Emits fire once per distinct def, after the delete** — never per row. A
 *    per-row loop turns a 340-row sweep into 340 cache-invalidation fan-outs.
 *
 * Authorization for NON-mail rows is the router's (`members.manage` +
 * `canManageTarget`, §4.2). Mail rows keep their own per-inbox guard, applied
 * here because it decides which rows the `DELETE` may touch; refused rows are
 * counted into `refused` and left alone, never silently dropped.
 */
export async function revokeMemberShares(
  ctx: MemberShareCtx,
  params: {
    userId: string
    scope: RevokeMemberSharesScope
    /**
     * Whether to apply the per-inbox mail guard (§5.2). Defaults to true.
     *
     * The offboarding sweep (§7) passes `false`: it runs after the
     * `OrganizationMember` row is already gone, so there is no membership to
     * authorize against and the rows are dead weight. Leaving them means a
     * re-invite silently restores every share the person ever had.
     * `personal_inbox` still survives, by {@link sharedRowPredicate}.
     */
    enforceMailAuthority?: boolean
  }
): Promise<Result<RevokeMemberSharesResult, Error>> {
  const enforceMailAuthority = params.enforceMailAuthority ?? true

  try {
    const base = and(
      memberGranteePredicate(ctx.organizationId, params.userId),
      // Instance rows only — see (2) above.
      isNotNull(RA.entityInstanceId),
      // Owner rows excluded in SQL — see (1) above.
      sharedRowPredicate(),
      scopePredicate(params.scope)
    ) as SQL

    const refused: Map<string, RefusedRow> = enforceMailAuthority
      ? await collectMailRefusals(ctx, base)
      : new Map()

    const where =
      refused.size > 0 ? (and(base, notInArray(RA.id, [...refused.keys()])) as SQL) : base

    const deleted = await ctx.db
      .delete(RA)
      .where(where)
      .returning({ id: RA.id, entityDefinitionId: RA.entityDefinitionId })

    await emitForDeletedRows(ctx, params.userId, deleted)

    const refusedRows = [...refused.values()]
    return ok({
      revoked: deleted.length,
      refused: summarizeRefusals(refusedRows),
      refusedIds: refusedRows.map((row) => row.recordId),
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to revoke member shares', {
      error,
      organizationId: ctx.organizationId,
      userId: params.userId,
      scope: params.scope.kind,
    })
    return err(new AuxxError('Internal error'))
  }
}

function scopePredicate(scope: RevokeMemberSharesScope): SQL | undefined {
  if (scope.kind === 'all') return undefined
  if (scope.kind === 'type') return eq(RA.entityDefinitionId, scope.entityDefinitionId)

  if (scope.recordIds.length === 0) {
    throw new BadRequestError('No records selected')
  }
  if (scope.recordIds.length > MAX_REVOKE_RECORD_IDS) {
    throw new BadRequestError(
      `Too many records selected. Use a type or all scope for more than ${MAX_REVOKE_RECORD_IDS}.`
    )
  }
  const pairs = scope.recordIds.map((recordId) => {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    if (!entityDefinitionId || !entityInstanceId) {
      throw new BadRequestError(`Malformed record id: ${recordId}`)
    }
    return and(
      eq(RA.entityDefinitionId, entityDefinitionId),
      eq(RA.entityInstanceId, entityInstanceId)
    ) as SQL
  })
  return or(...pairs) as SQL
}

/**
 * The mail rows in scope that this viewer may NOT revoke, keyed by row id.
 *
 * Selected BEFORE the delete because a `DELETE ... RETURNING` is one statement:
 * the exclusion has to be expressible as a predicate, so the refused row ids must
 * already be known. Checked per distinct inbox by {@link resolveMailRefusals}.
 */
/** A refusal plus the `RecordId` of the row it kept — see `refusedIds`. */
interface RefusedRow extends MailRefusal {
  recordId: RecordId
}

async function collectMailRefusals(
  ctx: MemberShareCtx,
  base: SQL
): Promise<Map<string, RefusedRow>> {
  const mailRows = await ctx.db
    .select({
      id: RA.id,
      entityDefinitionId: RA.entityDefinitionId,
      entityInstanceId: RA.entityInstanceId,
    })
    .from(RA)
    .where(and(base, inArray(RA.entityDefinitionId, [...MAIL_DEFS])) as SQL)

  const refusals = new Map<string, RefusedRow>()
  if (mailRows.length === 0) return refusals

  const byDef = new Map<string, Array<{ id: string; instanceId: string }>>()
  for (const row of mailRows) {
    if (!row.entityInstanceId || !isMailSharingDef(row.entityDefinitionId)) continue
    const list = byDef.get(row.entityDefinitionId) ?? []
    list.push({ id: row.id, instanceId: row.entityInstanceId })
    byDef.set(row.entityDefinitionId, list)
  }

  await Promise.all(
    [...byDef.entries()].map(async ([defId, rows]) => {
      const perInstance = await resolveMailRefusals(
        ctx,
        defId,
        rows.map((r) => r.instanceId)
      )
      for (const row of rows) {
        const refusal = perInstance.get(row.instanceId)
        if (refusal) {
          refusals.set(row.id, { ...refusal, recordId: toRecordId(defId, row.instanceId) })
        }
      }
    })
  )
  return refusals
}

/** The four mail keyspaces (`resource-access/mail-sharing-defs.ts`). */
const MAIL_DEFS = ['inbox', 'personal_inbox', 'thread', 'contact'] as const

/**
 * Cache invalidation for the whole sweep: ONE `resource-access.changed` for the
 * grantee, then ONE instance-level emit per DISTINCT def.
 *
 * `emitResourceAccessInstanceChanged` takes the def id only to decide whether the
 * org-wide `governingInstanceIds` key needs recomputing, so per-def is the exact
 * granularity it needs — and per-row would repeat identical work N times.
 *
 * `emitResourceAccessTypeChanged` is deliberately NOT called: this mutation never
 * deletes a type-level row, so no `defAccess` map can have changed.
 */
async function emitForDeletedRows(
  ctx: MemberShareCtx,
  granteeId: string,
  deleted: Array<{ entityDefinitionId: string }>
): Promise<void> {
  if (deleted.length === 0) return
  const grantees = [{ granteeType: ResourceGranteeType.user, granteeId }]
  await emitResourceAccessChanged(ctx.organizationId, grantees)

  const defs = [...new Set(deleted.map((row) => row.entityDefinitionId))]
  for (const entityDefinitionId of defs) {
    await emitResourceAccessInstanceChanged(ctx.organizationId, grantees, entityDefinitionId)
  }
}

/** Collapse per-row refusals into the `{ reason, count, label }` triples §4.1 returns. */
function summarizeRefusals(refusals: MailRefusal[]): RevokeMemberSharesResult['refused'] {
  const byLabel = new Map<string, number>()
  for (const refusal of refusals) {
    byLabel.set(refusal.label, (byLabel.get(refusal.label) ?? 0) + 1)
  }
  return [...byLabel.entries()]
    .map(([label, count]) => ({ reason: 'mail-authority' as const, count, label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
