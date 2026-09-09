// packages/lib/scripts/probe-shopify-refunds.ts
//
// Read-only probe for plans/money/tasks/47-shopify-refunds.md §3 and §0.3.
//
// Answers two questions the brief cannot be built without:
//   1. Is the order history we hold complete, or did the backfill stop early?
//      (`backfillComplete: false` with `phase: 'steady'` on the order stream)
//   2. What does a real `refunds[]` payload actually contain - which legs are
//      present, and is `restock_type` populated?
//
// 🛑 These are REAL customer orders under Shopify's Protected Customer Data
// rules. This script prints SHAPES, COUNTS, IDS, AMOUNTS and DATES only. Every
// field that can carry personal data is dropped by `safeKeys`, and no payload is
// ever dumped wholesale. Do not "temporarily" print a raw order.
//
// Usage:
//   npx dotenv -- npx tsx packages/lib/scripts/probe-shopify-refunds.ts
//   SHOP=storage-system.myshopify.com npx dotenv -- npx tsx ...
//   SHOPIFY_PROBE_TOKEN=shpat_... SHOP=... npx dotenv -- npx tsx ...   (skip DB lookup)

import { decryptSecrets } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'

const API = process.env.SHOPIFY_PROBE_API_VERSION || '2024-10'
const WANT_SHOP = process.env.SHOP || 'storage-system.myshopify.com'

type Blob = Record<string, any>

/** Personal-data keys that must never reach stdout, at any nesting level. */
const PII = new Set([
  'customer',
  'email',
  'contact_email',
  'phone',
  'billing_address',
  'shipping_address',
  'name',
  'first_name',
  'last_name',
  'address1',
  'address2',
  'client_details',
  'browser_ip',
  'note',
  'note_attributes',
  'payment_details',
  'customer_locale',
  'landing_site',
  'referring_site',
  'checkout_token',
  'token',
  'cart_token',
])

/** Key names only, PII stripped - the whole point of this script. */
function safeKeys(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return []
  return Object.keys(obj as Blob)
    .filter((k) => !PII.has(k))
    .sort()
}

async function shopify(shop: string, token: string, path: string) {
  const res = await fetch(`https://${shop}/admin/api/${API}${path}`, {
    headers: { 'X-Shopify-Access-Token': token },
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text: text.slice(0, 300) }
}

async function resolveToken(): Promise<{ shop: string; token: string } | null> {
  if (process.env.SHOPIFY_PROBE_TOKEN) {
    return { shop: WANT_SHOP, token: process.env.SHOPIFY_PROBE_TOKEN }
  }
  const rows = await db.select().from(schema.Credential)
  for (const row of rows) {
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
    if (shop === WANT_SHOP && token) {
      console.log(`credential ${row.id} org=${row.organizationId} shop=${shop}`)
      return { shop, token }
    }
  }
  return null
}

/** §0.3: is the order history we hold complete, or did the crawl stop early? */
async function coverage(shop: string, token: string) {
  console.log('\n=== 1. Coverage (task 47 section 0.3) ===')

  const total = await shopify(shop, token, '/orders/count.json?status=any')
  console.log(`  total orders at Shopify (status=any): ${total.json?.count ?? total.text}`)

  const oldest = await shopify(
    shop,
    token,
    '/orders.json?status=any&limit=1&order=created_at+asc&fields=id,order_number,created_at'
  )
  const o = oldest.json?.orders?.[0]
  console.log(
    o
      ? `  oldest reachable order: #${o.order_number} created_at=${o.created_at}`
      : `  oldest: ${oldest.text}`
  )
  console.log('  auxx holds 542 orders spanning 2026-07-06 to 2026-09-04.')
  console.log('  If the oldest above predates 2026-07-06, the backfill stopped early.')
}

/** §3: what is actually inside `refunds[]`. */
async function refundShape(shop: string, token: string) {
  console.log('\n=== 2. Refund volume ===')
  for (const status of ['refunded', 'partially_refunded', 'voided']) {
    const c = await shopify(shop, token, `/orders/count.json?status=any&financial_status=${status}`)
    console.log(`  financial_status=${status}: ${c.json?.count ?? c.text}`)
  }

  // Pull refunded orders directly rather than crawling everything.
  const withRefunds: any[] = []
  for (const status of ['refunded', 'partially_refunded']) {
    const page = await shopify(
      shop,
      token,
      `/orders.json?status=any&financial_status=${status}&limit=250`
    )
    for (const order of page.json?.orders ?? []) {
      if ((order.refunds ?? []).length > 0) withRefunds.push(order)
    }
  }

  console.log(`\n=== 3. Refund payload shape (${withRefunds.length} orders carrying refunds) ===`)
  if (!withRefunds.length) {
    console.log('  none returned - nothing further to inspect')
    return
  }

  const dates = withRefunds
    .flatMap((o) => (o.refunds ?? []).map((r: any) => r.created_at))
    .filter(Boolean)
    .sort()
  console.log(`  refund dates span ${dates[0]} to ${dates[dates.length - 1]}`)

  const refundKeys = new Set<string>()
  const lineKeys = new Set<string>()
  const txnKeys = new Set<string>()
  const adjKeys = new Set<string>()
  const restock = new Map<string, number>()
  const txnKind = new Map<string, number>()
  const adjKind = new Map<string, number>()
  let refunds = 0
  let withLines = 0
  let withTxns = 0
  let withAdjs = 0

  for (const order of withRefunds) {
    for (const r of order.refunds ?? []) {
      refunds++
      for (const k of safeKeys(r)) refundKeys.add(k)

      const lines = r.refund_line_items ?? []
      if (lines.length) withLines++
      for (const li of lines) {
        for (const k of safeKeys(li)) lineKeys.add(k)
        const rt = String(li.restock_type ?? 'ABSENT')
        restock.set(rt, (restock.get(rt) ?? 0) + 1)
      }

      const txns = r.transactions ?? []
      if (txns.length) withTxns++
      for (const t of txns) {
        for (const k of safeKeys(t)) txnKeys.add(k)
        const kind = `${t.kind ?? '?'}/${t.status ?? '?'}/${t.gateway ?? '?'}`
        txnKind.set(kind, (txnKind.get(kind) ?? 0) + 1)
      }

      const adjs = r.order_adjustments ?? []
      if (adjs.length) withAdjs++
      for (const a of adjs) {
        for (const k of safeKeys(a)) adjKeys.add(k)
        const kind = String(a.kind ?? '?')
        adjKind.set(kind, (adjKind.get(kind) ?? 0) + 1)
      }
    }
  }

  console.log(`\n  ${refunds} refund objects total`)
  console.log(`  refund keys: [${[...refundKeys].join(', ')}]`)

  console.log(`\n  -- leg 1: refund_line_items (present on ${withLines}/${refunds} refunds) --`)
  console.log(`  keys: [${[...lineKeys].join(', ')}]`)
  console.log('  restock_type distribution (G16 "disposition"):')
  for (const [k, v] of [...restock].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)

  console.log(`\n  -- leg 2: transactions (present on ${withTxns}/${refunds} refunds) --`)
  console.log(`  keys: [${[...txnKeys].join(', ')}]`)
  for (const [k, v] of [...txnKind].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)

  console.log(`\n  -- leg 3: order_adjustments (present on ${withAdjs}/${refunds} refunds) --`)
  console.log(`  keys: [${[...adjKeys].join(', ')}]`)
  for (const [k, v] of [...adjKind].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)

  // §4: the money-scaling trap. Confirm these are decimal strings, not minor units.
  console.log('\n=== 4. Money shape (task 47 section 4) ===')
  const first = withRefunds[0].refunds[0]
  const li = first.refund_line_items?.[0]
  const tx = first.transactions?.[0]
  const adj = first.order_adjustments?.[0]
  console.log(
    `  refund_line_items[0].subtotal = ${JSON.stringify(li?.subtotal)} (${typeof li?.subtotal})`
  )
  console.log(`  refund_line_items[0].total_tax = ${JSON.stringify(li?.total_tax)}`)
  console.log(`  transactions[0].amount = ${JSON.stringify(tx?.amount)} (${typeof tx?.amount})`)
  console.log(`  order_adjustments[0].amount = ${JSON.stringify(adj?.amount)}`)
  console.log('  Strings => must go through decimalToMinorUnits when bound (37 section 2.4).')

  // How often do the legs disagree - the case that kills a lines-only model.
  let goodsNoMoney = 0
  let moneyNoGoods = 0
  for (const order of withRefunds) {
    for (const r of order.refunds ?? []) {
      const hasLines = (r.refund_line_items ?? []).length > 0
      const money = (r.transactions ?? []).some((t: any) => Number(t.amount) > 0)
      if (hasLines && !money) goodsNoMoney++
      if (!hasLines && money) moneyNoGoods++
    }
  }
  console.log('\n=== 5. Do the legs disagree? (task 47 section 3) ===')
  console.log(`  goods returned, no money back (store credit): ${goodsNoMoney}`)
  console.log(`  money back, no goods (shipping/goodwill):     ${moneyNoGoods}`)

  // MK's hypothesis: most refunds are goodwill concessions ("$100 off for an
  // angry customer"), not returns. If true, the dominant leg is an ADJUSTMENT
  // and the inventory leg is rare - which decides v1's scope.
  console.log('\n=== 6. Concession or return? ===')
  const reasons = new Map<string, number>()
  const amounts: number[] = []
  let adjTaxed = 0
  let adjUntaxed = 0
  for (const order of withRefunds) {
    for (const r of order.refunds ?? []) {
      for (const a of r.order_adjustments ?? []) {
        const reason = a.reason ? String(a.reason) : '(empty)'
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
        const amt = Math.abs(Number(a.amount ?? 0))
        if (amt > 0) amounts.push(amt)
        if (Math.abs(Number(a.tax_amount ?? 0)) > 0) adjTaxed++
        else adjUntaxed++
      }
    }
  }
  console.log('  order_adjustments[].reason:')
  for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
  console.log(
    `  adjustments carrying a non-zero tax_amount: ${adjTaxed}, zero/absent: ${adjUntaxed}`
  )

  amounts.sort((a, b) => a - b)
  const round = amounts.filter((a) => a % 50 === 0).length
  console.log(`\n  adjustment amounts (n=${amounts.length}):`)
  console.log(
    `    min=${amounts[0]} median=${amounts[Math.floor(amounts.length / 2)]} max=${amounts[amounts.length - 1]}`
  )
  console.log(`    exact multiples of 50 (concession-shaped): ${round}/${amounts.length}`)
  console.log(`    all: ${amounts.join(', ')}`)

  // A concession refunds money against an order whose goods were kept, so the
  // refund total is a fraction of the order total. A return is closer to 1.0.
  console.log('\n  refunded fraction of order total:')
  for (const order of withRefunds) {
    const total = Number(order.total_price ?? 0)
    const refunded = (order.refunds ?? []).reduce(
      (sum: number, r: any) =>
        sum + (r.transactions ?? []).reduce((t: number, x: any) => t + Number(x.amount ?? 0), 0),
      0
    )
    if (total > 0) {
      const lines = (order.refunds ?? []).reduce(
        (n: number, r: any) => n + (r.refund_line_items ?? []).length,
        0
      )
      console.log(
        `    #${order.order_number}: refunded ${refunded.toFixed(2)} of ${total.toFixed(2)} ` +
          `(${((refunded / total) * 100).toFixed(0)}%), ${lines} line item(s), status=${order.financial_status}`
      )
    }
  }

  // §6.2: does Shopify hand back the tax it charged, per refunded line? auxx
  // does no tax arithmetic, so the refund's tax leg exists only if this is
  // populated. Scans EVERY line item — §4 above samples refunds[0], which on
  // this store carries no lines at all and reads `undefined` for a sampling
  // reason, not an absence one.
  console.log('\n=== 7. Per-line tax, transcribable? (task 47 section 6.2) ===')
  let lineCount = 0
  let taxPresent = 0
  let taxNonZero = 0
  const taxValues: string[] = []
  for (const order of withRefunds) {
    for (const r of order.refunds ?? []) {
      for (const li of r.refund_line_items ?? []) {
        lineCount++
        const raw = li.total_tax
        if (raw !== undefined && raw !== null) {
          taxPresent++
          taxValues.push(`${JSON.stringify(raw)} (${typeof raw})`)
          if (Math.abs(Number(raw)) > 0) taxNonZero++
        }
        const set = li.total_tax_set?.shop_money?.amount
        if (set !== undefined)
          taxValues.push(`  total_tax_set.shop_money.amount=${JSON.stringify(set)}`)
      }
    }
  }
  console.log(`  refund line items: ${lineCount}`)
  console.log(`  carrying total_tax at all: ${taxPresent}`)
  console.log(`  carrying a NON-ZERO total_tax: ${taxNonZero}`)
  console.log(`  values: ${taxValues.join(', ') || '(none)'}`)
  console.log(
    '  Non-zero => the tax leg is transcribable. All-zero => Shopify says these\n' +
      '  lines carried no tax, and transcribing correctly reverses nothing.'
  )
}

async function main() {
  const resolved = await resolveToken()
  if (!resolved) {
    console.log(`No usable credential for ${WANT_SHOP}. Pass SHOPIFY_PROBE_TOKEN to override.`)
    process.exit(1)
  }
  const { shop, token } = resolved

  const live = await shopify(shop, token, '/shop.json')
  console.log(`\nGET /shop.json -> ${live.status}`)
  if (live.status !== 200) {
    console.log(`  ${live.text}`)
    process.exit(1)
  }

  const scopes = await shopify(shop, token, '/oauth/access_scopes.json')
  console.log(
    `granted scopes: ${(scopes.json?.access_scopes ?? []).map((s: any) => s.handle).join(', ')}`
  )

  await coverage(shop, token)
  await refundShape(shop, token)
  process.exit(0)
}

main().catch((e) => {
  console.error('threw:', e?.message ?? e)
  process.exit(1)
})
