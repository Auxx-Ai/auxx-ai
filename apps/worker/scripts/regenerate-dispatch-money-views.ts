// apps/worker/scripts/regenerate-dispatch-money-views.ts
/**
 * LOCAL DEV script (no migration — dispatch/money isn't in production yet). Rebuilds the
 * per-org DEFAULT `panel` + `dialog_create` TableViews for service_request / work_order /
 * quote / invoice so they match the current field registry + the seed spec in
 * `packages/lib/src/seed/entity-seeder/create-field-views.ts`.
 *
 * WHY: `use-field-view.ts` only falls back to the registry (`showInPanel`/`sortOrder`) when
 * NO stored view exists. Every seeded org has a shared default `panel`/`dialog_create`
 * TableView, and those win — so registry edits alone don't move an existing org. Older orgs'
 * stored views were snapshotted from the OLD registry (contact mid-list, work_orders/quotes/
 * money-totals visible), which is what this rebuilds.
 *
 * Identifier note: system audit fields (id/created_at/updated_at) have NO CustomField row —
 * they surface via the static registry with resourceFieldId `<defId>:<staticKey>`. Every
 * other field (incl. created_by_id) has a CustomField row keyed `<defId>:<cfId>`. This script
 * emits both forms so the excluded audit fields stay hidden.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/regenerate-dispatch-money-views.ts
 */

import { database } from '@auxx/database'
import { flushOrganization, onCacheEvent } from '@auxx/lib/cache'

/** systemAttribute → static field key for the audit fields that have no CustomField row. */
const STATIC_KEY: Record<string, string> = {
  id: 'id',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
}

interface EntitySpec {
  /** panel excludeFields — systemAttributes hidden from the field panel */
  panelExclude: string[]
  /** dialog_create includeFields — systemAttributes shown (in order) in the create dialog */
  dialogInclude: string[]
}

/** Mirrors FIELD_VIEW_CONFIGS in create-field-views.ts for these four entities. */
const SPEC: Record<string, EntitySpec> = {
  service_request: {
    panelExclude: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'service_request_work_orders',
      'service_request_quotes',
    ],
    dialogInclude: [
      'service_request_title',
      'service_request_contact',
      'service_request_description',
      'service_request_property_type',
      'service_request_preferred_date',
      'service_request_alternate_date',
      'service_request_arrival_window',
      'service_request_address',
    ],
  },
  work_order: {
    panelExclude: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'work_order_pricing_model',
      'work_order_invoice_timing',
      'work_order_quote',
      'work_order_line_items',
      'work_order_invoices',
    ],
    dialogInclude: [
      'work_order_title',
      'work_order_contact',
      'work_order_priority',
      'work_order_job_type',
      'work_order_company',
      'work_order_address',
      'work_order_description',
    ],
  },
  quote: {
    panelExclude: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'quote_line_items',
      'quote_work_orders',
      'quote_discount_type',
      'quote_discount_value',
      'quote_tax_rate',
      'quote_subtotal',
      'quote_tax_total',
      'quote_total',
    ],
    dialogInclude: ['quote_title', 'quote_contact', 'quote_request'],
  },
  invoice: {
    panelExclude: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'invoice_line_items',
      'invoice_payments',
      'invoice_pdf_asset',
      'invoice_discount_type',
      'invoice_discount_value',
      'invoice_tax_rate',
      'invoice_subtotal',
      'invoice_tax_total',
      'invoice_total',
    ],
    dialogInclude: ['invoice_contact', 'invoice_work_order', 'invoice_due_date'],
  },
}

interface Cf {
  id: string
  systemAttribute: string
  sortOrder: string | null
}

function buildPanelConfig(defId: string, cfs: Cf[], exclude: string[]) {
  const excludeSet = new Set(exclude)
  const fieldVisibility: Record<string, boolean> = {}

  // Static audit fields (no CustomField row) — hide via <defId>:<staticKey>
  for (const attr of exclude) {
    if (STATIC_KEY[attr]) fieldVisibility[`${defId}:${STATIC_KEY[attr]}`] = false
  }

  const included = cfs
    .filter((c) => !excludeSet.has(c.systemAttribute))
    .sort((a, b) => (a.sortOrder ?? 'zz').localeCompare(b.sortOrder ?? 'zz'))

  for (const c of cfs) {
    fieldVisibility[`${defId}:${c.id}`] = !excludeSet.has(c.systemAttribute)
  }

  return {
    fieldOrder: included.map((c) => `${defId}:${c.id}`),
    fieldVisibility,
    showLabels: true,
  }
}

function buildDialogConfig(defId: string, cfs: Cf[], include: string[]) {
  const byAttr = new Map(cfs.map((c) => [c.systemAttribute, c]))
  const fieldVisibility: Record<string, boolean> = {}

  // Everything hidden by default, then flip the included ones on
  for (const c of cfs) fieldVisibility[`${defId}:${c.id}`] = false
  for (const attr of Object.keys(STATIC_KEY))
    fieldVisibility[`${defId}:${STATIC_KEY[attr]}`] = false

  const fieldOrder: string[] = []
  for (const attr of include) {
    const c = byAttr.get(attr)
    if (!c) continue
    fieldVisibility[`${defId}:${c.id}`] = true
    fieldOrder.push(`${defId}:${c.id}`)
  }

  return { fieldOrder, fieldVisibility, showLabels: true }
}

async function main() {
  const client = database.$client
  const orgs = await database.query.Organization.findMany({ columns: { id: true, name: true } })
  console.log(`Regenerating dispatch/money default views across ${orgs.length} org(s)…\n`)

  let totalViews = 0
  for (const org of orgs) {
    let orgViews = 0

    for (const [entityType, spec] of Object.entries(SPEC)) {
      const def = await client.query(
        `SELECT id FROM "EntityDefinition" WHERE "organizationId" = $1 AND "entityType" = $2 LIMIT 1`,
        [org.id, entityType]
      )
      const defId: string | undefined = def.rows[0]?.id
      if (!defId) continue

      const cfRes = await client.query(
        `SELECT id, "systemAttribute", "sortOrder" FROM "CustomField"
           WHERE "organizationId" = $1 AND "entityDefinitionId" = $2 AND "systemAttribute" IS NOT NULL`,
        [org.id, defId]
      )
      const cfs = cfRes.rows as Cf[]

      const panel = buildPanelConfig(defId, cfs, spec.panelExclude)
      const dialog = buildDialogConfig(defId, cfs, spec.dialogInclude)

      for (const [contextType, config] of [
        ['panel', panel],
        ['dialog_create', dialog],
      ] as const) {
        const upd = await client.query(
          `UPDATE "TableView" SET config = $1::jsonb, "updatedAt" = now()
             WHERE "organizationId" = $2 AND "tableId" = $3 AND "contextType" = $4
               AND "isDefault" = true AND "isShared" = true`,
          [JSON.stringify(config), org.id, defId, contextType]
        )
        orgViews += upd.rowCount ?? 0
      }
    }

    if (orgViews > 0) {
      await flushOrganization(org.id)
      // The view list is served from a PER-USER `userTableViews` cache (1-day TTL) that
      // flushOrganization does NOT touch — this event invalidates it for every org member.
      await onCacheEvent('table-view.updated', { orgId: org.id, broadcastUserKeys: true })
      totalViews += orgViews
      console.log(`  ✅ ${org.name ?? org.id}: ${orgViews} default view(s) rebuilt + cache flushed`)
    }
  }

  console.log(`\nDone. ${totalViews} TableView row(s) rebuilt.`)
  await client.end?.()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
