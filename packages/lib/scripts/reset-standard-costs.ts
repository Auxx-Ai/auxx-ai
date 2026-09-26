// packages/lib/scripts/reset-standard-costs.ts
//
// DEV-ONLY. Undoes what the automatic standard-cost paths produced for one org
// (plans/mrp/09-browser-test-fixes.md §12.2 D-SC1): the COGS/build postings, the
// backflush builds and their legs, the costs on sale movements, every part standard
// and the `price` work items. Orders, fulfillments, parts, BOMs, supplier prices and
// every other posting type stay, so a person can re-cost and the pricer re-posts.
//
//   npx dotenv -- node --conditions=source --import tsx/esm \
//     packages/lib/scripts/reset-standard-costs.ts DemoOrg1 [--confirm]
//
// Read-only without `--confirm`. Every step re-reads current state, so a re-run is safe.

import { inspect } from 'node:util'
import { database as db, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { withAccountingCommitLock } from '../src/accounting/ledger/post/accounting-commit-lock'
import { getOrgCache } from '../src/cache'
import { deleteEntityInstances } from '../src/entity-instances'
import { batchRecalculateQoH } from '../src/inventory/costing/qoh'
import { syncReliefWorkItems } from '../src/inventory/relief/relieve'
import { readOrganizationSettings } from '../src/settings/read'

const ORG_ARG = process.argv[2] ?? ''
const CONFIRM = process.argv.slice(3).includes('--confirm')

if (!ORG_ARG) {
  console.error(
    'usage: reset-standard-costs.ts <organizationId|name> [--confirm]\n\n' +
      '  --confirm  actually write. Without it this is a dry run.\n'
  )
  process.exit(1)
}

const MOVEMENT_ATTRS = [
  'stock_movement_type',
  'stock_movement_cost_basis',
  'stock_movement_build',
  'stock_movement_part',
  'stock_movement_fulfillment_line',
  'stock_movement_parent_movement',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
] as const

/** Exactly the keys `fillPendingCost` writes beside the basis; a pending row carries neither. */
const MOVEMENT_COST_ATTRS = ['stock_movement_unit_cost', 'stock_movement_extended_cost'] as const

const PART_STANDARD_ATTRS = [
  'part_standard_cost',
  'part_standard_material_cost',
  'part_standard_labor_cost',
  'part_standard_overhead_cost',
  'part_standard_cost_effective_at',
  'part_standard_cost_source',
  'part_standard_cost_origin',
] as const

const OTHER_ATTRS = ['build_source', 'build_status', 'fulfillment_line_fulfillment'] as const

type Attr =
  | (typeof MOVEMENT_ATTRS)[number]
  | (typeof PART_STANDARD_ATTRS)[number]
  | (typeof OTHER_ATTRS)[number]

/** A 121k-id `inArray` overflows the SQL builder's stack; chunk any whole-org id list. */
function* chunked<T>(items: readonly T[], size = 5000): Generator<T[]> {
  for (let offset = 0; offset < items.length; offset += size) {
    yield items.slice(offset, offset + size)
  }
}

function heading(text: string): void {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 74 - text.length))}\n`)
}

function tally(values: Iterable<string>): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  if (counts.size === 0) return '(none)'
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ')
}

/** Resolve `<org>` as an id first, then as a name. */
async function resolveOrg(): Promise<{ id: string; name: string | null }> {
  const byId = await db.query.Organization.findFirst({
    where: (t, { eq: is }) => is(t.id, ORG_ARG),
    columns: { id: true, name: true },
  })
  if (byId) return byId

  const byName = await db.query.Organization.findMany({
    where: (t, { ilike }) => ilike(t.name, ORG_ARG),
    columns: { id: true, name: true },
    limit: 5,
  })
  if (byName.length === 1 && byName[0]) return byName[0]
  if (byName.length > 1) {
    console.error(`'${ORG_ARG}' matches ${byName.length} organizations:`)
    for (const o of byName) console.error(`  ${o.id}  ${o.name}`)
    process.exit(1)
  }
  console.error(`No organization matches '${ORG_ARG}' by id or name.`)
  process.exit(1)
}

async function readFieldIds(organizationId: string): Promise<Map<Attr, string>> {
  const attrs: Attr[] = [...MOVEMENT_ATTRS, ...PART_STANDARD_ATTRS, ...OTHER_ATTRS]
  const rows = await db
    .select({ id: schema.CustomField.id, attribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, attrs)
      )
    )
  const byAttr = new Map<Attr, string>()
  for (const row of rows) {
    const attr = row.attribute as Attr
    if (byAttr.has(attr)) throw new Error(`Ambiguous field definition: ${attr}`)
    byAttr.set(attr, row.id)
  }
  const missing = attrs.filter((a) => !byAttr.has(a))
  if (missing.length > 0) throw new Error(`Missing system fields: ${missing.join(', ')}`)
  return byAttr
}

async function readInstanceIds(organizationId: string, entityType: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, entityType)
      )
    )
  return rows.map((r) => r.id)
}

type ValueRow = {
  entityId: string
  fieldId: string
  optionId: string | null
  relatedEntityId: string | null
}

async function readValues(organizationId: string, fieldIds: string[]): Promise<ValueRow[]> {
  return db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
}

interface Movement {
  id: string
  type: string | null
  basis: string | null
  buildId: string | null
  partId: string | null
  lineId: string | null
  parentId: string | null
  costRows: number
}

async function readMovements(
  organizationId: string,
  fields: Map<Attr, string>
): Promise<Map<string, Movement>> {
  const ids = await readInstanceIds(organizationId, 'stock_movement')
  const movements = new Map<string, Movement>(
    ids.map((id) => [
      id,
      {
        id,
        type: null,
        basis: null,
        buildId: null,
        partId: null,
        lineId: null,
        parentId: null,
        costRows: 0,
      },
    ])
  )
  const attrByField = new Map(MOVEMENT_ATTRS.map((a) => [fields.get(a)!, a]))
  for (const row of await readValues(organizationId, [...attrByField.keys()])) {
    const m = movements.get(row.entityId)
    if (!m) continue
    switch (attrByField.get(row.fieldId)) {
      case 'stock_movement_type':
        m.type = row.optionId
        break
      case 'stock_movement_cost_basis':
        m.basis = row.optionId
        break
      case 'stock_movement_build':
        m.buildId = row.relatedEntityId
        break
      case 'stock_movement_part':
        m.partId = row.relatedEntityId
        break
      case 'stock_movement_fulfillment_line':
        m.lineId = row.relatedEntityId
        break
      case 'stock_movement_parent_movement':
        m.parentId = row.relatedEntityId
        break
      default:
        m.costRows++
    }
  }
  return movements
}

/** `deleteEntityInstances`, exiting with the Postgres error when it fails. */
async function deleteInstancesOrExit(
  organizationId: string,
  ids: string[],
  what: string
): Promise<number> {
  const result = await deleteEntityInstances({ ids, organizationId })
  if (result.isOk()) return result.value.count
  let root: { cause?: unknown } = result.error
  while (root.cause && typeof root.cause === 'object') root = root.cause as { cause?: unknown }
  const { message, code, detail, constraint, table } = root as Record<string, unknown>
  console.error(`\n${what}: ${result.error.message}`)
  console.error(inspect({ message, code, detail, constraint, table }, { breakLength: 120 }))
  process.exit(1)
}

async function main() {
  const org = await resolveOrg()
  const orgId = org.id
  const fields = await readFieldIds(orgId)
  const fid = (a: Attr) => fields.get(a)!

  console.log(`\norganization ${org.name} (${orgId})`)
  console.log(`mode         ${CONFIRM ? 'WRITE' : 'dry run (pass --confirm to write)'}`)

  const settings = await readOrganizationSettings(orgId, [
    'accounting.cutoffPeriod',
    'ledger.lockedThroughMonth',
  ] as const)
  console.log(
    `settings     accounting.cutoffPeriod=${settings['accounting.cutoffPeriod'] ?? '-'}` +
      `  ledger.lockedThroughMonth=${settings['ledger.lockedThroughMonth'] ?? '-'}`
  )

  // ── 1. inventory_movement postings ─────────────────────────────────────────

  heading('1. inventory_movement postings')

  const postings = await db
    .select({
      id: schema.GlPosting.id,
      revision: schema.GlPosting.revision,
      status: schema.GlPosting.status,
      reversesId: schema.GlPosting.reversesId,
      subjectKind: schema.GlPostingSource.sourceKind,
    })
    .from(schema.GlPosting)
    .leftJoin(
      schema.GlPostingSource,
      and(
        eq(schema.GlPostingSource.glPostingId, schema.GlPosting.id),
        eq(schema.GlPostingSource.linkRole, 'subject')
      )
    )
    .where(
      and(
        eq(schema.GlPosting.organizationId, orgId),
        eq(schema.GlPosting.postingType, 'inventory_movement')
      )
    )
  const postingIds = [...new Set(postings.map((p) => p.id))]
  const postingSet = new Set(postingIds)

  let lineCount = 0
  let sourceCount = 0
  let batchRows: { glPostingId: string; state: string }[] = []
  let foreignReversals = 0
  let foreignSourceLinks = 0
  for (const chunk of chunked(postingIds)) {
    const [lines] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.GlPostingLine)
      .where(inArray(schema.GlPostingLine.glPostingId, chunk))
    lineCount += lines?.n ?? 0
    const [sources] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.GlPostingSource)
      .where(inArray(schema.GlPostingSource.glPostingId, chunk))
    sourceCount += sources?.n ?? 0
    batchRows = batchRows.concat(
      await db
        .select({
          glPostingId: schema.ExportBatchPosting.glPostingId,
          state: schema.ExportBatch.state,
        })
        .from(schema.ExportBatchPosting)
        .innerJoin(
          schema.ExportBatch,
          and(
            eq(schema.ExportBatch.organizationId, schema.ExportBatchPosting.organizationId),
            eq(schema.ExportBatch.id, schema.ExportBatchPosting.batchId)
          )
        )
        .where(
          and(
            eq(schema.ExportBatchPosting.organizationId, orgId),
            inArray(schema.ExportBatchPosting.glPostingId, chunk)
          )
        )
    )
    const reversals = await db
      .select({ id: schema.GlPosting.id })
      .from(schema.GlPosting)
      .where(
        and(eq(schema.GlPosting.organizationId, orgId), inArray(schema.GlPosting.reversesId, chunk))
      )
    foreignReversals += reversals.filter((r) => !postingSet.has(r.id)).length
    const links = await db
      .select({ glPostingId: schema.GlPostingSource.glPostingId })
      .from(schema.GlPostingSource)
      .where(
        and(
          eq(schema.GlPostingSource.organizationId, orgId),
          eq(schema.GlPostingSource.sourceKind, 'gl_posting'),
          inArray(schema.GlPostingSource.sourceId, chunk)
        )
      )
    foreignSourceLinks += links.filter((l) => !postingSet.has(l.glPostingId)).length
  }

  console.log(`GlPosting        ${postingIds.length}`)
  console.log(`  by subject     ${tally(postings.map((p) => p.subjectKind ?? '(none)'))}`)
  console.log(`  by status      ${tally(postings.map((p) => p.status))}`)
  console.log(`  reversals      ${postings.filter((p) => p.reversesId).length}`)
  console.log(`GlPostingLine    ${lineCount} (ON DELETE CASCADE)`)
  console.log(`GlPostingSource  ${sourceCount} (ON DELETE CASCADE; releases the claims)`)
  console.log(`ExportBatchPosting ${batchRows.length}  ${tally(batchRows.map((b) => b.state))}`)
  console.log(`other postings reversing one of these      ${foreignReversals}`)
  console.log(`other postings linking one as gl_posting   ${foreignSourceLinks}`)

  const sent = batchRows.filter((b) => b.state === 'sent')
  if (sent.length > 0 || foreignReversals > 0 || foreignSourceLinks > 0) {
    console.error(
      '\nREFUSING: a posting was sent to the provider, or a posting of another type depends on one.'
    )
    process.exit(1)
  }

  // ── 2. Backflush builds and their legs ─────────────────────────────────────

  heading('2. Backflush builds and their legs')

  const buildIds = await readInstanceIds(orgId, 'build')
  const buildValues = await readValues(orgId, [fid('build_source'), fid('build_status')])
  const buildSource = new Map<string, string | null>()
  const buildStatus = new Map<string, string | null>()
  for (const row of buildValues) {
    if (row.fieldId === fid('build_source')) buildSource.set(row.entityId, row.optionId)
    else buildStatus.set(row.entityId, row.optionId)
  }
  const backflushBuilds = buildIds.filter((id) => buildSource.get(id) === 'backflush')
  const otherBuilds = buildIds.filter((id) => buildSource.get(id) !== 'backflush')
  const backflushSet = new Set(backflushBuilds)

  console.log(`builds           ${buildIds.length}`)
  console.log(
    `  backflush      ${backflushBuilds.length}  status: ${tally(backflushBuilds.map((id) => buildStatus.get(id) ?? '(none)'))}`
  )
  console.log(`  kept (other)   ${otherBuilds.length}`)
  for (const id of otherBuilds) {
    console.log(
      `    ${id}  source=${buildSource.get(id) ?? '-'} status=${buildStatus.get(id) ?? '-'}`
    )
  }

  const movements = await readMovements(orgId, fields)
  const legIds = new Set(
    [...movements.values()].filter((m) => m.buildId && backflushSet.has(m.buildId)).map((m) => m.id)
  )
  // Exploded children of a leg go with it.
  for (const m of movements.values()) if (m.parentId && legIds.has(m.parentId)) legIds.add(m.id)
  const legs = [...legIds].map((id) => movements.get(id)!)
  const touchedPartIds = [...new Set(legs.flatMap((m) => (m.partId ? [m.partId] : [])))]

  console.log(
    `\nstock_movement legs  ${legs.length}  ${tally(legs.map((m) => `${m.type}/${m.basis}`))}`
  )
  console.log(`parts touched        ${touchedPartIds.length} (QoH recalculated in step 6)`)

  const deletedIds = [...legIds, ...backflushBuilds]
  let ruleRuns = 0
  let bindings = 0
  for (const chunk of chunked(deletedIds)) {
    const [rr] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.RecordRuleRun)
      .where(
        and(
          eq(schema.RecordRuleRun.organizationId, orgId),
          inArray(schema.RecordRuleRun.entityInstanceId, chunk)
        )
      )
    ruleRuns += rr?.n ?? 0
    const [dc] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.DataConnectorItem)
      .where(
        and(
          eq(schema.DataConnectorItem.organizationId, orgId),
          inArray(schema.DataConnectorItem.entityInstanceId, chunk)
        )
      )
    bindings += dc?.n ?? 0
  }
  console.log(`RecordRuleRun        ${ruleRuns} (no FK, cleared explicitly)`)
  console.log(`DataConnectorItem    ${bindings} (SET NULL FK, cleared explicitly)`)

  const runs = await db
    .select({ status: schema.SyncJob.status })
    .from(schema.SyncJob)
    .where(
      and(
        eq(schema.SyncJob.organizationId, orgId),
        eq(schema.SyncJob.type, 'backflush'),
        eq(schema.SyncJob.integrationCategory, 'inventory')
      )
    )
  console.log(`backflush SyncJob    ${runs.length} kept  ${tally(runs.map((r) => r.status))}`)

  // ── 3. Un-price the remaining movements ────────────────────────────────────

  heading('3. Remaining movements back to pending')

  const remaining = [...movements.values()].filter((m) => !legIds.has(m.id))
  const sales = remaining.filter(
    (m) => m.type === 'sale' && (m.basis === 'standard' || m.basis === 'pending')
  )
  const leftAlone = remaining.filter((m) => !sales.includes(m))
  const toRebase = sales.filter((m) => m.basis === 'standard')
  const withCost = sales.filter((m) => m.costRows > 0)

  console.log(
    `remaining            ${remaining.length}  ${tally(remaining.map((m) => `${m.type}/${m.basis}`))}`
  )
  console.log(`sale basis -> pending      ${toRebase.length}`)
  console.log(
    `sale rows with cost keys   ${withCost.length} (${withCost.reduce((a, m) => a + m.costRows, 0)} FieldValue rows deleted)`
  )
  console.log(
    `left alone (not sale/standard|pending) ${leftAlone.length}  ${tally(leftAlone.map((m) => `${m.type}/${m.basis}`))}`
  )

  // ── 4. Part standards ──────────────────────────────────────────────────────

  heading('4. Part standards')

  const partIds = new Set(await readInstanceIds(orgId, 'part'))
  const standardFieldIds = PART_STANDARD_ATTRS.map(fid)
  const standardRows = (await readValues(orgId, standardFieldIds)).filter((r) =>
    partIds.has(r.entityId)
  )
  const standardRowIds = standardRows.map((r) => `${r.entityId}:${r.fieldId}`)
  console.log(
    `parts with any standard field   ${new Set(standardRows.map((r) => r.entityId)).size}`
  )
  for (const attr of PART_STANDARD_ATTRS) {
    const n = standardRows.filter((r) => r.fieldId === fid(attr)).length
    console.log(`  ${attr.padEnd(34)} ${String(n).padStart(5)}`)
  }
  console.log(
    `  origin: ${tally(standardRows.filter((r) => r.fieldId === fid('part_standard_cost_origin')).map((r) => r.optionId ?? '-'))}`
  )
  console.log(`FieldValue rows deleted  ${standardRowIds.length}`)

  // ── 5. Work items ──────────────────────────────────────────────────────────

  heading('5. Work items')

  const items = await db
    .select({
      id: schema.AccountingWorkItem.id,
      stage: schema.AccountingWorkItem.stage,
      reasonCode: schema.AccountingWorkItem.reasonCode,
      sourceKind: schema.AccountingWorkItem.sourceKind,
      sourceId: schema.AccountingWorkItem.sourceId,
    })
    .from(schema.AccountingWorkItem)
    .where(eq(schema.AccountingWorkItem.organizationId, orgId))
  const priceItems = items.filter((i) => i.stage === 'price')
  const deletedSet = new Set(deletedIds)
  const orphanItems = items.filter(
    (i) =>
      i.stage !== 'price' &&
      (i.sourceKind === 'build' || i.sourceKind === 'stock_movement') &&
      deletedSet.has(i.sourceId)
  )
  const otherInventoryItems = items.filter(
    (i) =>
      i.stage !== 'price' &&
      (i.sourceKind === 'build' || i.sourceKind === 'stock_movement') &&
      !deletedSet.has(i.sourceId)
  )
  console.log(
    `price stage deleted     ${priceItems.length}  ${tally(priceItems.map((i) => `${i.sourceKind}/${i.reasonCode}`))}`
  )
  console.log(
    `orphans deleted         ${orphanItems.length}  ${tally(orphanItems.map((i) => `${i.stage}/${i.reasonCode}`))}`
  )
  console.log(
    `inventory items kept    ${otherInventoryItems.length}  ${tally(otherInventoryItems.map((i) => `${i.stage}/${i.sourceKind}/${i.reasonCode}`))}`
  )
  console.log(
    `all other stages kept   ${tally(items.filter((i) => i.stage !== 'price').map((i) => i.stage))}`
  )

  const saleLineIds = [...new Set(sales.flatMap((m) => (m.lineId ? [m.lineId] : [])))]
  const lineFulfillment = new Map<string, string>()
  for (const row of await readValues(orgId, [fid('fulfillment_line_fulfillment')])) {
    if (row.relatedEntityId) lineFulfillment.set(row.entityId, row.relatedEntityId)
  }
  const parkLines = saleLineIds.flatMap((lineId) => {
    const fulfillmentId = lineFulfillment.get(lineId)
    return fulfillmentId ? [{ fulfillmentLineId: lineId, fulfillmentId }] : []
  })
  const parkFulfillments = [...new Set(parkLines.map((l) => l.fulfillmentId))]
  console.log(
    `\nre-park (relief's syncReliefWorkItems)  ${parkFulfillments.length} fulfillment(s) -> price/STANDARD_COST_MISSING`
  )
  console.log(
    `  sale rows with no fulfillment line     ${sales.filter((m) => !m.lineId).length} (not parked)`
  )
  console.log(
    `  lines with no fulfillment              ${saleLineIds.length - parkLines.length} (not parked)`
  )

  if (!CONFIRM) {
    console.log('\ndry run — nothing was written. Re-run with --confirm.\n')
    return
  }

  // ── Writing ────────────────────────────────────────────────────────────────

  heading('Writing')

  // 1. Postings: batch links (NO ACTION FK) first, then descending revision for `reversesId` RESTRICT.
  const revisions = [...new Set(postings.map((p) => p.revision))].sort((a, b) => b - a)
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, orgId)
    for (const chunk of chunked(postingIds)) {
      await tx
        .delete(schema.ExportBatchPosting)
        .where(
          and(
            eq(schema.ExportBatchPosting.organizationId, orgId),
            inArray(schema.ExportBatchPosting.glPostingId, chunk)
          )
        )
    }
    for (const revision of revisions) {
      const ids = [...new Set(postings.filter((p) => p.revision === revision).map((p) => p.id))]
      for (const chunk of chunked(ids)) {
        await tx
          .delete(schema.GlPosting)
          .where(
            and(eq(schema.GlPosting.organizationId, orgId), inArray(schema.GlPosting.id, chunk))
          )
      }
    }
  })
  console.log(
    `1. deleted ${postingIds.length} inventory_movement posting(s) with their lines and sources`
  )

  // 2. Builds and legs: side rows, then movements before builds.
  for (const chunk of chunked(deletedIds)) {
    await db
      .delete(schema.RecordRuleRun)
      .where(
        and(
          eq(schema.RecordRuleRun.organizationId, orgId),
          inArray(schema.RecordRuleRun.entityInstanceId, chunk)
        )
      )
    await db
      .delete(schema.DataConnectorItem)
      .where(
        and(
          eq(schema.DataConnectorItem.organizationId, orgId),
          inArray(schema.DataConnectorItem.entityInstanceId, chunk)
        )
      )
  }
  const movedDeleted = await deleteInstancesOrExit(orgId, [...legIds], 'movement delete failed')
  const buildsDeleted = await deleteInstancesOrExit(orgId, backflushBuilds, 'build delete failed')
  console.log(`2. deleted ${movedDeleted} leg movement(s), ${buildsDeleted} backflush build(s)`)

  // 3. Un-price sale rows in bulk: a costed row becomes indistinguishable from a fresh pending one.
  const saleIds = sales.map((m) => m.id)
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, orgId)
    for (const chunk of chunked(saleIds)) {
      await tx
        .update(schema.FieldValue)
        .set({ optionId: 'pending', updatedAt: new Date() })
        .where(
          and(
            eq(schema.FieldValue.organizationId, orgId),
            eq(schema.FieldValue.fieldId, fid('stock_movement_cost_basis')),
            eq(schema.FieldValue.optionId, 'standard'),
            inArray(schema.FieldValue.entityId, chunk)
          )
        )
      await tx
        .delete(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, orgId),
            inArray(schema.FieldValue.fieldId, MOVEMENT_COST_ATTRS.map(fid)),
            inArray(schema.FieldValue.entityId, chunk)
          )
        )
    }
  })
  console.log(
    `3. ${toRebase.length} sale row(s) back to pending, cost keys cleared on ${withCost.length}`
  )

  // 4. Part standards.
  const standardPartIds = [...new Set(standardRows.map((r) => r.entityId))]
  await db.transaction(async (tx) => {
    for (const chunk of chunked(standardPartIds)) {
      await tx
        .delete(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, orgId),
            inArray(schema.FieldValue.fieldId, standardFieldIds),
            inArray(schema.FieldValue.entityId, chunk)
          )
        )
    }
  })
  console.log(
    `4. cleared ${standardRowIds.length} standard FieldValue row(s) on ${standardPartIds.length} part(s)`
  )

  // 5. Work items: price stage + orphans, then re-park per dispatch through relief's own function.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.AccountingWorkItem)
      .where(
        and(
          eq(schema.AccountingWorkItem.organizationId, orgId),
          eq(schema.AccountingWorkItem.stage, 'price')
        )
      )
    for (const chunk of chunked(orphanItems.map((i) => i.id))) {
      await tx.delete(schema.AccountingWorkItem).where(inArray(schema.AccountingWorkItem.id, chunk))
    }
  })
  const byFulfillment = new Map<string, typeof parkLines>()
  for (const line of parkLines) {
    const group = byFulfillment.get(line.fulfillmentId) ?? []
    group.push(line)
    byFulfillment.set(line.fulfillmentId, group)
  }
  const groups = [...byFulfillment.values()]
  for (let i = 0; i < groups.length; i += 200) {
    await syncReliefWorkItems(db, orgId, groups.slice(i, i + 200).flat(), new Map())
  }
  const [parked] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.AccountingWorkItem)
    .where(
      and(
        eq(schema.AccountingWorkItem.organizationId, orgId),
        eq(schema.AccountingWorkItem.stage, 'price')
      )
    )
  console.log(
    `5. deleted ${priceItems.length} price + ${orphanItems.length} orphan item(s); ${parked?.n ?? 0} price item(s) now parked`
  )

  // 6. QoH for the parts the deleted legs moved; sale rows are unchanged so relieved quantities hold.
  await batchRecalculateQoH(orgId, touchedPartIds)
  console.log(`6. recalculated QoH for ${touchedPartIds.length} part(s)`)

  await getOrgCache().invalidateAndRecompute(orgId, ['resources', 'customFields'])
  console.log('7. org cache invalidated\n\ndone.\n')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
