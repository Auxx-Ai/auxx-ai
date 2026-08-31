// packages/lib/scripts/audit-part-references.ts
//
// Read-only audit of everything the four visible money parents are attached to,
// and a before/after diff for the "delete them all and see what stays" test
// (plans/money/tasks/20-part-delete-safety.md §7, widened to `builds`,
// `purchase-orders` and `vendor-bills` by
// plans/money/tasks/21-money-parent-delete-safety.md §8).
//
// ⚠️ **The diff now measures the GUARDS as much as the strands.** Before task 20
// and 21 every parent deleted clean and every child was left behind; now a
// settled parent refuses, so a `subject` count that does NOT fall to zero is the
// guard working rather than the test failing. Read it against
// `docs/inventory-costing-architecture-guide.md` §6.4.
//
// It touches nothing. Run it, wipe the parts, run it again against the saved
// snapshot, and the diff tells you which numbers moved and which ones were not
// allowed to.
//
//   # before
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/audit-part-references.ts --save /tmp/parts-before.json
//
//   # ...delete the parts...
//
//   # after
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/audit-part-references.ts --compare /tmp/parts-before.json
//
//   # one org only (name or id)
//   … audit-part-references.ts --org DemoOrg1
//
// ## What the four metric kinds mean
//
// Every metric is tagged, and the diff's verdict comes from the tag rather than
// from a human reading the numbers:
//
//   * `subject`   - the parents themselves. Falling to zero means everything was
//     deletable; a residue is what the guards refused.
//   * `must-hold` - a change here is an INTEGRITY FAILURE, not an observation.
//     The GL is the whole of it: a posted `GlPosting` and its lines, the role
//     assignments and the chart are frozen accounting records, and a record
//     delete may not move them. The vendor's own documents are here for the same
//     reason - a purchase order line and a bill line are things a vendor sent
//     us, and deleting our part does not unsend them
//     (`docs/inventory-costing-architecture-guide.md`: a bill's totals are
//     transcribed, never computed).
//   * `strand`    - orphaned children: rows that survive with the part cell now
//     empty. Growth here is the finding this whole exercise exists to measure,
//     and today it is EXPECTED to grow, because `parts` has no pre-delete hook.
//   * `hygiene`   - must be zero before and after. A non-zero value means
//     `sweepEntityFieldValues` did not do its job, which would be a much more
//     serious bug than anything task 20 is about.
//
// ⚠️ Read the `strand` lines against the briefs before calling any of them a bug.
// Purchase order lines and vendor bill lines are SUPPOSED to survive a PART
// delete (`disposition: leave`) while being cascaded by their own parent's
// delete; `subparts` and `vendor-parts` are not supposed to survive either.

import { database as db } from '@auxx/database'
import { sql } from 'drizzle-orm'

// =============================================================================
// ARGS
// =============================================================================

const argv = process.argv.slice(2)

function flag(name: string): string | null {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
}

const ORG_FILTER = flag('--org')
const SAVE_PATH = flag('--save')
const COMPARE_PATH = flag('--compare')

// =============================================================================
// SHAPE
// =============================================================================

type MetricKind = 'subject' | 'must-hold' | 'strand' | 'hygiene'

interface Metric {
  key: string
  kind: MetricKind
  value: number
  /** Free-text context printed beside the number. */
  note?: string
}

interface OrgSnapshot {
  organizationId: string
  organizationName: string
  metrics: Metric[]
  /** Inbound relationship rows by systemAttribute, for the human-readable table. */
  inbound: { attribute: string; rows: number; distinctParts: number }[]
  /** Stock movements by accounting period, for the settled-period question. */
  movementPeriods: { period: string; movements: number; uncosted: number }[]
}

interface Snapshot {
  takenAt: string
  orgs: OrgSnapshot[]
}

/**
 * Every relationship that names one of the audited parents, as
 * `systemAttribute`. Sourced from the live `CustomField` rows rather than from a
 * hand-kept list — but pinned here so a renamed attribute shows up as a missing
 * line instead of silently dropping out of the audit.
 */
const REFERENCE_ATTRIBUTES = [
  // → part
  'stock_movement_part',
  'purchase_order_line_part',
  'vendor_bill_line_part',
  'vendor_part_part',
  'subpart_parent_part',
  'subpart_child_part',
  'catalog_item_part',
  'line_item_part',
  'product_parts',
  // → build
  'stock_movement_build',
  'build_reversal_of',
  // → purchase_order
  'purchase_order_line_purchase_order',
  'vendor_bill_purchase_order',
  // → vendor_bill
  'vendor_bill_line_vendor_bill',
  'vendor_payment_allocation_vendor_bill',
] as const

/**
 * What the guard is supposed to do with a child, which drives the metric kind so
 * the diff's verdict and the briefs cannot drift apart.
 *
 *   * `cascade`           - should go with the parent. Its total is watched.
 *   * `refuse-or-cascade` - goes only when the period is open; a settled one
 *     makes the parent undeletable.
 *   * `refuse`            - its mere existence refuses the parent's delete, so
 *     the parent count is what should not move.
 *   * `leave`             - somebody else's document. Its total is `must-hold`.
 */
type Disposition = 'cascade' | 'refuse-or-cascade' | 'refuse' | 'leave'

interface ParentSpec {
  /** `EntityDefinition.entityType`. */
  entityType: string
  /** Metric prefix — the apiSlug, so a key reads the way the guard registers. */
  slug: string
  children: readonly { entityType: string; attribute: string; disposition: Disposition }[]
}

/**
 * The four `isVisible` money parents
 * (`docs/inventory-costing-architecture-guide.md` §3), each with the children
 * that hang off it and what its guard does with them.
 *
 * ⚠️ **`purchase_order`'s receipts are deliberately absent from its `children`.**
 * A `stock_movement` names the purchase order LINE, never the order, so it is
 * not an inbound reference to the parent at all — which is exactly why
 * `sweepEntityFieldValues` never touched receipts and an unguarded order delete
 * looked harmless. The line's own total is what moves.
 */
const PARENTS: readonly ParentSpec[] = [
  {
    entityType: 'part',
    slug: 'parts',
    children: [
      {
        entityType: 'stock_movement',
        attribute: 'stock_movement_part',
        disposition: 'refuse-or-cascade',
      },
      { entityType: 'subpart', attribute: 'subpart_child_part', disposition: 'cascade' },
      { entityType: 'vendor_part', attribute: 'vendor_part_part', disposition: 'cascade' },
      {
        entityType: 'purchase_order_line',
        attribute: 'purchase_order_line_part',
        disposition: 'leave',
      },
      { entityType: 'vendor_bill_line', attribute: 'vendor_bill_line_part', disposition: 'leave' },
      { entityType: 'catalog_item', attribute: 'catalog_item_part', disposition: 'leave' },
      { entityType: 'line_item', attribute: 'line_item_part', disposition: 'leave' },
    ],
  },
  {
    entityType: 'build',
    slug: 'builds',
    children: [
      {
        entityType: 'stock_movement',
        attribute: 'stock_movement_build',
        disposition: 'refuse-or-cascade',
      },
      { entityType: 'build', attribute: 'build_reversal_of', disposition: 'refuse' },
    ],
  },
  {
    entityType: 'purchase_order',
    slug: 'purchase-orders',
    children: [
      {
        entityType: 'purchase_order_line',
        attribute: 'purchase_order_line_purchase_order',
        disposition: 'cascade',
      },
      { entityType: 'vendor_bill', attribute: 'vendor_bill_purchase_order', disposition: 'refuse' },
    ],
  },
  {
    entityType: 'vendor_bill',
    slug: 'vendor-bills',
    children: [
      {
        entityType: 'vendor_bill_line',
        attribute: 'vendor_bill_line_vendor_bill',
        disposition: 'cascade',
      },
      {
        entityType: 'vendor_payment_allocation',
        attribute: 'vendor_payment_allocation_vendor_bill',
        disposition: 'refuse',
      },
    ],
  },
]

// =============================================================================
// QUERIES
// =============================================================================

/**
 * ⚠️ **A named org qualifies on its part DEFINITION, never on having parts left.**
 * Requiring instances is right for the unfiltered listing — it keeps the ~28
 * seeded orgs that have a part def and no parts out of the way — and it is
 * exactly wrong for `--compare`, where the whole point is that the parts are
 * gone. Gating both the same way made the after-run of the delete test print
 * "No org matched" instead of the diff it exists to produce.
 */
async function resolveOrgs(): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.execute<{ id: string; name: string }>(sql`
    SELECT DISTINCT o.id, o.name
    FROM "Organization" o
    JOIN "EntityDefinition" ed
      ON ed."organizationId" = o.id AND ed."entityType" = 'part'
    ${
      ORG_FILTER
        ? sql`WHERE o.name = ${ORG_FILTER} OR o.id = ${ORG_FILTER}`
        : sql`WHERE EXISTS (SELECT 1 FROM "EntityInstance" ei WHERE ei."entityDefinitionId" = ed.id)`
    }
    ORDER BY o.name
  `)
  return rows
}

/** One entity definition's id for an org, or null if it has none. */
async function defIdFor(organizationId: string, entityType: string): Promise<string | null> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT id FROM "EntityDefinition"
    WHERE "organizationId" = ${organizationId} AND "entityType" = ${entityType}
    LIMIT 1
  `)
  return rows[0]?.id ?? null
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(query)
  return Number(rows[0]?.n ?? 0)
}

/**
 * Inbound relationship rows, one line per attribute that names a part.
 *
 * Counted through `CustomField.systemAttribute` rather than through
 * `FieldValue.relatedEntityDefinitionId`, because the second is a denormalized
 * copy and this audit's whole job is to notice when copies disagree.
 */
async function inboundByAttribute(
  organizationId: string,
  defId: string
): Promise<{ attribute: string; rows: number; distinctParts: number }[]> {
  const { rows } = await db.execute<{
    attribute: string
    rows: number
    distinct_parts: number
  }>(sql`
    SELECT cf."systemAttribute" AS attribute,
           count(*)::int AS rows,
           count(DISTINCT fv."relatedEntityId")::int AS distinct_parts
    FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    JOIN "EntityInstance" target ON target.id = fv."relatedEntityId"
    WHERE fv."organizationId" = ${organizationId}
      AND target."entityDefinitionId" = ${defId}
      AND cf."systemAttribute" IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC
  `)
  return rows.map((r) => ({
    attribute: r.attribute,
    rows: Number(r.rows),
    distinctParts: Number(r.distinct_parts),
  }))
}

/**
 * Stock movements by accounting month.
 *
 * ⚠️ The accounting date is `stock_movement_occurred_at` **coalesced onto
 * `EntityInstance.createdAt`** — the documented fallback (`receipt-queries.ts`).
 * The guard in task 20 §2a must derive its period the same way or a movement can
 * be judged under one date and posted under another.
 *
 * Explosion parents (`stock_movement_adjust_subparts`) are excluded, matching
 * `gather-month-end-inventory.ts`: they carry no quantity of their own and
 * legitimately carry no cost, so counting them would report phantom "uncosted"
 * movements.
 */
async function movementsByPeriod(
  organizationId: string
): Promise<{ period: string; movements: number; uncosted: number }[]> {
  const { rows } = await db.execute<{ period: string; movements: number; uncosted: number }>(sql`
    WITH mv AS (
      SELECT ei.id,
             coalesce(occurred."valueDate", ei."createdAt") AS accounting_date,
             cost."valueNumber" AS unit_cost
      FROM "EntityInstance" ei
      JOIN "EntityDefinition" ed
        ON ed.id = ei."entityDefinitionId" AND ed."entityType" = 'stock_movement'
      LEFT JOIN "FieldValue" occurred
        ON occurred."entityId" = ei.id
       AND occurred."fieldId" IN (
             SELECT id FROM "CustomField"
             WHERE "entityDefinitionId" = ed.id
               AND "systemAttribute" = 'stock_movement_occurred_at')
      LEFT JOIN "FieldValue" cost
        ON cost."entityId" = ei.id
       AND cost."fieldId" IN (
             SELECT id FROM "CustomField"
             WHERE "entityDefinitionId" = ed.id
               AND "systemAttribute" = 'stock_movement_unit_cost')
      LEFT JOIN "FieldValue" explode
        ON explode."entityId" = ei.id
       AND explode."fieldId" IN (
             SELECT id FROM "CustomField"
             WHERE "entityDefinitionId" = ed.id
               AND "systemAttribute" = 'stock_movement_adjust_subparts')
      WHERE ei."organizationId" = ${organizationId}
        AND ei."archivedAt" IS NULL
        AND coalesce(explode."valueBoolean", false) = false
    )
    SELECT to_char(accounting_date, 'YYYY-MM') AS period,
           count(*)::int AS movements,
           count(*) FILTER (WHERE unit_cost IS NULL)::int AS uncosted
    FROM mv GROUP BY 1 ORDER BY 1
  `)
  return rows.map((r) => ({
    period: r.period,
    movements: Number(r.movements),
    uncosted: Number(r.uncosted),
  }))
}

// =============================================================================
// SNAPSHOT
// =============================================================================

async function snapshotOrg(org: { id: string; name: string }): Promise<OrgSnapshot> {
  const metrics: Metric[] = []
  const push = (key: string, kind: MetricKind, value: number, note?: string) =>
    metrics.push({ key, kind, value, note })

  const partDef = await defIdFor(org.id, 'part')
  if (!partDef) {
    return {
      organizationId: org.id,
      organizationName: org.name,
      metrics,
      inbound: [],
      movementPeriods: [],
    }
  }

  // ── one block per visible money parent ────────────────────────────────────
  for (const parent of PARENTS) {
    const defId = await defIdFor(org.id, parent.entityType)
    if (!defId) continue

    // ── subject: the parents themselves ─────────────────────────────────────
    push(
      `${parent.slug}.instances`,
      'subject',
      await scalar(sql`
      SELECT count(*)::int AS n FROM "EntityInstance" WHERE "entityDefinitionId" = ${defId}`)
    )

    push(
      `${parent.slug}.fieldValues`,
      'subject',
      await scalar(sql`
      SELECT count(*)::int AS n FROM "FieldValue" fv
      JOIN "EntityInstance" ei ON ei.id = fv."entityId"
      WHERE ei."entityDefinitionId" = ${defId}`)
    )

    push(
      `${parent.slug}.timelineEvents.own`,
      'subject',
      await scalar(sql`
      SELECT count(*)::int AS n FROM "TimelineEvent" te
      JOIN "EntityInstance" ei ON ei.id = te."entityId"
      WHERE ei."entityDefinitionId" = ${defId}`)
    )

    // Deliberately NOT `subject`: `deleteEntityInstance` leaves these on purpose
    // — "this contact once had an order" survives the order. Watched, not
    // expected to fall.
    push(
      `${parent.slug}.timelineEvents.asRelated`,
      'strand',
      await scalar(sql`
      SELECT count(*)::int AS n FROM "TimelineEvent" te
      JOIN "EntityInstance" ei ON ei.id = te."relatedEntityId"
      WHERE ei."entityDefinitionId" = ${defId}`),
      'left behind deliberately'
    )

    // ── children: total, and how many have lost their parent ────────────────
    for (const child of parent.children) {
      const total = await scalar(sql`
        SELECT count(*)::int AS n FROM "EntityInstance" ei
        JOIN "EntityDefinition" ed ON ed.id = ei."entityDefinitionId"
        WHERE ei."organizationId" = ${org.id} AND ed."entityType" = ${child.entityType}`)

      const orphaned = await scalar(sql`
        SELECT count(*)::int AS n FROM "EntityInstance" ei
        JOIN "EntityDefinition" ed ON ed.id = ei."entityDefinitionId"
        WHERE ei."organizationId" = ${org.id} AND ed."entityType" = ${child.entityType}
          AND NOT EXISTS (
            SELECT 1 FROM "FieldValue" fv
            JOIN "CustomField" cf ON cf.id = fv."fieldId"
            WHERE fv."entityId" = ei.id
              AND cf."systemAttribute" = ${child.attribute}
              AND fv."relatedEntityId" IS NOT NULL)`)

      // A `leave` child's total is frozen: it is the vendor's document, and the
      // parent's delete may not touch it. `cascade` and `refuse-or-cascade`
      // totals are SUPPOSED to fall, so they are only watched.
      push(
        `children.${parent.slug}.${child.entityType}.total`,
        child.disposition === 'leave' ? 'must-hold' : 'strand',
        total,
        child.disposition
      )
      push(
        `children.${parent.slug}.${child.entityType}.orphaned`,
        'strand',
        orphaned,
        child.disposition
      )
    }
  }

  const defId = partDef

  // The BOM row whose displayName IS its child part: after a part delete the
  // display cascade nulls it and the row renders as nothing at all.
  push(
    'subparts.namelessRows',
    'strand',
    await scalar(sql`
    SELECT count(*)::int AS n FROM "EntityInstance" ei
    JOIN "EntityDefinition" ed ON ed.id = ei."entityDefinitionId"
    WHERE ei."organizationId" = ${org.id} AND ed."entityType" = 'subpart'
      AND ei."displayName" IS NULL`)
  )

  // ── hygiene: the sweep's own work ─────────────────────────────────────────
  push(
    'hygiene.danglingRelationValues',
    'hygiene',
    await scalar(sql`
    SELECT count(*)::int AS n FROM "FieldValue" fv
    LEFT JOIN "EntityInstance" ei ON ei.id = fv."relatedEntityId"
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    WHERE fv."organizationId" = ${org.id}
      AND fv."relatedEntityId" IS NOT NULL
      AND ei.id IS NULL
      AND cf."systemAttribute" IN (${sql.join(
        REFERENCE_ATTRIBUTES.map((a) => sql`${a}`),
        sql`, `
      )})`),
    'money-parent relations pointing at a row that is gone'
  )

  push(
    'hygiene.orphanedTimelineEvents',
    'hygiene',
    await scalar(sql`
    SELECT count(*)::int AS n FROM "TimelineEvent" te
    LEFT JOIN "EntityInstance" ei ON ei.id = te."entityId"
    WHERE te."organizationId" = ${org.id}
      AND te."entityType" = ${defId}
      AND ei.id IS NULL`)
  )

  // Both halves of a relation are separate rows and nothing enforces the pair.
  // A non-zero value here is a pre-existing writer bug, not a delete bug — but
  // it is exactly the class of drift this audit is for.
  push(
    'hygiene.mirrorHalfMissing',
    'hygiene',
    await scalar(sql`
    WITH fwd AS (
      SELECT fv."entityId" AS child, fv."relatedEntityId" AS part
      FROM "FieldValue" fv JOIN "CustomField" cf ON cf.id = fv."fieldId"
      WHERE fv."organizationId" = ${org.id}
        AND cf."systemAttribute" = 'purchase_order_line_part'
        AND fv."relatedEntityId" IS NOT NULL),
    rev AS (
      SELECT fv."relatedEntityId" AS child, fv."entityId" AS part
      FROM "FieldValue" fv JOIN "CustomField" cf ON cf.id = fv."fieldId"
      WHERE fv."organizationId" = ${org.id}
        AND cf."systemAttribute" = 'part_purchase_order_lines'
        AND fv."relatedEntityId" IS NOT NULL)
    SELECT (
      (SELECT count(*) FROM fwd f LEFT JOIN rev r
         ON r.child = f.child AND r.part = f.part WHERE r.child IS NULL)
    + (SELECT count(*) FROM rev r LEFT JOIN fwd f
         ON f.child = r.child AND f.part = r.part WHERE f.child IS NULL)
    )::int AS n`),
    'part <-> purchase order line, unpaired halves'
  )

  // ── must-hold: the frozen accounting record ───────────────────────────────
  // The `GlPostingStatus` enum, exhaustively. Postgres rejects an unknown label
  // outright, so a status added later fails loudly here rather than quietly
  // dropping out of the audit.
  for (const status of ['pending', 'posted', 'failed', 'reversed'] as const) {
    push(
      `gl.postings.${status}`,
      'must-hold',
      await scalar(sql`
      SELECT count(*)::int AS n FROM "GlPosting"
      WHERE "organizationId" = ${org.id} AND status = ${status}`)
    )
  }

  push(
    'gl.postedTotalMinor',
    'must-hold',
    await scalar(sql`
    SELECT coalesce(sum("totalMinor"), 0)::float8 AS n FROM "GlPosting"
    WHERE "organizationId" = ${org.id} AND status = 'posted'`)
  )

  push(
    'gl.postingLines',
    'must-hold',
    await scalar(sql`
    SELECT count(*)::int AS n FROM "GlPostingLine" l
    JOIN "GlPosting" p ON p.id = l."glPostingId"
    WHERE p."organizationId" = ${org.id}`)
  )

  push(
    'gl.roleAssignments',
    'must-hold',
    await scalar(sql`
    SELECT count(*)::int AS n FROM "GlRoleAssignment" WHERE "organizationId" = ${org.id}`)
  )

  push(
    'gl.accounts',
    'must-hold',
    await scalar(sql`
    SELECT count(*)::int AS n FROM "EntityInstance" ei
    JOIN "EntityDefinition" ed ON ed.id = ei."entityDefinitionId"
    WHERE ei."organizationId" = ${org.id} AND ed."entityType" = 'gl_account'`)
  )

  // ── the subledger the posted entry was derived from ───────────────────────
  push(
    'subledger.movementExtendedCost',
    'strand',
    await scalar(sql`
    SELECT coalesce(sum(fv."valueNumber"), 0)::float8 AS n
    FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    WHERE fv."organizationId" = ${org.id}
      AND cf."systemAttribute" = 'stock_movement_extended_cost'`)
  )

  push(
    'subledger.partsWithQoH',
    'strand',
    await scalar(sql`
    SELECT count(*)::int AS n FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    WHERE fv."organizationId" = ${org.id}
      AND cf."systemAttribute" = 'part_quantity_on_hand'`)
  )

  return {
    organizationId: org.id,
    organizationName: org.name,
    metrics,
    inbound: await inboundByAttribute(org.id, defId),
    movementPeriods: await movementsByPeriod(org.id),
  }
}

// =============================================================================
// OUTPUT
// =============================================================================

const KIND_MARK: Record<MetricKind, string> = {
  subject: '  ',
  'must-hold': '🔒',
  strand: '· ',
  hygiene: '✓ ',
}

function printSnapshot(snap: Snapshot): void {
  for (const org of snap.orgs) {
    console.log(
      `\n${'='.repeat(78)}\n${org.organizationName}  (${org.organizationId})\n${'='.repeat(78)}`
    )

    if (org.metrics.length === 0) {
      console.log('  no part definition')
      continue
    }

    for (const m of org.metrics) {
      const note = m.note ? `  ${m.note}` : ''
      // A hygiene metric is defined as zero. Non-zero at BASELINE is a
      // pre-existing defect that has nothing to do with the delete test, and it
      // is worth naming now — the diff only reports metrics that MOVE, so a
      // value that is already wrong and stays wrong would never be printed again.
      const preExisting = m.kind === 'hygiene' && m.value > 0 ? '  ⚠ non-zero BEFORE the test' : ''
      console.log(
        `${KIND_MARK[m.kind]} ${m.key.padEnd(42)} ${String(m.value).padStart(12)}${note}${preExisting}`
      )
    }

    if (org.inbound.length > 0) {
      console.log('\n  inbound relationship rows (what points AT a part)')
      for (const r of org.inbound) {
        console.log(
          `    ${r.attribute.padEnd(34)} ${String(r.rows).padStart(6)} rows  ${r.distinctParts} parts`
        )
      }
    }

    if (org.movementPeriods.length > 0) {
      console.log('\n  stock movements by accounting month')
      for (const p of org.movementPeriods) {
        const flag = p.uncosted > 0 ? `  (${p.uncosted} uncosted)` : ''
        console.log(`    ${p.period}  ${String(p.movements).padStart(6)}${flag}`)
      }
      console.log('    ⚠️  cross-check against `listClosePeriods` — a month that is')
      console.log('        posted or locked is what task 20 §2a refuses on.')
    }
  }
}

function printDiff(before: Snapshot, after: Snapshot): void {
  console.log(`\nBEFORE ${before.takenAt}\nAFTER  ${after.takenAt}`)

  let failures = 0
  let strands = 0

  for (const afterOrg of after.orgs) {
    const beforeOrg = before.orgs.find((o) => o.organizationId === afterOrg.organizationId)
    if (!beforeOrg) {
      console.log(`\n${afterOrg.organizationName}: not in the before snapshot, skipped`)
      continue
    }

    const lines: string[] = []
    for (const m of afterOrg.metrics) {
      const prior = beforeOrg.metrics.find((p) => p.key === m.key)
      if (!prior || prior.value === m.value) continue

      const delta = m.value - prior.value
      const sign = delta > 0 ? `+${delta}` : String(delta)
      let verdict = ''

      if (m.kind === 'must-hold') {
        verdict = '  ✗ INTEGRITY FAILURE — a record delete moved a frozen accounting number'
        failures++
      } else if (m.kind === 'hygiene' && m.value > 0) {
        verdict = '  ✗ SWEEP FAILURE — sweepEntityFieldValues left references behind'
        failures++
      } else if (m.kind === 'strand' && delta > 0) {
        verdict = '  ⚠ STRANDED — orphaned rows grew'
        strands++
      } else if (m.kind === 'subject') {
        verdict = '  ✓'
      }

      lines.push(
        `  ${m.key.padEnd(42)} ${String(prior.value).padStart(10)} → ${String(m.value).padStart(10)}  ${sign.padStart(8)}${verdict}`
      )
    }

    console.log(`\n${'='.repeat(78)}\n${afterOrg.organizationName}\n${'='.repeat(78)}`)
    console.log(lines.length > 0 ? lines.join('\n') : '  nothing moved')
  }

  console.log(`\n${'-'.repeat(78)}`)
  console.log(`${failures} integrity/sweep failure(s), ${strands} metric(s) stranded rows.`)
  if (strands > 0 && failures === 0) {
    console.log('Stranded rows with no integrity failure is the EXPECTED result today:')
    console.log('`parts` has no pre-delete hook. That is what task 20 builds.')
  }
}

// =============================================================================

async function main(): Promise<void> {
  const orgs = await resolveOrgs()
  if (orgs.length === 0) {
    console.log(
      ORG_FILTER ? `No org matched "${ORG_FILTER}" with any parts.` : 'No org has any parts.'
    )
    process.exit(0)
  }

  const snapshot: Snapshot = {
    takenAt: new Date().toISOString(),
    orgs: [],
  }
  for (const org of orgs) {
    snapshot.orgs.push(await snapshotOrg(org))
  }

  if (COMPARE_PATH) {
    const { readFileSync } = await import('node:fs')
    printDiff(JSON.parse(readFileSync(COMPARE_PATH, 'utf8')) as Snapshot, snapshot)
  } else {
    printSnapshot(snapshot)
    console.log('\n🔒 must-hold — a change is an integrity failure')
    console.log('·  strand    — orphaned rows; growth is the finding')
    console.log('✓  hygiene   — must be zero, before and after')
  }

  if (SAVE_PATH) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(SAVE_PATH, JSON.stringify(snapshot, null, 2))
    console.log(`\nSaved to ${SAVE_PATH}`)
  }

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
