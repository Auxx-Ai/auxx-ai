// packages/lib/scripts/probe-shipstation-purchase-orders.ts
// Probe: List purchase orders.
//
// Expectation-setting: this account 404s on `/v2/sales_orders`, `/v2/sales_orders/stores`,
// `/v2/stores` and `/v1/stores` (expansion plan, live-testing section), so the inventory /
// purchasing suite may not be enabled here either. A 404 is a RESULT, not a failure, and is
// recorded as such rather than thrown.
//
// The expansion plan's decision 2 put this whole suite out of scope ("Auxx owns stock; two
// systems of record is not a trade worth making"). This probe is evidence gathering, not a
// reversal of that.
//
// Read-only. GET only.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { revealSecrets } from '@auxx/credentials/store'

const CREDENTIAL_ID = process.env.SS_CREDENTIAL_ID ?? 't3f9k1su4vwto30g2bi0qbpl'
const ORG_ID = process.env.SS_ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'
const PAGE_SIZE = Number(process.env.SS_PAGE_SIZE ?? 50)
const OUT = process.env.SS_OUT ?? 'plans/apps/shipstation/probe-2026-09-11-purchase-orders-raw.json'

/** Candidate paths, most likely first. The V2 spec names are not verified on this account. */
const CANDIDATES = [
  `/v2/purchase_orders?page_size=${PAGE_SIZE}`,
  `/v2/inventory/purchase_orders?page_size=${PAGE_SIZE}`,
  `/v2/purchase-orders?page_size=${PAGE_SIZE}`,
]

async function main() {
  const revealed = await revealSecrets<Record<string, unknown>>(CREDENTIAL_ID, ORG_ID)
  if (revealed.isErr()) throw new Error(`credential read failed: ${revealed.error.code}`)
  const sec = revealed.value.secrets
  const apiKey = (sec.apiKey ?? sec.api_key ?? sec.secret ?? sec.token) as string | undefined
  if (!apiKey) throw new Error(`no apiKey in secrets; keys = ${Object.keys(sec)}`)

  const attempts: { path: string; status: number; bodyPreview: string }[] = []
  let winner: { path: string; json: unknown } | null = null

  for (const path of CANDIDATES) {
    const res = await fetch(`https://api.shipstation.com${path}`, {
      headers: { 'api-key': apiKey, accept: 'application/json' },
      redirect: 'error',
    })
    const text = await res.text()
    attempts.push({ path, status: res.status, bodyPreview: text.slice(0, 400) })
    console.log(`GET ${path} -> ${res.status}`)
    if (res.ok) {
      winner = { path, json: JSON.parse(text) }
      break
    }
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      { probedAt: new Date().toISOString(), attempts, result: winner?.json ?? null },
      null,
      2
    )
  )
  console.log(`\nwritten to ${OUT}`)

  if (!winner) {
    console.log('\n=== NO PURCHASE ORDER ENDPOINT REACHABLE ON THIS ACCOUNT ===')
    for (const a of attempts) console.log(`  ${a.status}  ${a.path}\n       ${a.bodyPreview}\n`)
    return
  }

  const body = winner.json as Record<string, unknown>
  const rows = (body.purchase_orders ?? body.items ?? []) as Record<string, unknown>[]
  console.log(`\nendpoint: ${winner.path}`)
  console.log(`envelope keys: ${Object.keys(body).join(', ')}`)
  console.log(`rows returned: ${rows.length}`)
  if (rows[0]) console.log(`\nfirst row keys:\n  ${Object.keys(rows[0]).sort().join('\n  ')}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
