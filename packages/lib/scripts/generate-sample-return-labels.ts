// packages/lib/scripts/generate-sample-return-labels.ts
//
// DEV-ONLY. Generates a set of sample return-label images for driving the
// return-intake wizard (plans/money/tasks/57-return-intake-wizard.md §10 step 7),
// which has never been run against a real photograph.
//
//   npx dotenv -- npx tsx packages/lib/scripts/generate-sample-return-labels.ts
//   npx dotenv -- npx tsx packages/lib/scripts/generate-sample-return-labels.ts --out ~/Desktop/labels
//
// Read-only against the database. Writes only image files.
//
// ── Why it reads the database instead of inventing names ─────────────────────
//
// 🔑 A label carrying a made-up name tests the UPLOAD and the TRANSCRIBER and
// nothing else: the ladder returns no candidates for it, so every label lands in
// the unidentified path and §4.2, §4.5, §5.1 and §5.2 are never exercised. The
// only labels worth generating are ones bearing a REAL contact of the target
// org, because the tier that actually fires today is `name_place` — normalized
// last+first name narrowed by city/region/country.
//
// 🛑 The two address tiers cannot be exercised at all yet, by anybody:
// `order_shipping_address` is empty product-wide until the `extractValue` fix
// (§0.4/§0.5) reaches a re-sync. ⚠️ And these files will NOT become address-tier
// fixtures for free when it does: the street and ZIP here are invented, because
// we store neither, so they cannot match whatever Shopify eventually delivers.
// Testing tier 1 means regenerating from the real shipping addresses once they
// exist.
//
// ── The matrix ───────────────────────────────────────────────────────────────
//
// Eight files, chosen so that uploading ALL of them in one go exercises every
// branch the review screen has, in one drive:
//
//   01, 02   one contact, TWO parcels      -> one group, two tracking numbers (§5.1)
//   03       same contact, different order -> a SECOND group (§5.2)
//   04       a contact with several orders -> order picker, nothing preselected (§4.5)
//   05       a contact with one order      -> that order preselected (§4.5)
//   06       a name no contact has         -> no candidates, unidentified (§4.6)
//   07       an OUTBOUND label             -> the §4.7 warning, never a refusal
//   08       an illegible photograph       -> legible:false, manual entry (§3.2)
//
// ⚠️ 06's name is deliberately absurd rather than merely uncommon. A plausible
// name risks a real `name` tier hit on a 14,000-contact org, which would make
// the "no match" case silently stop testing what it says it tests.

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { database, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import sharp from 'sharp'

/** The org to pull real contacts from. The main dev org unless overridden. */
const DEFAULT_ORG = 'abgwpa1l81reht2zmwrcihfu'

/** Where the files land unless `--out` says otherwise. */
const DEFAULT_OUT = 'tmp/sample-return-labels'

interface SampleContact {
  contactId: string
  firstName: string | null
  lastName: string
  city: string
  region: string | null
  country: string | null
  shippedOrders: number
}

interface LabelSpec {
  file: string
  what: string
  senderName: string
  street1: string
  cityLine: string
  country: string
  carrier: string
  tracking: string
  /** Who it is addressed TO. Our own warehouse, except for the outbound case. */
  recipientName: string
  recipientLines: string[]
  /** Render it as a bad photograph. */
  illegible?: boolean
}

/** Our own warehouse block, i.e. where a real return would be going. */
const US = {
  name: 'Auxx-Lift Returns',
  lines: ['4400 Industrial Pkwy', 'Dock 3', 'Cleveland OH 44135', 'United States'],
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}

/**
 * Real contacts of the org, with how many of their orders have shipped.
 *
 * Ordered so the caller can take a many-order contact and a one-order contact
 * off opposite ends of the same list. `city` and `lastName` are required: they
 * are the whole `name_place` key, and a contact missing either cannot be
 * matched by any tier that works today.
 */
async function loadContacts(organizationId: string): Promise<SampleContact[]> {
  const attrs = ['first_name', 'last_name', 'city', 'region', 'country'] as const
  const fields = await database
    .select({ id: schema.CustomField.id, attr: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, [...attrs])
      )
    )
  const byAttr = new Map(fields.map((f) => [f.attr, f.id]))
  const pick = (attr: string) => byAttr.get(attr) ?? '__missing__'

  const orderContact = await database
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'order_contact')
      )
    )
    .limit(1)

  const fulfilmentStatus = await database
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'order_fulfillment_status')
      )
    )
    .limit(1)

  const rows = await database.execute(sql`
    with fv as (
      select "entityId", "fieldId", "valueText" from "FieldValue"
      where "organizationId" = ${organizationId}
        and "fieldId" in (${sql.join(
          [...attrs].map((a) => sql`${pick(a)}`),
          sql`, `
        )})
    ),
    shipped as (
      select oc."relatedEntityId" as contact_id, count(*) as n
      from "FieldValue" oc
      join "FieldValue" st
        on st."entityId" = oc."entityId"
       and st."fieldId" = ${fulfilmentStatus[0]?.id ?? '__missing__'}
       and st."optionId" in ('fulfilled', 'partial')
      where oc."fieldId" = ${orderContact[0]?.id ?? '__missing__'}
      group by 1
    )
    select fv."entityId" as contact_id,
      max(case when fv."fieldId" = ${pick('first_name')} then fv."valueText" end) as first_name,
      max(case when fv."fieldId" = ${pick('last_name')}  then fv."valueText" end) as last_name,
      max(case when fv."fieldId" = ${pick('city')}       then fv."valueText" end) as city,
      max(case when fv."fieldId" = ${pick('region')}     then fv."valueText" end) as region,
      max(case when fv."fieldId" = ${pick('country')}    then fv."valueText" end) as country,
      coalesce(max(shipped.n), 0) as shipped_orders
    from fv
    left join shipped on shipped.contact_id = fv."entityId"
    group by fv."entityId"
    having max(case when fv."fieldId" = ${pick('last_name')} then fv."valueText" end) is not null
       and max(case when fv."fieldId" = ${pick('city')}      then fv."valueText" end) is not null
       and coalesce(max(shipped.n), 0) > 0
    -- 🛑 Order by the BAND each contact can test, not by order count.
    --
    -- "order by shipped_orders desc limit 200" looks reasonable and is wrong:
    -- on the dev org the top 200 are all high-count rows, so not one of the
    -- 9,498 contacts with exactly ONE shipped order survives the limit and the
    -- matrix can never be covered. Both bands have to be inside the window.
    order by case
      when coalesce(max(shipped.n), 0) between 3 and 6 then 0
      when coalesce(max(shipped.n), 0) = 1 then 1
      else 2
    end, fv."entityId"
    limit 400
  `)

  // ⚠️ `database.execute` returns the driver's result object, not an array, and
  // WHICH shape depends on the driver: node-postgres puts them on `.rows`,
  // postgres.js returns an array-like directly. Normalize rather than guess.
  const raw = rows as unknown as { rows?: unknown[] } | unknown[]
  const list: unknown[] = Array.isArray(raw) ? raw : (raw.rows ?? [])

  return (list as Record<string, unknown>[]).map((r) => ({
    contactId: String(r.contact_id),
    firstName: (r.first_name as string) ?? null,
    lastName: String(r.last_name),
    city: String(r.city),
    region: (r.region as string) ?? null,
    country: (r.country as string) ?? null,
    shippedOrders: Number(r.shipped_orders ?? 0),
  }))
}

/** A plausible US street line. Invented — we do not store one to copy. */
function street(seed: number): string {
  const names = ['Maple Ave', 'Oak St', 'Lincoln Rd', 'Birch Ln', 'Franklin St', 'Cedar Ct']
  return `${100 + ((seed * 37) % 8900)} ${names[seed % names.length]}`
}

function tracking(seed: number): string {
  return `1Z${String(seed).padStart(3, '0')}W8${String((seed * 7919) % 100000000).padStart(8, '0')}`
}

function cityLine(c: SampleContact): string {
  const zip = String(10000 + ((c.city.length * 7919) % 89999))
  return [c.city, c.region, zip].filter(Boolean).join(' ')
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch] as string
  )
}

/**
 * A 4x6 shipping label as SVG.
 *
 * ⚠️ Generic font families only (`sans-serif`, `monospace`). An external font
 * URL is silently dropped by the SVG rasterizer and the text renders in a
 * fallback or not at all — the same trap that has bitten SVG rendering here
 * before. Nothing is fetched.
 */
function labelSvg(spec: LabelSpec): string {
  const W = 1200
  const H = 1800
  const bars = Array.from({ length: 60 }, (_, i) => {
    const x = 90 + i * 17
    const w = (i * 7919) % 3 === 0 ? 10 : 4
    return `<rect x="${x}" y="1440" width="${w}" height="150" fill="#000"/>`
  }).join('')

  const senderLines = [spec.street1, spec.cityLine, spec.country].filter(Boolean)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="#000" stroke-width="4"/>

  <text x="70" y="120" font-family="sans-serif" font-size="64" font-weight="bold">${escapeXml(spec.carrier)}</text>
  <text x="${W - 70}" y="120" text-anchor="end" font-family="sans-serif" font-size="40">GROUND</text>
  <line x1="30" y1="160" x2="${W - 30}" y2="160" stroke="#000" stroke-width="3"/>

  <text x="70" y="230" font-family="sans-serif" font-size="30" fill="#555">FROM:</text>
  <text x="70" y="290" font-family="sans-serif" font-size="52" font-weight="bold">${escapeXml(spec.senderName)}</text>
  ${senderLines
    .map(
      (l, i) =>
        `<text x="70" y="${350 + i * 52}" font-family="sans-serif" font-size="44">${escapeXml(l)}</text>`
    )
    .join('\n  ')}

  <line x1="30" y1="${360 + senderLines.length * 52}" x2="${W - 30}" y2="${360 + senderLines.length * 52}" stroke="#000" stroke-width="3"/>

  <text x="70" y="${430 + senderLines.length * 52}" font-family="sans-serif" font-size="30" fill="#555">TO:</text>
  <text x="70" y="${495 + senderLines.length * 52}" font-family="sans-serif" font-size="58" font-weight="bold">${escapeXml(spec.recipientName)}</text>
  ${spec.recipientLines
    .map(
      (l, i) =>
        `<text x="70" y="${560 + senderLines.length * 52 + i * 54}" font-family="sans-serif" font-size="48">${escapeXml(l)}</text>`
    )
    .join('\n  ')}

  <line x1="30" y1="1380" x2="${W - 30}" y2="1380" stroke="#000" stroke-width="3"/>
  ${bars}
  <text x="${W / 2}" y="1680" text-anchor="middle" font-family="monospace" font-size="52" letter-spacing="4">${escapeXml(spec.tracking)}</text>
  <text x="${W / 2}" y="1740" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#555">RETURN LABEL</text>
</svg>`
}

/**
 * Render one label as a JPEG that looks like it was PHOTOGRAPHED, not exported.
 *
 * 🔑 The realism is the point, not decoration. A crisp 1200x1800 render is an
 * easier read than anything a warehouse will ever produce, so a pipeline that
 * only ever sees clean renders reports a confidence it has not earned. Every
 * sample gets a slight rotation, a soft blur and lossy JPEG; the illegible one
 * gets enough of each to genuinely defeat a reader, which is what makes
 * `legible: false` mean something.
 */
async function render(spec: LabelSpec, outDir: string): Promise<string> {
  const svg = Buffer.from(labelSvg(spec))

  // 🛑 RESOLUTION FIRST, then blur — and this order is the whole trick.
  //
  // The first version of the illegible case rendered at density 200 (a
  // ~3800px-wide image) and applied `.blur(7)`. The result was PERFECTLY
  // readable: seven pixels of blur against 150px-tall glyphs is nothing. A
  // fixture that claims to test `legible: false` and is in fact a clean read is
  // worse than no fixture, because the case it names silently stops being
  // tested.
  //
  // A real unreadable dock photo is not a big sharp image with blur added. It is
  // LOW RESOLUTION to begin with — a distant, badly lit phone grab — so the blur
  // has to be applied at the size the glyphs actually are. Rendering small and
  // then blurring destroys the text the way the real failure does.
  const pipeline = spec.illegible
    ? sharp(svg, { density: 34 })
        .rotate(7, { background: '#b9b4ac' })
        .blur(3.2)
        .modulate({ brightness: 0.7, saturation: 0.8 })
        .linear(0.55, 40) // crush contrast, the way a flash-lit glossy label does
        .jpeg({ quality: 18 })
    : sharp(svg, { density: 200 })
        .rotate(1.5, { background: '#e8e6e1' })
        .blur(0.6)
        .modulate({ brightness: 0.97 })
        .jpeg({ quality: 74 })

  const path = resolve(outDir, spec.file)
  await writeFile(path, await pipeline.toBuffer())
  return path
}

async function main(): Promise<void> {
  const organizationId = arg('org', DEFAULT_ORG)
  const outDir = resolve(process.cwd(), arg('out', DEFAULT_OUT))
  await mkdir(outDir, { recursive: true })

  const contacts = await loadContacts(organizationId)
  if (contacts.length < 3) {
    console.error(
      `Only ${contacts.length} usable contacts on org ${organizationId}. ` +
        'A usable contact needs a last name, a city and at least one shipped order.'
    )
    process.exit(1)
  }

  // 🛑 Pick by the branch each contact exercises, never by "most orders".
  //
  // An early version took `contacts[0]` after ordering by order count desc and
  // landed on a contact with 341 shipped orders — a catch-all row, not a
  // customer, whose order picker no human could use. Measured on the dev org:
  // 9,498 contacts have exactly ONE shipped order and 28 have four, so both
  // branches are abundant and there is no reason to accept an outlier.
  const multi = contacts.find((c) => c.shippedOrders >= 3 && c.shippedOrders <= 6)
  const single = contacts.find((c) => c.shippedOrders === 1)
  const many = contacts.find(
    (c) => c.contactId !== multi?.contactId && c.contactId !== single?.contactId
  )

  // ⚠️ Refuse rather than mislabel. An earlier version fell back to any contact
  // and kept the caption "expect the order PRESELECTED", which made file 05 a
  // lie about what it was testing — the worst possible defect in a fixture.
  if (!multi || !single || !many) {
    console.error(
      `Org ${organizationId} cannot cover the matrix: ` +
        `${multi ? '' : 'no contact with 3-6 shipped orders; '}` +
        `${single ? '' : 'no contact with exactly 1 shipped order; '}` +
        `${many ? '' : 'no third distinct contact; '}` +
        'pick a different org with --org.'
    )
    process.exit(1)
  }
  const other = multi

  const nameOf = (c: SampleContact) => [c.firstName, c.lastName].filter(Boolean).join(' ')

  const specs: LabelSpec[] = [
    // 01 + 02: one customer, two parcels -> ONE group, two tracking numbers.
    ...[1, 2].map((n) => ({
      file: `0${n}-${many.lastName.toLowerCase()}-parcel-${n}.jpg`,
      what: `${nameOf(many)} (${many.city}) parcel ${n} of 2 — expect ONE group with 2 tracking numbers`,
      senderName: nameOf(many),
      street1: street(n),
      cityLine: cityLine(many),
      country: many.country ?? 'United States',
      carrier: 'UPS',
      tracking: tracking(100 + n),
      recipientName: US.name,
      recipientLines: US.lines,
    })),
    // 03: same customer again — a THIRD parcel, so the group grows rather than splits.
    {
      file: `03-${many.lastName.toLowerCase()}-parcel-3.jpg`,
      what: `${nameOf(many)} parcel 3 — still the same group unless a different order is picked (§5.2)`,
      senderName: nameOf(many),
      street1: street(3),
      cityLine: cityLine(many),
      country: many.country ?? 'United States',
      carrier: 'UPS',
      tracking: tracking(103),
      recipientName: US.name,
      recipientLines: US.lines,
    },
    // 04: a customer with several shipped orders -> picker, nothing preselected.
    {
      file: `04-${other.lastName.toLowerCase()}-multi-order.jpg`,
      what: `${nameOf(other)} (${other.city}), ${other.shippedOrders} shipped orders — expect an order PICKER, nothing preselected`,
      senderName: nameOf(other),
      street1: street(4),
      cityLine: cityLine(other),
      country: other.country ?? 'United States',
      carrier: 'FEDEX',
      tracking: tracking(204),
      recipientName: US.name,
      recipientLines: US.lines,
    },
    // 05: a customer with exactly one -> that order preselected, still changeable.
    {
      file: `05-${single.lastName.toLowerCase()}-single-order.jpg`,
      what: `${nameOf(single)} (${single.city}), ${single.shippedOrders} shipped order(s) — expect the order PRESELECTED`,
      senderName: nameOf(single),
      street1: street(5),
      cityLine: cityLine(single),
      country: single.country ?? 'United States',
      carrier: 'USPS',
      tracking: tracking(305),
      recipientName: US.name,
      recipientLines: US.lines,
    },
    // 06: nobody. The unannounced pallet, ~15% of real returns.
    {
      file: '06-unknown-sender.jpg',
      what: 'A sender no contact matches — expect NO candidates and the unidentified path (§4.6)',
      senderName: 'Quorbis Thrangwill',
      street1: '77 Nowhere Loop',
      cityLine: 'Vexbury Montana 59001',
      country: 'United States',
      carrier: 'FEDEX',
      tracking: tracking(406),
      recipientName: US.name,
      recipientLines: US.lines,
    },
    // 07: an outbound label photographed by mistake — the §4.7 warning.
    {
      file: '07-outbound-by-mistake.jpg',
      what: 'An OUTBOUND label: we are the sender — expect the §4.7 warning, and NOT a refusal',
      senderName: US.name,
      street1: US.lines[0] as string,
      cityLine: US.lines[2] as string,
      country: 'United States',
      carrier: 'UPS',
      tracking: tracking(507),
      recipientName: nameOf(other),
      recipientLines: [street(8), cityLine(other), other.country ?? 'United States'],
    },
    // 08: a genuinely unreadable photograph.
    {
      file: '08-illegible.jpg',
      what: 'A badly photographed label — expect legible:false and the manual-entry panel (§3.2)',
      senderName: nameOf(single),
      street1: street(9),
      cityLine: cityLine(single),
      country: single.country ?? 'United States',
      carrier: 'UPS',
      tracking: tracking(608),
      recipientName: US.name,
      recipientLines: US.lines,
      illegible: true,
    },
  ]

  console.log(`\nOrg ${organizationId} — ${contacts.length} usable contacts.\n`)
  for (const spec of specs) {
    const path = await render(spec, outDir)
    console.log(`  ${spec.file}`)
    console.log(`      ${spec.what}`)
    console.log(`      sender: ${spec.senderName} · ${spec.street1} · ${spec.cityLine}`)
    console.log(`      -> ${path}\n`)
  }

  console.log(`Done. ${specs.length} labels in ${outDir}`)
  console.log(
    '\nUpload all eight at once: that is the only way to exercise grouping (§5), and the\n' +
      'review screen should report FOUR or more returns from eight labels, not eight.\n' +
      '\n🛑 The two address tiers will not fire — order_shipping_address is empty until the\n' +
      'extractValue fix reaches a re-sync. Every hit you see today is the name+city tier.\n'
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
