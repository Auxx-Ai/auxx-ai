// packages/lib/src/inventory/builds/movement-account-fix.ts

import { type Database, withAccountingCommitLock } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { dayKeyInZone } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { DOC_NUMBER_PREFIX } from '../../accounting/ledger/builders/doc-number'
import { ACCOUNT_ROLE_LABELS, buildEntry } from '../../accounting/ledger/builders/entry'
import { hashedPeriodKey } from '../../accounting/ledger/periods/period-key'
import { didLedgerAccept } from '../../accounting/ledger/post/ledger-accepted'
import { postEntry } from '../../accounting/ledger/post/post-entry'
import {
  INVENTORY_ACCOUNT_FIX_SOURCE,
  readInventoryAccountFixTotals,
} from '../../accounting/ledger/reads/inventory-account-fix'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import type { GlPostingLineInput } from '../../accounting/ledger/types'
import { UnprocessableEntityError } from '../../errors'
import { type MovementAccountRestamp, restampMovementAccounts } from '../movements/restamp-accounts'
import { guard } from './guard'
import {
  loadMovementAccountDrift,
  type MovementAccountDriftDetail,
  readPostedMovementIds,
} from './movement-account-drift'

const logger = createScopedLogger('builds:movement-account-fix')

/** The claim's occurrence: one per fix entry of a part, numbered after the ones already written. */
export function accountFixOccurrence(entryNumber: number): string {
  return `inventory_account_fix:${entryNumber}`
}

export interface FixMovementAccountsOutcome {
  partsFixed: number
  movementsRestamped: number
  reclassEntries: number
}

/**
 * Put every drifted movement's value in the account its part's current kind maps to: unposted
 * movements are restamped, posted ones stay as written and get one correcting entry per part,
 * dated today. Safe to re-run: restamps match on the old role and a fix nets earlier fixes.
 */
export async function fixMovementAccounts(
  db: Database,
  organizationId: string,
  actorUserId: string,
  opts: { partIds?: string[] } = {}
): Promise<Result<FixMovementAccountsOutcome, Error>> {
  return guard(
    async () => {
      const detail = await loadMovementAccountDrift(db, organizationId, { partIds: opts.partIds })
      const outcome: FixMovementAccountsOutcome = {
        partsFixed: 0,
        movementsRestamped: 0,
        reclassEntries: 0,
      }
      if (detail.parts.length === 0) return outcome

      outcome.movementsRestamped = await restampUnposted(db, organizationId, detail)

      const correctionIds = detail.parts
        .filter((part) => part.plan.correction.length > 0)
        .map((part) => part.partId)
      if (correctionIds.length > 0) {
        // Re-read: a row that posted after the first read was left unstamped and belongs here.
        const fresh = await loadMovementAccountDrift(db, organizationId, {
          partIds: correctionIds,
        })
        const txnDate = dayKeyInZone(new Date(), await readBookTimeZoneOrUtc(organizationId))
        for (const part of fresh.parts) {
          if (part.plan.correction.length === 0) continue
          await postAccountFix(db, organizationId, actorUserId, part, txnDate)
          outcome.reclassEntries++
        }
      }

      outcome.partsFixed = detail.parts.length
      logger.info('Fixed movement inventory accounts', { organizationId, ...outcome })
      return outcome
    },
    'Failed to fix movement accounts',
    { organizationId }
  )
}

/** Restamp under the commit lock, dropping any row a poster booked since the read. */
async function restampUnposted(
  db: Database,
  organizationId: string,
  detail: MovementAccountDriftDetail
): Promise<number> {
  const groups = new Map<string, MovementAccountRestamp & { movementIds: string[] }>()
  for (const part of detail.parts) {
    for (const { fromRole, movementIds } of part.plan.restamps) {
      const key = `${fromRole}->${part.expectedAccountRole}`
      const group = groups.get(key) ?? {
        fromRole,
        toRole: part.expectedAccountRole,
        movementIds: [],
      }
      group.movementIds.push(...movementIds)
      groups.set(key, group)
    }
  }
  if (groups.size === 0) return 0

  return db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)
    const all = [...groups.values()].flatMap((group) => group.movementIds)
    const posted = await readPostedMovementIds(tx, organizationId, all)
    const restamps = [...groups.values()].map((group) => ({
      ...group,
      movementIds: group.movementIds.filter((id) => !posted.has(id)),
    }))
    return restampMovementAccounts(tx, organizationId, restamps)
  })
}

/** One correcting `inventory_movement` entry moving a part's posted value between inventory roles. */
async function postAccountFix(
  db: Database,
  organizationId: string,
  actorUserId: string,
  part: MovementAccountDriftDetail['parts'][number],
  txnDate: string
): Promise<void> {
  const { partId, partName, plan } = part
  const prior = await readInventoryAccountFixTotals(db, organizationId, [partId])
  const entryNumber = (prior.get(partId)?.entries ?? 0) + 1
  const occurrence = accountFixOccurrence(entryNumber)
  const to = roleLabel(plan.expectedRole)
  const from = plan.fromRoles.map(roleLabel).join(', ') || 'another inventory account'
  const memo = `Inventory account fix #${entryNumber} for ${partName}: posted movements moved from ${from} to ${to} after its kind changed`

  const lines: GlPostingLineInput[] = plan.correction.map((leg, index) => ({
    accountRole: leg.role,
    direction: leg.amountMinor > 0 ? ('debit' as const) : ('credit' as const),
    amount: Math.abs(leg.amountMinor),
    memo,
    sourceType: INVENTORY_ACCOUNT_FIX_SOURCE,
    sourceId: partId,
    sortOrder: index,
  }))
  const entry = buildEntry({
    postingType: 'inventory_movement',
    periodKey: hashedPeriodKey({
      prefix: DOC_NUMBER_PREFIX.inventory_movement,
      sourceId: `${partId}:${occurrence}`,
      label: 'inventory account fix',
      idLabel: 'part id',
    }),
    txnDate,
    lines,
  })

  const post = await postEntry(db, {
    organizationId,
    entry,
    actorUserId,
    memo,
    sources: [{ sourceKind: 'part', sourceId: partId, occurrence, linkRole: 'subject' }],
  })
  logger.info('Posted an inventory account fix', {
    organizationId,
    partId,
    entryNumber,
    status: post.status,
  })
  if (!didLedgerAccept(post)) {
    throw new UnprocessableEntityError(
      `${partName}: ${part.postedCount.toLocaleString()} of its movements are already in the ` +
        `books, and the correcting entry was refused (${post.error ?? post.status}). Its other ` +
        'movements were fixed.',
      { organizationId, partId, status: post.status }
    )
  }
}

function roleLabel(role: string): string {
  return (ACCOUNT_ROLE_LABELS as Record<string, string>)[role] ?? role
}
