// packages/lib/scripts/probe-shipstation-fulfillments.ts
// Probe: GET /v2/fulfillments.
//
// Two open questions this settles:
//
//  1. ORDER LINKAGE. `order_source_id` is a documented filter on this endpoint, and a
//     "fulfillment" is the Shopify-side concept. If a fulfillment row carries an order id
//     or an order-source marker, it beats parsing `external_shipment_id` (which is the only
//     route found so far, and whose format is inferred rather than provider-stated).
//
//  2. DELTA CAPABILITY. Expansion plan §2 claims this endpoint "sorts by `modified_at`".
//     The documented query surface the owner pasted shows `sort_by=created_at` plus
//     `create_date_start` / `create_date_end` and `ship_date_start` / `ship_date_end`, with
//     no modified-date filter. If `modified_at` is not a legal sort, the plan's claim is
//     wrong and this endpoint has the same created-at-floor-only constraint that forced the
//     two-cursor design on labels. Both are probed explicitly below.
//
// Probed UNFILTERED: the pasted URL's placeholder values (`ship_to_name=string`) would
// return an empty set and prove nothing.
//
// Read-only. GET only.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { revealSecrets } from '@auxx/credentials/store'

const CREDENTIAL_ID = process.env.SS_CREDENTIAL_ID ?? 't3f9k1su4vwto30g2bi0qbpl'
const ORG_ID = process.env.SS_ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'
const PAGE_SIZE = Number(process.env.SS_PAGE_SIZE ?? 50)
const OUT = process.env.SS_OUT ?? 'plans/apps/shipstation/probe-2026-09-11-fulfillments-raw.json'

const BASE = 'https://api.shipstation.com'

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

async function get(apiKey: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'api-key': apiKey, accept: 'application/json' },
    redirect: 'error',
  })
  const text = await res.text()
  return { status: res.status, ok: res.ok, text }
}

async function main() {
  const revealed = await revealSecrets<Record<string, unknown>>(CREDENTIAL_ID, ORG_ID)
  if (revealed.isErr()) throw new Error(`credential read failed: ${revealed.error.code}`)
  const sec = revealed.value.secrets
  const apiKey = (sec.apiKey ?? sec.api_key ?? sec.secret ?? sec.token) as string | undefined
  if (!apiKey) throw new Error(`no apiKey in secrets; keys = ${Object.keys(sec)}`)

  // Q2 first, cheaply: is `modified_at` a legal sort_by, or only `created_at`?
  const sortProbes: Record<string, { status: number; body: string }> = {}
  for (const sortBy of ['created_at', 'modified_at', 'ship_date', 'not_a_field']) {
    const r = await get(apiKey, `/v2/fulfillments?page_size=1&sort_by=${sortBy}&sort_dir=desc`)
    sortProbes[sortBy] = { status: r.status, body: r.text.slice(0, 500) }
    console.log(
      `sort_by=${sortBy.padEnd(12)} -> ${r.status}  ${r.text.slice(0, 220).replace(/\s+/g, ' ')}`
    )
  }

  const main = await get(
    apiKey,
    `/v2/fulfillments?page_size=${PAGE_SIZE}&sort_by=created_at&sort_dir=desc`
  )
  console.log(`\nGET /v2/fulfillments (page_size=${PAGE_SIZE}) -> ${main.status}`)

  const parsed = main.ok ? JSON.parse(main.text) : null
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        sortProbes,
        status: main.status,
        result: parsed ?? main.text.slice(0, 2000),
      },
      null,
      2
    )
  )
  console.log(`written to ${OUT}`)

  if (!parsed) {
    console.log(`\nbody: ${main.text.slice(0, 600)}`)
    return
  }

  const body = parsed as Record<string, unknown>
  const rows = (body.fulfillments ?? []) as Record<string, unknown>[]
  console.log(`\nenvelope keys: ${Object.keys(body).join(', ')}`)
  console.log(`total: ${String(body.total)}   returned: ${rows.length}`)
  if (rows.length === 0) return

  const keys = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k)

  console.log('\n=== fulfillment field coverage ===')
  const cov = [...keys].map((k) => ({
    n: rows.filter((r) => nonEmpty(r[k])).length,
    k,
    ex: JSON.stringify(rows.find((r) => nonEmpty(r[k]))?.[k] ?? null).slice(0, 66),
  }))
  for (const c of cov.sort((a, b) => b.n - a.n || a.k.localeCompare(b.k))) {
    console.log(`${String(c.n).padStart(3)}/${rows.length}  ${c.k.padEnd(28)} ${c.ex}`)
  }

  console.log('\n=== first row, in full ===')
  console.log(JSON.stringify(rows[0], null, 2).slice(0, 2500))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
