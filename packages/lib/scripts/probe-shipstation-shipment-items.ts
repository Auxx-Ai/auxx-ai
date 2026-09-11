// packages/lib/scripts/probe-shipstation-shipment-items.ts
// Probe: does `shipments[].items[]` carry an order-linking key the LABEL stream lacks?
//
// The 2026-09-10 probe recorded the SHIPMENT's own `external_order_id` as null and the
// item's `external_order_item_id`, but never sampled the item's own `external_order_id`
// or `order_source_code`. Those two decide whether the Shopify order resolver can key on
// a provider-stated id + channel instead of parsing `external_shipment_id`.
//
// Read-only. GET /v2/shipments only.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { revealSecrets } from '@auxx/credentials/store'

const CREDENTIAL_ID = process.env.SS_CREDENTIAL_ID ?? 't3f9k1su4vwto30g2bi0qbpl'
const ORG_ID = process.env.SS_ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'
const PAGE_SIZE = Number(process.env.SS_PAGE_SIZE ?? 50)
const OUT = process.env.SS_OUT ?? 'probe-shipments-raw.json'

interface ShipmentItem {
  sales_order_id?: string | null
  sales_order_item_id?: string | null
  external_order_id?: string | null
  external_order_item_id?: string | null
  order_source_code?: string | null
  item_id?: string | null
  sku?: string | null
  quantity?: number | null
}

interface Shipment {
  shipment_id: string
  shipment_number?: string | null
  store_id?: string | null
  external_shipment_id?: string | null
  external_order_id?: string | null
  shipment_status?: string | null
  items?: ShipmentItem[]
}

async function main() {
  const revealed = await revealSecrets<Record<string, unknown>>(CREDENTIAL_ID, ORG_ID)
  if (revealed.isErr()) throw new Error(`credential read failed: ${revealed.error.code}`)
  const s = revealed.value.secrets
  const apiKey = (s.apiKey ?? s.api_key ?? s.secret ?? s.token) as string | undefined
  if (!apiKey) throw new Error(`no apiKey in secrets; keys = ${Object.keys(s)}`)

  const url = `https://api.shipstation.com/v2/shipments?page_size=${PAGE_SIZE}&sort_by=modified_at&sort_dir=desc`
  const res = await fetch(url, {
    headers: { 'api-key': apiKey, accept: 'application/json' },
    redirect: 'error',
  })
  if (!res.ok) throw new Error(`GET /v2/shipments -> ${res.status} ${await res.text()}`)

  const raw = await res.text()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(JSON.parse(raw), null, 2))
  console.log(`raw response written to ${OUT} (${raw.length} bytes)`)

  const body = JSON.parse(raw) as { shipments?: Shipment[]; total?: number }
  const shipments = body.shipments ?? []
  console.log(`\ntotal reported: ${body.total}   returned: ${shipments.length}\n`)

  // Coverage across the page, per field, at BOTH levels.
  const tally = {
    shipments: shipments.length,
    withItems: 0,
    items: 0,
    shipment_external_order_id: 0,
    shipment_external_shipment_id: 0,
    item_external_order_id: 0,
    item_external_order_item_id: 0,
    item_sales_order_id: 0,
    item_order_source_code: 0,
    item_item_id: 0,
  }
  const sourceCodes = new Map<string, number>()
  const samples: string[] = []

  for (const s of shipments) {
    if (s.external_order_id) tally.shipment_external_order_id += 1
    if (s.external_shipment_id) tally.shipment_external_shipment_id += 1
    const items = s.items ?? []
    if (items.length > 0) tally.withItems += 1
    for (const it of items) {
      tally.items += 1
      if (it.external_order_id) tally.item_external_order_id += 1
      if (it.external_order_item_id) tally.item_external_order_item_id += 1
      if (it.sales_order_id) tally.item_sales_order_id += 1
      if (it.item_id) tally.item_item_id += 1
      if (it.order_source_code) {
        tally.item_order_source_code += 1
        sourceCodes.set(it.order_source_code, (sourceCodes.get(it.order_source_code) ?? 0) + 1)
      }
    }
    if (samples.length < 6 && items[0]) {
      const it = items[0]
      samples.push(
        [
          `  shipment ${s.shipment_id}  number=${s.shipment_number ?? 'null'}`,
          `    external_shipment_id : ${s.external_shipment_id ?? 'null'}`,
          `    shipment.external_order_id : ${s.external_order_id ?? 'null'}`,
          `    item.external_order_id     : ${it.external_order_id ?? 'null'}`,
          `    item.external_order_item_id: ${it.external_order_item_id ?? 'null'}`,
          `    item.sales_order_id        : ${it.sales_order_id ?? 'null'}`,
          `    item.order_source_code     : ${it.order_source_code ?? 'null'}`,
          `    item.item_id               : ${it.item_id ?? 'null'}  sku=${it.sku ?? 'null'}`,
        ].join('\n')
      )
    }
  }

  console.log('=== coverage ===')
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(32)} ${v}`)

  console.log('\n=== order_source_code values ===')
  if (sourceCodes.size === 0) console.log('  (none returned)')
  for (const [code, n] of sourceCodes) console.log(`  ${code}: ${n}`)

  console.log('\n=== samples ===')
  console.log(samples.join('\n\n'))

  // THE question: does item.external_order_id equal the first component of
  // external_shipment_id? If so the resolver can read a provider-stated id instead of
  // splitting a string whose format is merchant-specific.
  let agree = 0
  let disagree = 0
  let untestable = 0
  for (const s of shipments) {
    const first = (s.external_shipment_id ?? '').split('-')[0]
    const itemOrderId = (s.items ?? []).find((i) => i.external_order_id)?.external_order_id
    if (!first || !itemOrderId) {
      untestable += 1
      continue
    }
    if (first === itemOrderId) agree += 1
    else {
      disagree += 1
      if (disagree <= 3) console.log(`\n  DISAGREE ${s.shipment_id}: ${first} vs ${itemOrderId}`)
    }
  }
  console.log(
    `\n=== external_shipment_id[0] vs item.external_order_id ===\n  agree=${agree} disagree=${disagree} untestable=${untestable}`
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
