// packages/lib/src/seed/gl-account-chart.ts
//
// Seeds one or more chart PACKS (`postings/default-chart.ts`'s `CHART_PACKS`,
// plans/accounting/tasks/16-the-chart-of-accounts.md §1.5) into one
// organization as `gl_account` EntityInstances, and points each posting ROLE
// at the account that fulfils it via a `GlRoleAssignment` row (decision
// `G19`). `seedChartPacks` always walks `core` first and expands a pack's
// `requires` transitively - `['purchasing']` walks `core`, `inventory`, then
// `purchasing` - before flattening the walked packs' accounts and running the
// rules below over that list.
//
// WHY THE CHART LIVES IN `lib/postings/` AND THE WRITER LIVES HERE
//
// `postings/default-chart.ts` is pure data - no database, no io - because
// `postings/` already owns the account vocabulary (`ACCOUNT_ROLES`) that the
// chart's `role` column maps onto. `seed -> lib` is the sanctioned dependency
// direction and `lib -> seed` is forbidden, so the writer imports the packs
// and never the reverse.
//
// ✅ THE HAZARD THIS FILE USED TO CARRY IS GONE
//
// Rule 5 used to be `assertRolesLanded`, and it existed because roles were
// written as a `gl_account_role` FIELD through `UnifiedCrudHandler` - which
// resolves fields from the ORG CACHE and SILENTLY DROPS a value whose field it
// cannot resolve. A field created moments earlier in the same migration pass is
// invisible to it, so the first run of this seed wrote 784 accounts across 28
// orgs with every column populated except the one the whole role indirection
// depends on, and logged success.
//
// `G19` moved the mapping to the `GlRoleAssignment` TABLE, and the assignment
// insert below is a plain Drizzle write: no field resolution, no org cache, no
// handler, nothing to drop. The failure mode is structurally unavailable now
// rather than merely guarded against - which is a real, and easy to miss,
// secondary win of the table route.
//
// THE FOUR RULES THIS FILE EXISTS TO KEEP
//
//  1. **Idempotent on `code`.** A code the org already holds is skipped whole  -
//     never updated, never inserted a second time. `gl_account_code` is unique,
//     but its gate is a check-then-write `SELECT ... LIMIT 1` with no lock and
//     no index behind it, and it excludes archived rows. A duplicate `1310`
//     would make the role resolver's fail-closed behaviour fire on EVERY
//     posting, not just the one that touches 1310.
//  2. **Single writer, sequential.** No parallel fan-out over the chart and no
//     parallel fan-out over orgs for the same code: a concurrent race is the
//     one case the check-then-write gate does not cover.
//  3. **Never touch an account the org already has.** Not the name, not the
//     type. A chart is a bookkeeper's document (decision `G7`) - they renumber,
//     rename and deactivate, and re-running the seed must be a no-op over their
//     edits.
//  4. **Never repoint a role the org has already mapped.** The assignment
//     insert is `ON CONFLICT (organizationId, role) DO NOTHING`, so a
//     bookkeeper who moved `grni` onto their own `2155` keeps it through every
//     re-seed. Assignments are written for role-carrying accounts whether this
//     pass created them or found them, which is what makes the seed
//     self-healing after the wipe-and-reseed of entity migration 115.
//
// WHAT IT DOES NOT DO: it never repoints a role at a different account and it
// never deactivates one. Both are the org's decisions, and both are reversible
// only by a human who knows why.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId } from '../cache'
import {
  createPaymentGateway,
  listPaymentGateways,
  normaliseGatewayHandle,
} from '../payment-gateways'
import {
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPackKey,
  type DefaultChartAccount,
} from '../postings/default-chart'
import { seedSession, UnifiedCrudHandler } from '../resources/crud'
import { SystemUserService } from '../users/system-user-service'

const logger = createScopedLogger('seed:gl-account-chart')

/**
 * What one pass over one org did, for a caller that named ACCOUNTS rather than
 * packs. {@link ChartSeedResult} is this plus the packs that were walked.
 */
export interface ChartAccountSeedResult {
  /** Accounts inserted by this pass. */
  created: number
  /** Codes the org already held, left exactly as they were. */
  skipped: number
  /** `GlRoleAssignment` rows inserted by this pass. Zero on a settled org. */
  rolesAssigned: number
}

/** What one pass over one org did. */
export interface ChartSeedResult {
  /** Accounts inserted by this pass. */
  created: number
  /** Codes the org already held, left exactly as they were. */
  skipped: number
  /** `GlRoleAssignment` rows inserted by this pass. Zero on a settled org. */
  rolesAssigned: number
  /**
   * Every pack actually walked, `core` first, in `CHART_PACK_KEYS` order  -
   * the packs asked for plus every `requires` they pulled in (16 §1.5).
   */
  packs: ChartPackKey[]
}

/**
 * Every pack `packs` needs: `core` always, plus each pack's `requires`
 * expanded transitively, in `CHART_PACK_KEYS` declaration order.
 *
 * `['purchasing']` walks `core`, then `inventory` (`purchasing`'s
 * `requires`), then `purchasing` itself - a receipt debits an inventory role,
 * so provisioning purchasing alone without inventory would leave that role
 * unmapped on day one.
 */
function walkPacks(packs: readonly ChartPackKey[]): ChartPackKey[] {
  const wanted = new Set<ChartPackKey>(['core', ...packs])

  let changed = true
  while (changed) {
    changed = false
    for (const key of [...wanted]) {
      for (const required of CHART_PACKS[key].requires ?? []) {
        if (!wanted.has(required)) {
          wanted.add(required)
          changed = true
        }
      }
    }
  }

  return CHART_PACK_KEYS.filter((key) => wanted.has(key))
}

/**
 * Seed one or more chart packs, and their role assignments, into one org.
 *
 * Idempotent: a second pass over the same set of packs creates nothing and
 * reports `created: 0, rolesAssigned: 0`, which is what lets migration 108
 * keep reporting `alreadyUpToDate` (and therefore skip its org-cache flush) on
 * a re-run, and what lets the Roles tab's Add accounts action re-walk a
 * `partial` pack and land only the rows still missing (16 §3.2).
 *
 * @param glAccountDefId the org's `gl_account` EntityDefinition, or undefined
 * when it has none - in which case this is a no-op rather than an error, the
 * same tolerance every other step of 108 has for a def that is not there yet.
 * @param packs the packs to provision. `core` is walked whether or not it is
 * named, and every pack's `requires` is expanded transitively before the walk
 * runs (16 §1.5); the packs actually walked come back on the result.
 */
export async function seedChartPacks(
  db: Database,
  organizationId: string,
  glAccountDefId: string | undefined,
  packs: readonly ChartPackKey[]
): Promise<ChartSeedResult> {
  const walked = walkPacks(packs)
  const accounts: readonly DefaultChartAccount[] = walked.flatMap(
    (key) => CHART_PACKS[key].accounts
  )
  const result = await seedChartAccounts(db, organizationId, glAccountDefId, accounts, {
    packs: walked,
  })
  return { ...result, packs: walked }
}

/**
 * Seed a named set of catalogue accounts, and their role assignments, into one
 * org.
 *
 * The writer {@link seedChartPacks} is built on, exposed on its own for the
 * catalogue picker, which selects ACCOUNTS rather than whole packs - "just give
 * me Deferred Revenue" is not expressible as a pack, and provisioning the pack
 * that carries it would land the other one too.
 *
 * 🛑 Every rule in this file's header is a property of THIS function, not of
 * the pack walk above it: idempotent on `code` (rule 1), sequential (rule 2),
 * never touches an account the org already has (rule 3), never repoints a
 * mapped role (rule 4). A caller that hands over a subset gets all four
 * unchanged, which is what makes a per-account picker safe to press twice.
 *
 * 🛑 It does NOT expand `requires`. That is a statement about PACKS, and a
 * caller naming accounts one at a time has already decided what it wants. The
 * picker resolves a checked pack to its accounts on the client and sends those.
 *
 * @param glAccountDefId the org's `gl_account` EntityDefinition, or undefined
 * when it has none - a no-op rather than an error, the same tolerance every
 * other step of 108 has for a def that is not there yet
 * @param accounts the catalogue accounts to land, already resolved by the caller
 * @param meta extra fields for the one log line this writes, so a pack walk can
 * still say which packs it was
 */
export async function seedChartAccounts(
  db: Database,
  organizationId: string,
  glAccountDefId: string | undefined,
  accounts: readonly DefaultChartAccount[],
  meta: Record<string, unknown> = {}
): Promise<ChartAccountSeedResult> {
  const empty: ChartAccountSeedResult = { created: 0, skipped: 0, rolesAssigned: 0 }
  if (!glAccountDefId || accounts.length === 0) return empty

  // The `code` field has to exist before its values can be read or written. On
  // the very first pass `ensureCustomFields` has just created it; on an org
  // that somehow lacks it, seeding would write rows with no identity at all.
  const [codeField] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.entityDefinitionId, glAccountDefId),
        eq(schema.CustomField.systemAttribute, 'gl_account_code')
      )
    )
    .limit(1)

  if (!codeField) return empty

  // Every code the org already holds, ARCHIVED ROWS INCLUDED, with the instance
  // that carries it.
  //
  // 🛑 Deliberate, and the opposite of what the unique gate does. The gate
  // ignores archived rows, so re-seeding `1310` over an archived `1310` would
  // pass validation and leave two - and un-archiving the old one later is a
  // click. Someone who archived an account did not ask for it back.
  const existing = await db
    .select({ code: schema.FieldValue.valueText, entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, codeField.id)
      )
    )

  /** code -> the instance that holds it. Grows as this pass creates accounts. */
  const byCode = new Map<string, string>()
  for (const row of existing) {
    if (row.code) byCode.set(row.code, row.entityId)
  }

  const missing = accounts.filter((account) => !byCode.has(account.code))

  let created = 0
  if (missing.length > 0) {
    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

    // The seed session's silent lane suppresses events - there is nobody to
    // notify while an org is being migrated, and a full pack walk x N orgs of
    // invalidations is real time on a cold Redis.
    const handler = new UnifiedCrudHandler(organizationId, systemUserId, db, undefined, {
      session: seedSession('gl account chart seeding'),
    })

    // Sequential on purpose - see rule 2. `code` is guarded by a
    // check-then-write uniqueness gate, which two concurrent creates would both
    // pass.
    for (const account of missing) {
      const result = await handler.create(glAccountDefId, {
        gl_account_code: account.code,
        gl_account_name: account.name,
        gl_account_type: account.accountType,
        gl_account_is_active: true,
        // Same SINGLE_SELECT-by-value contract as `gl_account_type` above.
        // Absent (not `null`) when the default chart names no subtype for this
        // account - most of it, same as `role` - so a stub or a snapshot test
        // asserting the exact key set on a subtype-less row is unaffected.
        ...(account.subtype ? { gl_account_subtype: account.subtype } : {}),
      })
      byCode.set(account.code, result.instance.id)
      created++
    }
  }

  const rolesAssigned = await assignSeededRoles(db, organizationId, byCode, accounts)

  if (created > 0 || rolesAssigned > 0) {
    logger.info('Seeded chart accounts', {
      organizationId,
      ...meta,
      created,
      skipped: accounts.length - created,
      rolesAssigned,
    })
  }

  return { created, skipped: accounts.length - created, rolesAssigned }
}

/**
 * Seed the core chart pack, and its role assignments, into one org. Kept as
 * its own name for the one caller that means exactly the core (entity
 * migration 108); every other caller names its packs explicitly through
 * {@link seedChartPacks}.
 */
export async function seedDefaultChartOfAccounts(
  db: Database,
  organizationId: string,
  glAccountDefId: string | undefined
): Promise<ChartSeedResult> {
  return seedChartPacks(db, organizationId, glAccountDefId, ['core'])
}

/**
 * Point every role the default chart declares at the account that carries its
 * code, without ever overwriting a mapping the org already made.
 *
 * `ON CONFLICT (organizationId, role) DO NOTHING` is rule 4 in one line: the
 * unique index that makes the resolver's answer unambiguous is the same index
 * that makes this insert safe to repeat. A bookkeeper who repointed `grni` at
 * their own `2155` keeps it through every re-seed, every migration re-run and
 * every fresh-org pass.
 *
 * `source: 'seed'` and NOT `confirmedAt`. `G19` leans on that difference: the
 * setup wizard has to render "we chose this for you" differently from "you
 * chose this", and stamping a confirmation nobody gave would erase the
 * distinction on day one for every org.
 *
 * A role whose account is missing from `byCode` is skipped rather than written
 * as a dangling id - that can only happen if the walked packs and this org's
 * chart disagree, and a mapping pointing at nothing would fail the resolver
 * with a message about an archived account rather than about a broken seed.
 */
async function assignSeededRoles(
  db: Database,
  organizationId: string,
  byCode: Map<string, string>,
  accounts: readonly DefaultChartAccount[]
): Promise<number> {
  const rows = accounts.flatMap((account) => {
    if (!account.role) return []
    const glAccountId = byCode.get(account.code)
    if (!glAccountId) return []
    return [{ organizationId, role: account.role, glAccountId, source: 'seed' }]
  })

  if (rows.length === 0) return 0

  const inserted = await db
    .insert(schema.GlRoleAssignment)
    .values(rows)
    .onConflictDoNothing({
      target: [schema.GlRoleAssignment.organizationId, schema.GlRoleAssignment.role],
    })
    .returning({ id: schema.GlRoleAssignment.id })

  return inserted.length
}

// ─── The two default payment gateways (task 13 §5.3, §5.1's census) ────────

/** What one pass of {@link seedDefaultPaymentGateways} did. */
export interface PaymentGatewaySeedResult {
  created: number
  skipped: number
}

/**
 * Seed the two default `payment_gateway` records the census names, idempotent
 * by handle.
 *
 * ⚠️ **Runs AFTER the chart**, not alongside it - the clearing accounts these
 * defaults point at only exist once the `card_rail` pack is provisioned, and
 * `payment_gateway.clearingAccount` is required and validated (`writes.ts`'s
 * `assertClearingAccount`). Call this from wherever the chart is seeded
 * (`ledger.provisionChart`), never before {@link seedChartPacks} has walked
 * `card_rail`, and never from {@link seedChartPacks} itself - the core walk
 * never seeds a gateway (16 §1.5).
 *
 * 🛑 **Does not mint `clearing_authnet`.** Authorize.Net is a rail a merchant
 * ADDS (§5.1); auxx does not know a store ran it until they say so. The two
 * seeded here are the only ones every org's default chart actually names a
 * role for: `shopify_payments` (settlement source `shopify_payments`, fee
 * account = whichever account carries `payment_processing_fees`, `6100` by
 * default) and `affirm` (settlement source `manual` - `18` §2.1 codes its
 * relief by hand, because no payout API sees an Affirm settlement).
 *
 * Idempotent by HANDLE, not by name: a re-provision (or a second org whose
 * chart already exists) skips a default whose handle some record - seeded or
 * hand-added - already claims, rather than creating a second `Affirm` row.
 *
 * A missing role assignment (`clearing_card` / `clearing_affirm` unmapped)
 * skips that default rather than guessing an account - the same tolerance
 * {@link assignSeededRoles} has for a chart that does not match the packs
 * walked.
 */
export async function seedDefaultPaymentGateways(
  db: Database,
  organizationId: string
): Promise<PaymentGatewaySeedResult> {
  const empty: PaymentGatewaySeedResult = { created: 0, skipped: 0 }

  const paymentGatewayDefId = await getCachedEntityDefId(organizationId, 'payment_gateway')
  if (!paymentGatewayDefId) return empty

  const existingResult = await listPaymentGateways(db, organizationId, { includeArchived: true })
  const existingHandles = new Set(
    existingResult.isOk()
      ? existingResult.value.flatMap((gateway) => gateway.handles.map(normaliseGatewayHandle))
      : []
  )

  const roleRows = await db
    .select({
      role: schema.GlRoleAssignment.role,
      glAccountId: schema.GlRoleAssignment.glAccountId,
    })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        inArray(schema.GlRoleAssignment.role, [
          'clearing_card',
          'clearing_affirm',
          'payment_processing_fees',
        ])
      )
    )
  const byRole = new Map(roleRows.map((row) => [row.role, row.glAccountId]))

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

  let created = 0
  let skipped = 0

  const clearingCard = byRole.get('clearing_card')
  if (!existingHandles.has('shopify_payments') && clearingCard) {
    const result = await createPaymentGateway(db, {
      organizationId,
      actorUserId: systemUserId,
      name: 'Shopify Payments',
      handles: ['shopify_payments'],
      clearingAccountId: clearingCard,
      feeAccountId: byRole.get('payment_processing_fees') ?? null,
      settlementSource: 'shopify_payments',
      status: 'active',
    })
    if (result.isOk()) created++
    else skipped++
  } else {
    skipped++
  }

  const clearingAffirm = byRole.get('clearing_affirm')
  if (!existingHandles.has('affirm') && clearingAffirm) {
    const result = await createPaymentGateway(db, {
      organizationId,
      actorUserId: systemUserId,
      name: 'Affirm',
      handles: ['affirm'],
      clearingAccountId: clearingAffirm,
      settlementSource: 'manual',
      status: 'active',
    })
    if (result.isOk()) created++
    else skipped++
  } else {
    skipped++
  }

  if (created > 0) {
    logger.info('Seeded default payment gateways', { organizationId, created, skipped })
  }

  return { created, skipped }
}
