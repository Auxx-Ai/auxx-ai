// apps/worker/scripts/fold-duplicate-payouts.ts
/**
 * LOCAL DEV repair (brief 114 P4, "keep the twin"): folds each legacy lib-sync payout record into
 * its connector twin. See plans/accounting/tasks/114-one-payout-one-record.md §2 P4.
 *
 * Per pair, in one transaction under the accounting commit lock:
 *   1. re-point the legacy record's `GlPostingSource` rows (and the frozen `GlPosting.built.sources`
 *      copy) to the twin — references only, no amounts move;
 *   2. clear the legacy `payout_gateway_id` + `payout_payment_gateway`, and delete the rail's
 *      now-orphaned inverse row (the lib unlink leaves it; also swept org-wide on every run);
 *   3. write the legacy ledger fields and `payout_number` onto the twin (crud, so the rail's inverse
 *      relationship stays right);
 *   4. archive the legacy record.
 * Writes run under a `seed` session: silent, no marks, rules or connector syncs.
 *
 * Idempotent: a folded legacy record has no gateway id, so it is no longer found as a pair.
 *
 * Run from apps/worker:
 *   npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/fold-duplicate-payouts.ts [--org <id>] [--rehearse | --apply]
 * Default is a dry run. `--rehearse` executes every write and then rolls the transaction back.
 */

import {
  type Database,
  database,
  type Transaction as Tx,
  withAccountingCommitLock,
} from '@auxx/database'
import { seedSession, UnifiedCrudHandler } from '@auxx/lib/resources'
import { SystemUserService } from '@auxx/lib/users'
import { sql } from 'drizzle-orm'

const DEFAULT_ORG = 'abgwpa1l81reht2zmwrcihfu' // DemoOrg1

/** Ledger attributes the lib sync owns; copied legacy → twin when the legacy record has them. */
const LEDGER_ATTRS = [
  'payout_gateway_id',
  'payout_payment_gateway',
  'payout_status',
  'payout_paid_at',
  'payout_source',
  'payout_currency',
  'payout_deposited',
  'payout_gross',
  'payout_fees',
  'payout_net',
  'payout_unrecognised_net',
  'payout_unrecognised_count',
  'payout_destination',
  'payout_destination_mismatch',
  'payout_bank_transaction_id',
  'payout_bank_account',
  'payout_number',
] as const

const EVIDENCE_ATTRS = [
  'payout_source_external_id',
  'payout_source_provider_key',
  'payout_source_account_id',
] as const

type Db = Database | Tx
type Attr = (typeof LEDGER_ATTRS)[number] | (typeof EVIDENCE_ATTRS)[number]

interface Field {
  id: string
  type: string
}

interface ValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  valueDate: Date | null
  optionId: string | null
  relatedEntityId: string | null
  relatedEntityDefinitionId: string | null
}

interface Pair {
  gatewayId: string
  railId: string
  legacyId: string
  twinId: string
  legacy: Map<Attr, unknown>
  twin: Map<Attr, unknown>
  claims: Array<{ id: string; glPostingId: string; docNumber: string | null }>
}

function parseArgs() {
  const args = process.argv.slice(2)
  const orgIdx = args.indexOf('--org')
  return {
    org: orgIdx >= 0 ? args[orgIdx + 1]! : DEFAULT_ORG,
    apply: args.includes('--apply'),
    rehearse: args.includes('--rehearse'),
  }
}

function assertLocalDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const host = new URL(url).hostname
  if (host !== 'localhost' && host !== '127.0.0.1')
    throw new Error(`Refusing to run against non-local DATABASE_URL host "${host}"`)
}

/** The crud input shape for one stored value; `undefined` when the row holds nothing. */
function toInput(field: Field, row: ValueRow | undefined): unknown {
  if (!row) return undefined
  switch (field.type) {
    case 'NUMBER':
    case 'CURRENCY':
      return row.valueNumber ?? undefined
    case 'DATE':
      return row.valueDate ? new Date(row.valueDate).toISOString().slice(0, 10) : undefined
    case 'SINGLE_SELECT':
      return row.optionId ?? undefined
    case 'RELATIONSHIP':
      return row.relatedEntityId
        ? `${row.relatedEntityDefinitionId}:${row.relatedEntityId}`
        : undefined
    default:
      return row.valueText ?? undefined
  }
}

async function loadFields(org: string) {
  const res = await database.execute(sql`
    SELECT d.id AS "defId", cf.id, cf."systemAttribute", cf.type
    FROM "EntityDefinition" d
    JOIN "CustomField" cf ON cf."entityDefinitionId" = d.id
    WHERE d."organizationId" = ${org} AND d."entityType" = 'payout' AND d."archivedAt" IS NULL
  `)
  const rows = res.rows as Array<{
    defId: string
    id: string
    systemAttribute: string
    type: string
  }>
  if (!rows.length) throw new Error(`Org ${org} has no payout definition`)
  const fields = new Map<Attr, Field>()
  for (const r of rows)
    if ((LEDGER_ATTRS as readonly string[]).concat(EVIDENCE_ATTRS).includes(r.systemAttribute))
      fields.set(r.systemAttribute as Attr, { id: r.id, type: r.type })
  for (const a of ['payout_gateway_id', 'payout_payment_gateway', ...EVIDENCE_ATTRS] as Attr[])
    if (!fields.has(a)) throw new Error(`payout field ${a} is not provisioned`)
  return { defId: rows[0]!.defId, fields }
}

async function readValues(ids: string[], fields: Map<Attr, Field>) {
  const byId = new Map<string, Attr>([...fields].map(([a, f]) => [f.id, a]))
  const res = await database.execute(sql`
    SELECT "entityId", "fieldId", "valueText", "valueNumber", "valueDate", "optionId",
      "relatedEntityId", "relatedEntityDefinitionId"
    FROM "FieldValue"
    WHERE "entityId" IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    )})
      AND "fieldId" IN (${sql.join(
        [...byId.keys()].map((id) => sql`${id}`),
        sql`, `
      )})
  `)
  const out = new Map<string, Map<Attr, unknown>>(ids.map((id) => [id, new Map()]))
  for (const row of res.rows as unknown as ValueRow[]) {
    const attr = byId.get(row.fieldId)!
    const value = toInput(fields.get(attr)!, row)
    if (value !== undefined) out.get(row.entityId)!.set(attr, value)
  }
  return out
}

async function findPairs(org: string, defId: string, fields: Map<Attr, Field>): Promise<Pair[]> {
  const f = (a: Attr) => fields.get(a)!.id
  // Legacy: a live payout with a gateway id and a rail, carrying no connector evidence.
  // Twin: a live payout whose evidence names the same id, from a feed linked to that rail.
  const res = await database.execute(sql`
    SELECT gw."valueText" AS "gatewayId", rl."relatedEntityId" AS "railId",
      l.id AS "legacyId", t.id AS "twinId"
    FROM "EntityInstance" l
    JOIN "FieldValue" gw ON gw."entityId" = l.id AND gw."fieldId" = ${f('payout_gateway_id')}
      AND gw."valueText" IS NOT NULL
    JOIN "FieldValue" rl ON rl."entityId" = l.id AND rl."fieldId" = ${f('payout_payment_gateway')}
      AND rl."relatedEntityId" IS NOT NULL
    JOIN "FinancialSourceAccount" fsa ON fsa."organizationId" = l."organizationId"
      AND fsa."paymentGatewayId" = rl."relatedEntityId"
    JOIN "FieldValue" tx ON tx."organizationId" = l."organizationId"
      AND tx."fieldId" = ${f('payout_source_external_id')} AND tx."valueText" = gw."valueText"
    JOIN "EntityInstance" t ON t.id = tx."entityId" AND t."archivedAt" IS NULL AND t.id <> l.id
      AND t."entityDefinitionId" = ${defId}
    JOIN "FieldValue" tp ON tp."entityId" = t.id AND tp."fieldId" = ${f('payout_source_provider_key')}
      AND tp."valueText" = fsa."providerKey"
    JOIN "FieldValue" ta ON ta."entityId" = t.id AND ta."fieldId" = ${f('payout_source_account_id')}
      AND ta."valueText" = fsa."externalAccountId"
    LEFT JOIN "FieldValue" trl ON trl."entityId" = t.id
      AND trl."fieldId" = ${f('payout_payment_gateway')}
    WHERE l."organizationId" = ${org} AND l."entityDefinitionId" = ${defId}
      AND l."archivedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "FieldValue" lx WHERE lx."entityId" = l.id
        AND lx."fieldId" = ${f('payout_source_external_id')} AND lx."valueText" IS NOT NULL)
      AND (trl."relatedEntityId" IS NULL OR trl."relatedEntityId" = rl."relatedEntityId")
    ORDER BY gw."valueText"
  `)
  const rows = res.rows as Array<{
    gatewayId: string
    railId: string
    legacyId: string
    twinId: string
  }>

  const byLegacy = new Map<string, typeof rows>()
  for (const r of rows) byLegacy.set(r.legacyId, [...(byLegacy.get(r.legacyId) ?? []), r])
  const unique = [...byLegacy.values()].flatMap((group) => {
    if (group.length === 1) return group
    console.warn(
      `  ! skip ${group[0]!.gatewayId}: legacy ${group[0]!.legacyId} matches ` +
        `${group.length} twins (${group.map((g) => g.twinId).join(', ')})`
    )
    return []
  })
  if (!unique.length) return []

  const values = await readValues(
    unique.flatMap((r) => [r.legacyId, r.twinId]),
    fields
  )
  const claimRes = await database.execute(sql`
    SELECT s.id, s."glPostingId", s."sourceId", p."docNumber"
    FROM "GlPostingSource" s JOIN "GlPosting" p ON p.id = s."glPostingId"
    WHERE s."organizationId" = ${org} AND s."sourceKind" = 'payout'
      AND s."sourceId" IN (${sql.join(
        unique.flatMap((r) => [sql`${r.legacyId}`, sql`${r.twinId}`]),
        sql`, `
      )})
  `)
  const claims = claimRes.rows as Array<{
    id: string
    glPostingId: string
    sourceId: string
    docNumber: string | null
  }>

  return unique.flatMap((r) => {
    const twinClaims = claims.filter((c) => c.sourceId === r.twinId)
    const legacyClaims = claims.filter((c) => c.sourceId === r.legacyId)
    if (twinClaims.length && legacyClaims.length) {
      console.warn(
        `  ! skip ${r.gatewayId}: BOTH records hold posting claims ` +
          `(${[...twinClaims, ...legacyClaims].map((c) => c.docNumber).join(', ')}) — a real double`
      )
      return []
    }
    return [
      {
        ...r,
        legacy: values.get(r.legacyId)!,
        twin: values.get(r.twinId)!,
        claims: legacyClaims,
      },
    ]
  })
}

function twinPatch(pair: Pair): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const attr of LEDGER_ATTRS) {
    const value = pair.legacy.get(attr)
    if (value !== undefined && value !== pair.twin.get(attr)) patch[attr] = value
  }
  return patch
}

function describe(pair: Pair) {
  const patch = twinPatch(pair)
  console.log(
    `\n• ${pair.gatewayId}  legacy ${pair.legacyId} (${pair.legacy.get('payout_number')})  →  ` +
      `twin ${pair.twinId} (${pair.twin.get('payout_number')})  rail ${pair.railId}`
  )
  console.log('  twin fields:')
  for (const [attr, value] of Object.entries(patch))
    console.log(
      `    ${attr.padEnd(28)} ${JSON.stringify(pair.twin.get(attr as Attr) ?? null)} → ${JSON.stringify(value)}`
    )
  console.log('  legacy: clear payout_gateway_id + payout_payment_gateway, then archive')
  if (pair.claims.length)
    for (const c of pair.claims)
      console.log(
        `  claim: GlPostingSource ${c.id} (posting ${c.docNumber} ${c.glPostingId}) sourceId → twin`
      )
  else console.log('  claim: none (unposted)')
}

/** Read back inside the transaction; throwing here rolls the pair back. */
async function assertFolded(tx: Tx, pair: Pair) {
  const res = await tx.execute(sql`
    SELECT
      (SELECT "archivedAt" IS NOT NULL FROM "EntityInstance" WHERE id = ${pair.legacyId}) AS "legacyArchived",
      (SELECT count(*)::int FROM "FieldValue" fv JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE fv."entityId" = ${pair.legacyId}
          AND cf."systemAttribute" IN ('payout_gateway_id', 'payout_payment_gateway')) AS "legacyRefs",
      (SELECT count(*)::int FROM "FieldValue"
        WHERE "relatedEntityId" = ${pair.legacyId}) AS "legacyInbound",
      (SELECT fv."valueText" FROM "FieldValue" fv JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE fv."entityId" = ${pair.twinId} AND cf."systemAttribute" = 'payout_gateway_id') AS "twinGateway",
      (SELECT fv."valueText" FROM "FieldValue" fv JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE fv."entityId" = ${pair.twinId} AND cf."systemAttribute" = 'payout_number') AS "twinNumber",
      (SELECT count(*)::int FROM "GlPostingSource" WHERE "sourceKind" = 'payout'
        AND "sourceId" = ${pair.twinId}) AS "twinClaims"
  `)
  const row = res.rows[0] as {
    legacyArchived: boolean
    legacyRefs: number
    legacyInbound: number
    twinGateway: string | null
    twinNumber: string | null
    twinClaims: number
  }
  const ok =
    row.legacyArchived &&
    row.legacyRefs === 0 &&
    row.legacyInbound === 0 &&
    row.twinGateway === pair.gatewayId &&
    row.twinNumber === pair.legacy.get('payout_number') &&
    row.twinClaims === pair.claims.length
  console.log(`  read-back: ${JSON.stringify(row)}`)
  if (!ok) throw new Error(`Fold of ${pair.gatewayId} did not read back as expected`)
}

async function fold(
  org: string,
  defId: string,
  fields: Map<Attr, Field>,
  actor: string,
  pair: Pair,
  rollback: boolean
) {
  const recordId = (id: string) => `${defId}:${id}` as `${string}:${string}`
  const crud = new UnifiedCrudHandler(org, actor, undefined, undefined, {
    session: seedSession('fold-duplicate-payouts (brief 114 P4)'),
  })
  const ROLLBACK = new Error('rehearsal rollback')
  try {
    await database.transaction(async (tx) => {
      await withAccountingCommitLock(tx, org)
      const scoped = crud.withDatabase(tx)

      // References only: the posting's lines key on the gateway id, which does not move.
      for (const c of pair.claims) {
        await tx.execute(sql`
          UPDATE "GlPostingSource" SET "sourceId" = ${pair.twinId}
          WHERE id = ${c.id} AND "sourceId" = ${pair.legacyId}
        `)
        await tx.execute(sql`
          UPDATE "GlPosting" SET built = jsonb_set(built, '{sources}', (
            SELECT jsonb_agg(CASE WHEN s->>'sourceKind' = 'payout' AND s->>'sourceId' = ${pair.legacyId}
              THEN jsonb_set(s, '{sourceId}', to_jsonb(${pair.twinId}::text)) ELSE s END ORDER BY i)
            FROM jsonb_array_elements(built->'sources') WITH ORDINALITY AS e(s, i)))
          WHERE id = ${c.glPostingId} AND jsonb_typeof(built->'sources') = 'array'
        `)
      }

      await scoped.update(recordId(pair.legacyId), { payout_gateway_id: null })
      const rail = pair.legacy.get('payout_payment_gateway')
      if (rail) {
        await scoped.update(
          recordId(pair.legacyId),
          { payout_payment_gateway: [rail] },
          { payout_payment_gateway: 'remove' }
        )
        // Unlinking leaves the rail's inverse row behind (lib bug in `syncInverseRelationships`).
        const orphans = await findOrphanInverseRows(tx, org, fields)
        await deleteOrphanInverseRows(
          tx,
          orphans.filter((o) => o.payoutId === pair.legacyId)
        )
      }
      const patch = twinPatch(pair)
      if (Object.keys(patch).length) await scoped.update(recordId(pair.twinId), patch)
      await scoped.archive(recordId(pair.legacyId))
      await assertFolded(tx, pair)
      if (rollback) throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  }
}

/** Inverse `payment_gateway_payouts` rows whose payout no longer points back at that rail. */
async function findOrphanInverseRows(db: Db, org: string, fields: Map<Attr, Field>) {
  const railField = fields.get('payout_payment_gateway')!.id
  const res = await db.execute(sql`
    SELECT inv.id, inv."entityId" AS "gatewayId", inv."relatedEntityId" AS "payoutId"
    FROM "CustomField" fwd
    JOIN "CustomField" icf
      ON icf.id = split_part(fwd.options->'relationship'->>'inverseResourceFieldId', ':', 2)
    JOIN "FieldValue" inv ON inv."fieldId" = icf.id AND inv."organizationId" = ${org}
    WHERE fwd.id = ${railField}
      AND NOT EXISTS (SELECT 1 FROM "FieldValue" f WHERE f."entityId" = inv."relatedEntityId"
        AND f."fieldId" = ${railField} AND f."relatedEntityId" = inv."entityId")
  `)
  return res.rows as Array<{ id: string; gatewayId: string; payoutId: string }>
}

async function deleteOrphanInverseRows(db: Db, rows: Array<{ id: string }>) {
  if (!rows.length) return
  await db.execute(sql`
    DELETE FROM "FieldValue" WHERE id IN (${sql.join(
      rows.map((o) => sql`${o.id}`),
      sql`, `
    )})
  `)
}

async function main() {
  assertLocalDb()
  const { org, apply, rehearse } = parseArgs()
  const mode = apply ? 'APPLY' : rehearse ? 'REHEARSE (writes rolled back)' : 'DRY RUN'
  console.log(`fold-duplicate-payouts — org ${org} — ${mode}`)

  const { defId, fields } = await loadFields(org)
  const pairs = await findPairs(org, defId, fields)
  console.log(`${pairs.length} pair(s) to fold`)
  for (const pair of pairs) describe(pair)

  // Rows left behind by an earlier run of this script, before the fold cleaned them up itself.
  const orphans = await findOrphanInverseRows(database, org, fields)
  console.log(`\n${orphans.length} orphaned rail→payout inverse row(s)`)
  for (const o of orphans)
    console.log(`  • FieldValue ${o.id}: rail ${o.gatewayId} → payout ${o.payoutId}`)
  if (apply) {
    await deleteOrphanInverseRows(database, orphans)
    if (orphans.length) console.log(`  ✓ deleted ${orphans.length}`)
  }

  if (!pairs.length || (!apply && !rehearse)) {
    process.exit(0)
  }

  const actor = await SystemUserService.getSystemUserForActions(org)
  for (const pair of pairs) {
    await fold(org, defId, fields, actor, pair, !apply)
    console.log(`  ✓ ${pair.gatewayId} ${apply ? 'folded' : 'rehearsed'}`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
