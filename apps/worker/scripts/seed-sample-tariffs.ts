// apps/worker/scripts/seed-sample-tariffs.ts
/**
 * Sample `tariff_code` + `tariff_rate` rows for DemoOrg1
 * (plans/money/tasks/29-tariff-schedule.md, plans/money/tasks/32-tariff-starter-catalogue.md §4).
 *
 * Dev fixture, not a seeder - it does not deduplicate against a prior run of
 * its OWN fixture rows below, because `(code, country)` is a natural key and a
 * second run is meant to be refused by it rather than silently merged. The
 * catalogue half, via `adoptTariffStarters`, IS idempotent - a second run
 * reports those six pairs `skipped` rather than erroring.
 *
 * Run (from repo root):
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/seed-sample-tariffs.ts
 *
 * What the set covers, and where each row comes from:
 *   - SIX pairs adopted from the tariff starter catalogue
 *     (`adoptTariffStarters`, the same writer the settings page's "Add from
 *     catalogue" dialog uses): one classification at TWO origins (CN and DE,
 *     the whole reason the key is `(code, country)` and not `code`), a
 *     three-layer China stack, a Vietnam alternative so a sourcing move has
 *     something to compare against, and an MX classification with no China
 *     action.
 *   - TWO fixtures the catalogue refuses BY DESIGN, kept hand-written through
 *     `UnifiedCrudHandler` exactly as before: a Section 232 derivative whose
 *     blended rate the schedule cannot express (task 29 §10), and a "lifted
 *     action" row - attached to one of the six catalogue codes AFTER adopting
 *     it, because an expiry is an explicit `0` row and the catalogue's own
 *     301-4A entry does not carry that step yet.
 *
 * ⚠️ The old fixture's `7318.15.8065` was never a real HTS line - it does not
 * appear in the generated catalogue. Replaced below with `7318.15.80.45`
 * (socket head cap screws, other), which does.
 */
import { database, schema } from '@auxx/database'
import { adoptTariffStarters } from '@auxx/lib/bom'
import { getOrgCache } from '@auxx/lib/cache'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

/** The six pairs adopted straight from the catalogue - `adoptTariffStarters` supplies
 *  the MFN rate, the Section 301 membership and the IEEPA/reciprocal history for each. */
const CATALOGUE_PAIRS = [
  { code: '8481.80.90.05', country: 'CN' },
  { code: '8481.80.90.05', country: 'DE' },
  { code: '7318.15.80.45', country: 'CN' },
  { code: '8544.42.90.90', country: 'MX' },
  { code: '8536.50.90.65', country: 'VN' },
  { code: '8501.10.40.60', country: 'CN' },
] as const

/** The lifted-action row belongs on this catalogue pair - see the file header. */
const LIFTED_ACTION_PAIR = { code: '8501.10.40.60', country: 'CN' } as const

/** `code, country, description, then the dated rate rows behind it` - hand-typed
 *  fixtures the catalogue refuses by design (task 32 §4). */
const HAND_WRITTEN_FIXTURES = [
  {
    code: '7326.90.86.88',
    country: 'CN',
    description: 'Fabricated steel articles, other - the 232 case',
    rates: [
      { authority: '', rate: 2.9, from: '1995-01-01', c99: '', note: '' },
      {
        authority: 'Section 232 steel derivative',
        rate: 25,
        from: '2025-03-12',
        c99: '9903.81.91',
        note: 'Blended - 232 applies to the STEEL CONTENT value, not the full customs value (brief section 10). This rate drifts as the metal share of the price moves.',
      },
    ],
  },
]

async function main() {
  // `createdById` is a real FK to User - a literal 'system' fails the constraint.
  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, ORG))
    .limit(1)
  if (!member) throw new Error(`No member found for org ${ORG}`)

  console.log(`Adopting ${CATALOGUE_PAIRS.length} pairs from the tariff starter catalogue...`)
  const adopted = await adoptTariffStarters(database, ORG, member.userId, {
    entries: [...CATALOGUE_PAIRS],
  })
  if (adopted.isErr()) throw adopted.error
  const { created, skipped, unknown } = adopted.value

  for (const c of created) {
    console.log(`+ ${c.code} ${c.country} (${c.rows} rows, tariff_code:${c.instanceId})`)
  }
  for (const s of skipped) {
    console.log(`= ${s.code} ${s.country} already adopted, left as-is`)
  }
  for (const u of unknown) {
    console.log(`! ${u.code} ${u.country} not found in the catalogue`)
  }
  if (unknown.length > 0) {
    throw new Error('One or more catalogue pairs above were not found - check the codes.')
  }

  const handler = new UnifiedCrudHandler(ORG, member.userId)

  // The lifted-action fixture attaches to a catalogue-adopted code, so its
  // instance id comes from THIS run's `created` list, or - on a re-run where
  // that pair was `skipped` - a lookup by `(code, country)`.
  const liftedActionCodeId = await resolveTariffCodeId(created, LIFTED_ACTION_PAIR)
  if (liftedActionCodeId) {
    console.log(
      `\n+ lifted-action fixture on ${LIFTED_ACTION_PAIR.code} ${LIFTED_ACTION_PAIR.country}`
    )
    await handler.create('tariff_rate', {
      tariff_rate_tariff_code: `tariff_code:${liftedActionCodeId}`,
      tariff_rate_rate: 0,
      tariff_rate_effective_from: '2026-01-01T00:00:00.000Z',
      tariff_rate_authority: 'Section 301 List 4A',
      tariff_rate_chapter99_code: '9903.88.15',
      tariff_rate_note: 'Lifted. Section 1.4 - an expiry is an explicit 0 row, never a deletion.',
    })
    console.log(
      `    ${'Section 301 List 4A'.padEnd(28)} ${'0'.padStart(5)}%  from 2026-01-01 (lifted)`
    )
  } else {
    console.log(
      `\n! Could not find a tariff_code for ${LIFTED_ACTION_PAIR.code} ${LIFTED_ACTION_PAIR.country} - skipped the lifted-action fixture.`
    )
  }

  console.log(`\nWriting ${HAND_WRITTEN_FIXTURES.length} hand-written fixture(s)...`)
  for (const s of HAND_WRITTEN_FIXTURES) {
    const createdCode = await handler.create('tariff_code', {
      tariff_code_code: s.code,
      tariff_code_country: s.country,
      tariff_code_description: s.description,
    })
    const codeRecordId = `tariff_code:${createdCode.instance.id}`
    console.log(`\n+ ${s.code} ${s.country}`)

    for (const r of s.rates) {
      await handler.create('tariff_rate', {
        tariff_rate_tariff_code: codeRecordId,
        tariff_rate_rate: r.rate,
        tariff_rate_effective_from: `${r.from}T00:00:00.000Z`,
        ...(r.authority ? { tariff_rate_authority: r.authority } : {}),
        ...(r.c99 ? { tariff_rate_chapter99_code: r.c99 } : {}),
        ...(r.note ? { tariff_rate_note: r.note } : {}),
      })
      console.log(
        `    ${(r.authority || 'Base rate').padEnd(28)} ${String(r.rate).padStart(5)}%  from ${r.from}`
      )
    }
  }

  process.exit(0)
}

/**
 * The `tariff_code` instance id for one adopted pair: from this run's
 * `created` list first, falling back to a direct `(code, country)` lookup -
 * mirroring `guardTariffCodeUniqueness`'s query shape - for a re-run where the
 * pair was already adopted (and therefore `skipped`, not `created`).
 */
async function resolveTariffCodeId(
  created: ReadonlyArray<{ code: string; country: string; instanceId: string }>,
  pair: { code: string; country: string }
): Promise<string | undefined> {
  const fromThisRun = created.find((c) => c.code === pair.code && c.country === pair.country)
  if (fromThisRun) return fromThisRun.instanceId

  const fields = await getOrgCache()
    .from(ORG, 'customFields')
    .bySystemAttributes(['tariff_code_code', 'tariff_code_country'] as const)
  const codeField = fields.tariff_code_code
  const countryField = fields.tariff_code_country
  if (!codeField || !countryField) return undefined

  const codeValue = alias(schema.FieldValue, 'lookup_tariff_code_code')
  const countryValue = alias(schema.FieldValue, 'lookup_tariff_code_country')

  const [row] = await database
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      codeValue,
      and(
        eq(codeValue.entityId, schema.EntityInstance.id),
        eq(codeValue.organizationId, ORG),
        eq(codeValue.fieldId, codeField.id),
        eq(codeValue.valueText, pair.code)
      )
    )
    .innerJoin(
      countryValue,
      and(
        eq(countryValue.entityId, schema.EntityInstance.id),
        eq(countryValue.organizationId, ORG),
        eq(countryValue.fieldId, countryField.id),
        eq(countryValue.optionId, pair.country)
      )
    )
    .where(eq(schema.EntityInstance.organizationId, ORG))
    .limit(1)
  return row?.id
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
