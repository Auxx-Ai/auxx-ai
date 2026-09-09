// packages/lib/scripts/probe-shopify-tax.ts
//
// Read-only probe for plans/money/tasks/48-shopify-tax-data.md.
//
// Answers: what tax data does Shopify actually hand us, and does this store
// exercise it? The connector binds `order_tax_total` and nothing else, so the
// question is what is being left on the table.
//
// 🛑 Real customer orders under Protected Customer Data rules. Prints COUNTS,
// RATES, JURISDICTION TITLES and FLAGS only. `tax_exempt` is reported as a
// distribution, never against an identifiable customer.
//
// Usage: npx dotenv -- npx tsx packages/lib/scripts/probe-shopify-tax.ts

import { decryptSecrets } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'

const API = process.env.SHOPIFY_PROBE_API_VERSION || '2024-10'
const WANT_SHOP = process.env.SHOP || 'storage-system.myshopify.com'

type Blob = Record<string, any>

async function shopify(shop: string, token: string, path: string) {
  const res = await fetch(`https://${shop}/admin/api/${API}${path}`, {
    headers: { 'X-Shopify-Access-Token': token },
  })
  const text = await res.text()
  try {
    return { status: res.status, json: JSON.parse(text) }
  } catch {
    return { status: res.status, json: null as any, text: text.slice(0, 200) }
  }
}

/** Same three-way resolution the refunds probe uses. */
async function resolveToken(): Promise<{ shop: string; token: string } | null> {
  if (process.env.SHOPIFY_PROBE_TOKEN) {
    return { shop: WANT_SHOP, token: process.env.SHOPIFY_PROBE_TOKEN }
  }
  for (const row of await db.select().from(schema.Credential)) {
    let blob: Blob = {}
    try {
      blob = decryptSecrets(row.encryptedSecrets)
    } catch {
      continue
    }
    const md = (row.metadata ?? {}) as Blob
    const shop =
      md.shopDomain ||
      (md.connectionVariables?.shop ? `${md.connectionVariables.shop}.myshopify.com` : null) ||
      (blob.metadata?.connectionVariables?.shop
        ? `${blob.metadata.connectionVariables.shop}.myshopify.com`
        : null)
    const token = blob.accessToken || blob.access_token || blob.token
    if (shop === WANT_SHOP && token) return { shop, token }
  }
  return null
}

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1)
}

async function main() {
  const resolved = await resolveToken()
  if (!resolved) {
    console.log(`No usable credential for ${WANT_SHOP}.`)
    process.exit(1)
  }
  const { shop, token } = resolved

  const page = await shopify(shop, token, '/orders.json?status=any&limit=250')
  const orders: any[] = page.json?.orders ?? []
  console.log(`\n=== ${orders.length} orders in the readable window ===`)
  if (!orders.length) {
    console.log('  nothing to inspect')
    process.exit(0)
  }

  // 1. Does this store charge tax at all?
  const taxed = orders.filter((o) => Number(o.total_tax ?? 0) > 0)
  console.log(`\n=== 1. Tax incidence ===`)
  console.log(`  orders with total_tax > 0: ${taxed.length}/${orders.length}`)
  console.log(`  taxes_included=true: ${orders.filter((o) => o.taxes_included === true).length}`)

  // 2. tax_lines shape - the thing order_tax_name/order_tax_rate cannot hold.
  const titles = new Map<string, number>()
  const rates = new Map<string, number>()
  const perOrderCount = new Map<string, number>()
  let orderLevel = 0
  for (const o of orders) {
    const tl = o.tax_lines ?? []
    if (tl.length) orderLevel++
    bump(perOrderCount, String(tl.length))
    for (const t of tl) {
      bump(titles, String(t.title ?? '?'))
      bump(rates, String(t.rate ?? '?'))
    }
  }
  console.log(`\n=== 2. Order-level tax_lines (present on ${orderLevel}/${orders.length}) ===`)
  console.log('  lines per order:')
  for (const [k, v] of [...perOrderCount].sort()) console.log(`    ${k} line(s): ${v} orders`)
  console.log('  jurisdiction titles:')
  for (const [k, v] of [...titles].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ${k}: ${v}`)
  }
  console.log('  distinct rates:')
  for (const [k, v] of [...rates].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ${k}: ${v}`)
  }
  const sampleTl = orders.find((o) => (o.tax_lines ?? []).length)?.tax_lines?.[0]
  if (sampleTl) console.log(`  tax_line keys: [${Object.keys(sampleTl).sort().join(', ')}]`)

  // channel_liable: when true a marketplace facilitator remits, not the
  // merchant, so the line must NOT credit sales_tax_payable (48 section 3).
  const liable = new Map<string, number>()
  let liableAmount = 0
  let ownAmount = 0
  for (const o of orders) {
    for (const t of [
      ...(o.tax_lines ?? []),
      ...(o.line_items ?? []).flatMap((li: any) => li.tax_lines ?? []),
    ]) {
      bump(liable, String(t.channel_liable ?? 'absent'))
      if (t.channel_liable === true) liableAmount += Number(t.price ?? 0)
      else ownAmount += Number(t.price ?? 0)
    }
  }
  console.log('\n=== 2b. channel_liable (48 section 3) ===')
  for (const [k, v] of [...liable].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v} lines`)
  console.log(`  tax the CHANNEL remits: ${liableAmount.toFixed(2)}`)
  console.log(`  tax WE remit:           ${ownAmount.toFixed(2)}`)

  // 3. Per-line tax - what buildFulfillmentEntry's `taxMinor` would need.
  let linesWithTax = 0
  let linesTotal = 0
  let taxableTrue = 0
  const liTaxKeys = new Set<string>()
  for (const o of orders) {
    for (const li of o.line_items ?? []) {
      linesTotal++
      if (li.taxable === true) taxableTrue++
      const tl = li.tax_lines ?? []
      if (tl.length) {
        linesWithTax++
        for (const k of Object.keys(tl[0] ?? {})) liTaxKeys.add(k)
      }
    }
  }
  console.log(`\n=== 3. Per-line tax (buildFulfillmentEntry taxMinor) ===`)
  console.log(`  line items carrying tax_lines: ${linesWithTax}/${linesTotal}`)
  console.log(`  line items with taxable=true:  ${taxableTrue}/${linesTotal}`)
  console.log(`  line tax_line keys: [${[...liTaxKeys].sort().join(', ')}]`)

  // 4. Exemption - the dealer/resale case, which has no home in the repo.
  const exempt = new Map<string, number>()
  const reasons = new Map<string, number>()
  for (const o of orders) {
    const c = o.customer
    bump(exempt, c ? String(c.tax_exempt ?? 'absent') : 'no customer')
    for (const r of c?.tax_exemptions ?? []) bump(reasons, String(r))
  }
  console.log(`\n=== 4. Customer tax_exempt (counts only, no identifiers) ===`)
  for (const [k, v] of [...exempt].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
  if (reasons.size) {
    console.log('  tax_exemptions codes:')
    for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
  } else {
    console.log('  tax_exemptions: none present on any order')
  }

  // 5. Does the order-level total reconcile to the lines?
  let agree = 0
  let disagree = 0
  for (const o of orders) {
    const fromLines = (o.tax_lines ?? []).reduce((s: number, t: any) => s + Number(t.price ?? 0), 0)
    const total = Number(o.total_tax ?? 0)
    if (Math.abs(fromLines - total) < 0.005) agree++
    else disagree++
  }
  console.log(`\n=== 5. Does sum(tax_lines.price) equal total_tax? ===`)
  console.log(`  agree: ${agree}, disagree: ${disagree}`)

  process.exit(0)
}

main().catch((e) => {
  console.error('threw:', e?.message ?? e)
  process.exit(1)
})
