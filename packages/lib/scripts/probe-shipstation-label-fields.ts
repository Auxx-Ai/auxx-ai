// packages/lib/scripts/probe-shipstation-label-fields.ts
// Probe: which money / document fields does a LABEL actually populate?
//
// The shipments probe (probe-2026-09-11-shipments-raw.json) showed `amount_paid`,
// `shipping_paid` and `tax_paid` present on every shipment but all ZERO, and
// `retail_rate` null on all 50. So the cost the merchant actually paid is not on the
// shipment. This checks the label, which is where `shipment_cost` / `insurance_cost` /
// `label_download` are documented to live.
//
// Read-only. GET /v2/labels only.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { revealSecrets } from '@auxx/credentials/store'

const CREDENTIAL_ID = process.env.SS_CREDENTIAL_ID ?? 't3f9k1su4vwto30g2bi0qbpl'
const ORG_ID = process.env.SS_ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'
const PAGE_SIZE = Number(process.env.SS_PAGE_SIZE ?? 50)
const OUT = process.env.SS_OUT ?? 'probe-labels-raw.json'

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

async function main() {
  const revealed = await revealSecrets<Record<string, unknown>>(CREDENTIAL_ID, ORG_ID)
  if (revealed.isErr()) throw new Error(`credential read failed: ${revealed.error.code}`)
  const sec = revealed.value.secrets
  const apiKey = (sec.apiKey ?? sec.api_key ?? sec.secret ?? sec.token) as string | undefined
  if (!apiKey) throw new Error(`no apiKey in secrets; keys = ${Object.keys(sec)}`)

  const url = `https://api.shipstation.com/v2/labels?page_size=${PAGE_SIZE}&sort_by=created_at&sort_dir=desc`
  const res = await fetch(url, {
    headers: { 'api-key': apiKey, accept: 'application/json' },
    redirect: 'error',
  })
  if (!res.ok) throw new Error(`GET /v2/labels -> ${res.status} ${await res.text()}`)

  const raw = await res.text()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(JSON.parse(raw), null, 2))
  console.log(`raw response written to ${OUT} (${raw.length} bytes)\n`)

  const body = JSON.parse(raw) as { labels?: Record<string, unknown>[]; total?: number }
  const labels = body.labels ?? []
  console.log(`total reported: ${body.total}   returned: ${labels.length}\n`)

  const keys = new Set<string>()
  for (const l of labels) for (const k of Object.keys(l)) keys.add(k)

  console.log('=== label field coverage ===')
  const rows = [...keys].map((k) => {
    const n = labels.filter((l) => nonEmpty(l[k])).length
    const ex = labels.find((l) => nonEmpty(l[k]))?.[k]
    return { n, k, ex: JSON.stringify(ex ?? null)?.slice(0, 70) ?? '' }
  })
  for (const r of rows.sort((a, b) => b.n - a.n || a.k.localeCompare(b.k))) {
    console.log(`${String(r.n).padStart(3)}/${labels.length}  ${r.k.padEnd(30)} ${r.ex}`)
  }

  // The money + document question, spelled out.
  console.log('\n=== the fields asked about ===')
  for (const k of [
    'shipment_cost',
    'insurance_cost',
    'requested_comparison_amount',
    'insurance_claim',
    'label_download',
    'form_download',
    'paperless_download',
    'display_scheme',
    'charge_event',
  ]) {
    const n = labels.filter((l) => nonEmpty(l[k])).length
    const ex = labels.find((l) => nonEmpty(l[k]))?.[k]
    console.log(
      `  ${k.padEnd(30)} ${String(n).padStart(3)}/${labels.length}  ${JSON.stringify(ex ?? null)}`
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
