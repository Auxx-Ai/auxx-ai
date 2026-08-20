// packages/credentials/scripts/probe-shopify-live.ts
// Throwaway: find a usable Shopify credential and run the gap-0 verification calls (V1/V2/V5/V6/V7).

import { database as db, schema } from '@auxx/database'
import { decryptSecrets } from '../src/crypto'

const API = process.env.SHOPIFY_PROBE_API_VERSION || '2024-10'

type Blob = Record<string, any>

async function shopify(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/${API}${path}`
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text: text.slice(0, 400) }
}

async function main() {
  // Direct-token mode: skip credential discovery entirely.
  if (process.env.SHOPIFY_PROBE_TOKEN) {
    const shop = process.env.SHOP || 'auxxai.myshopify.com'
    await verify({
      id: 'env-token',
      shop,
      token: process.env.SHOPIFY_PROBE_TOKEN,
      expiresAt: null,
    })
    process.exit(0)
  }

  const rows = await db.select().from(schema.Credential)
  const shopifyRows = rows.filter((r) => /shopify/i.test(r.name ?? ''))

  console.log(`\n=== ${shopifyRows.length} shopify credential rows ===`)
  const candidates: { id: string; shop: string; token: string; expiresAt: Date | null }[] = []

  for (const row of shopifyRows) {
    let blob: Blob = {}
    try {
      blob = decryptSecrets(row.encryptedSecrets)
    } catch (e) {
      console.log(`  id=${row.id} DECRYPT FAILED: ${e}`)
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
    console.log(
      `  id=${row.id} org=${row.organizationId} shop=${shop ?? '?'} ` +
        `blobKeys=[${Object.keys(blob).join(',')}] ` +
        `hasToken=${!!token} tokenPrefix=${token ? String(token).slice(0, 6) : '-'} ` +
        `expiresAt=${row.expiresAt?.toISOString() ?? 'none'} scope=${md.scope ?? '?'}`
    )
    if (shop && token) candidates.push({ id: row.id, shop, token, expiresAt: row.expiresAt })
  }

  console.log(`\n=== probing ${candidates.length} candidates with GET /shop.json ===`)
  const live: typeof candidates = []
  for (const c of candidates) {
    const r = await shopify(c.shop, c.token, '/shop.json')
    console.log(
      `  ${c.id} ${c.shop} -> ${r.status} ${r.json?.shop?.name ?? JSON.stringify(r.json?.errors) ?? r.text.slice(0, 120)}`
    )
    if (r.status === 200) live.push(c)
  }

  if (!live.length) {
    console.log('\nNo live Shopify token. Stopping before verification calls.')
    process.exit(0)
  }

  for (const c of live) await verify(c)

  process.exit(0)
}

async function verify(c: { id: string; shop: string; token: string; expiresAt: Date | null }) {
  {
    console.log(`\n\n########## VERIFICATION on ${c.shop} (cred ${c.id}) ##########`)

    const scopes = await shopify(c.shop, c.token, '/oauth/access_scopes.json')
    console.log(
      `\n[scopes] ${scopes.status}: ${(scopes.json?.access_scopes ?? []).map((s: any) => s.handle).join(', ') || scopes.text}`
    )

    // V1 — oldest reachable order (the 60-day window question)
    const oldest = await shopify(
      c.shop,
      c.token,
      '/orders.json?status=any&limit=1&order=created_at+asc'
    )
    console.log(`\n[V1 oldest order] status=${oldest.status}`)
    if (oldest.json?.orders?.length) {
      const o = oldest.json.orders[0]
      console.log(
        `  oldest reachable: #${o.order_number} id=${o.id} created_at=${o.created_at} updated_at=${o.updated_at}`
      )
    } else {
      console.log(`  ${oldest.text}`)
    }

    const count = await shopify(c.shop, c.token, '/orders/count.json?status=any')
    console.log(`[V1 order count] status=${count.status} count=${count.json?.count ?? count.text}`)

    // V2 / V5 / V6 / V7 — one full page, no fields= param (exactly what the connector sends)
    const page = await shopify(c.shop, c.token, '/orders.json?status=any&limit=250')
    const orders: any[] = page.json?.orders ?? []
    console.log(`\n[page] status=${page.status} orders=${orders.length}`)
    if (!orders.length) {
      console.log(`  ${page.text}`)
      return
    }

    const withFul = orders.filter((o) => (o.fulfillments ?? []).length > 0)
    console.log(
      `\n[V2 fulfillments[]] orders with non-empty fulfillments[]: ${withFul.length}/${orders.length}`
    )
    const fulfilledStatus = orders.filter((o) => o.fulfillment_status === 'fulfilled')
    console.log(
      `  orders with fulfillment_status='fulfilled': ${fulfilledStatus.length}; of those, ${fulfilledStatus.filter((o) => (o.fulfillments ?? []).length > 0).length} carry a fulfillments[] array`
    )
    if (withFul.length) {
      const f = withFul[0].fulfillments[0]
      console.log(`  sample fulfillment keys: [${Object.keys(f).join(', ')}]`)
      console.log(
        `  sample: id=${f.id} name=${f.name} status=${f.status} shipment_status=${f.shipment_status} created_at=${f.created_at} tracking_number=${f.tracking_number} tracking_company=${f.tracking_company} location_id=${f.location_id}`
      )
      console.log(
        `  sample fulfillment.line_items[0] keys: [${Object.keys(f.line_items?.[0] ?? {}).join(', ')}]`
      )
    }

    // V5 — split shipments
    const multi = orders.filter(
      (o) => (o.fulfillments ?? []).filter((f: any) => f.status !== 'cancelled').length > 1
    )
    console.log(
      `\n[V5 split shipments] orders with >1 non-cancelled fulfillment: ${multi.length}/${orders.length}`
    )
    for (const o of multi.slice(0, 5)) {
      const dates = o.fulfillments.map((f: any) => `${f.status}@${f.created_at}`)
      console.log(`  #${o.order_number}: ${dates.join(' | ')}`)
    }

    // V6 — distinct payment_gateway_names
    const gwCounts = new Map<string, number>()
    let multiGw = 0
    for (const o of orders) {
      const g = o.payment_gateway_names ?? []
      if (g.length > 1) multiGw++
      for (const name of g) gwCounts.set(name, (gwCounts.get(name) ?? 0) + 1)
    }
    console.log(`\n[V6 payment_gateway_names] distinct handles across ${orders.length} orders:`)
    for (const [k, v] of [...gwCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
    console.log(`  orders with >1 gateway name: ${multiGw}`)
    console.log(
      `  orders where the field is absent/undefined: ${orders.filter((o) => o.payment_gateway_names === undefined).length}`
    )

    // §1.2 / V9 — tags shape, plus fulfillable_quantity presence
    const sample = orders[0]
    console.log(
      `\n[tags shape] typeof order.tags = ${typeof sample.tags}, value=${JSON.stringify(sample.tags)}`
    )
    console.log(`[line item keys] [${Object.keys(sample.line_items?.[0] ?? {}).join(', ')}]`)
    console.log(`[order top-level keys] [${Object.keys(sample).join(', ')}]`)

    // §4.3 — does creating a fulfillment bump order.updated_at?
    const bumped = withFul.filter((o) => {
      const last = o.fulfillments
        .map((f: any) => Date.parse(f.created_at))
        .sort((a: number, b: number) => a - b)
        .pop()
      return last && Date.parse(o.updated_at) >= last
    })
    console.log(
      `\n[4.3 updated_at >= last fulfillment created_at] ${bumped.length}/${withFul.length}`
    )

    // V7 — default sort of /orders.json (watermark correctness)
    const ups = orders.map((o) => Date.parse(o.updated_at))
    let asc = true
    let desc = true
    for (let i = 1; i < ups.length; i++) {
      if (ups[i] < ups[i - 1]) asc = false
      if (ups[i] > ups[i - 1]) desc = false
    }
    console.log(
      `[V7 default sort of /orders.json] updated_at ascending=${asc} descending=${desc} (n=${ups.length})`
    )
    const ids = orders.map((o) => Number(o.id))
    let idAsc = true
    let idDesc = true
    for (let i = 1; i < ids.length; i++) {
      if (ids[i] < ids[i - 1]) idAsc = false
      if (ids[i] > ids[i - 1]) idDesc = false
    }
    console.log(`  id ascending=${idAsc} descending=${idDesc}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
