// packages/lib/scripts/backfill-cash-line-roles.ts
//
// One-off for 101 E8: stamp the role snapshot on cash lines posted before the posters wrote it.
// see plans/accounting/tasks/101-the-export-under-one-entry-per-event.md §E8
// The one sanctioned write to an append-only line: only a null `accountRole`, never an amount.
//
// Run from packages/lib (dry run unless --apply):
//   npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
//     scripts/backfill-cash-line-roles.ts --org <id> [--apply]

import { database as db, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
// Relative import on purpose — see the note in backfill-po-line-rollups.ts.
import { ACCOUNT_ROLES } from '../src/accounting/ledger/builders/entry'

/** The posting types whose endpoint line `resolveCashEndpoint` names; a checkout deposit posts `payment`. */
const POSTING_TYPES = ['payment', 'refund'] as const
const MAPPED_ROLES = [
  ACCOUNT_ROLES.CLEARING,
  ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
  ACCOUNT_ROLES.GIFT_CARD_LIABILITY,
  ACCOUNT_ROLES.BANK,
]

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/** glAccountId → every cash role the org's map gives it. More than one is ambiguous and left alone. */
async function readRoleMap(organizationId: string): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  const add = (glAccountId: string, role: string) => {
    const roles = map.get(glAccountId) ?? new Set<string>()
    roles.add(role)
    map.set(glAccountId, roles)
  }

  const assignments = await db
    .select({
      role: schema.GlRoleAssignment.role,
      glAccountId: schema.GlRoleAssignment.glAccountId,
    })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        inArray(schema.GlRoleAssignment.role, MAPPED_ROLES)
      )
    )
  for (const row of assignments) add(row.glAccountId, row.role)

  // A bank account's own `bank_account_gl_account` pointer (`ledger/chart/resolve-cash-account.ts`).
  const pointers = await db
    .select({ glAccountId: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'bank_account_gl_account')
      )
    )
  for (const row of pointers) {
    const glAccountId = row.glAccountId?.trim()
    if (glAccountId) add(glAccountId, ACCOUNT_ROLES.BANK)
  }
  return map
}

async function main(): Promise<void> {
  const organizationId = argValue('--org')
  const apply = process.argv.includes('--apply')
  if (!organizationId) {
    console.error('Usage: backfill-cash-line-roles.ts --org <organizationId> [--apply]')
    process.exit(1)
  }

  const lines = await db
    .select({
      id: schema.GlPostingLine.id,
      glAccountId: schema.GlPostingLine.glAccountId,
      accountCode: schema.GlPostingLine.accountCode,
      accountName: schema.GlPostingLine.accountName,
      postingType: schema.GlPosting.postingType,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        isNull(schema.GlPostingLine.accountRole),
        inArray(schema.GlPosting.postingType, [...POSTING_TYPES])
      )
    )

  const roleMap = await readRoleMap(organizationId)
  const idsByRole = new Map<string, string[]>()
  const unnamed = new Map<string, { label: string; lines: number; roles: string }>()
  for (const line of lines) {
    const roles = roleMap.get(line.glAccountId)
    if (roles?.size === 1) {
      const [role] = roles
      idsByRole.set(role!, [...(idsByRole.get(role!) ?? []), line.id])
      continue
    }
    const entry = unnamed.get(line.glAccountId) ?? {
      label: `${line.accountCode ?? '?'} ${line.accountName ?? ''}`.trim(),
      lines: 0,
      roles: roles ? [...roles].join('+') : 'none',
    }
    entry.lines++
    unnamed.set(line.glAccountId, entry)
  }

  console.log(
    `${apply ? 'APPLY' : 'DRY RUN'} org ${organizationId}: ${lines.length} null-role line(s) on ${POSTING_TYPES.join('/')} postings`
  )
  for (const [role, ids] of idsByRole) console.log(`  ${role}: ${ids.length}`)
  if (unnamed.size) {
    console.log('Left alone (the role map names no single cash role):')
    for (const [glAccountId, entry] of unnamed)
      console.log(`  ${glAccountId} ${entry.label}: ${entry.lines} line(s), roles: ${entry.roles}`)
  }

  if (apply && idsByRole.size) {
    await db.transaction(async (tx) => {
      for (const [role, ids] of idsByRole)
        await tx
          .update(schema.GlPostingLine)
          .set({ accountRole: role })
          .where(
            and(
              eq(schema.GlPostingLine.organizationId, organizationId),
              inArray(schema.GlPostingLine.id, ids),
              isNull(schema.GlPostingLine.accountRole)
            )
          )
    })
    console.log('Applied.')
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
