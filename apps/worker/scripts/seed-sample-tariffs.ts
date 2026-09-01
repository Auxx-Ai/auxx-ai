// apps/worker/scripts/seed-sample-tariffs.ts
/**
 * Sample `tariff_code` + `tariff_rate` rows for DemoOrg1
 * (plans/money/tasks/29-tariff-schedule.md).
 *
 * Dev fixture, not a seeder - it APPENDS every time it runs and does not
 * deduplicate, because `(code, country)` is a natural key and a second run is
 * meant to be refused by it rather than silently merged.
 *
 * Run (from repo root):
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/seed-sample-tariffs.ts
 *
 * What the set covers, deliberately:
 *   - one classification at TWO origins (CN and DE), which is the whole reason
 *     the key is `(code, country)` and not `code`
 *   - a three-layer China stack that sums to 47%
 *   - a Section 232 derivative, whose blended rate is WRONG by construction
 *   - an action that was lifted, recorded as an explicit `0` row (section 1.4)
 *   - a Vietnam alternative, so a sourcing move has something to compare against
 */
import { database, schema } from '@auxx/database'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { and, eq } from 'drizzle-orm'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

/** code, country, description, then the dated rate rows behind it. */
const SAMPLES = [
  {
    code: '8481.80.9005',
    country: 'CN',
    description: 'Hand-operated valves of steel, other',
    rates: [
      { authority: '', rate: 2, from: '1995-01-01', c99: '', note: 'HTSUS general rate, Column 1' },
      {
        authority: 'Section 301 List 3',
        rate: 25,
        from: '2019-05-10',
        c99: '9903.88.03',
        note: '84 FR 20459',
      },
      { authority: 'IEEPA fentanyl', rate: 20, from: '2025-03-04', c99: '9903.01.24', note: '' },
    ],
  },
  {
    code: '8481.80.9005',
    country: 'DE',
    description: 'Hand-operated valves of steel, other',
    rates: [
      {
        authority: '',
        rate: 2,
        from: '1995-01-01',
        c99: '',
        note: 'Same classification, no China actions',
      },
    ],
  },
  {
    code: '7318.15.8065',
    country: 'CN',
    description: 'Socket head cap screws, steel',
    rates: [
      { authority: '', rate: 8.5, from: '1995-01-01', c99: '', note: '' },
      {
        authority: 'Section 301 List 1',
        rate: 25,
        from: '2018-07-06',
        c99: '9903.88.01',
        note: '',
      },
    ],
  },
  {
    code: '7326.90.8688',
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
  {
    code: '8544.42.9090',
    country: 'MX',
    description: 'Insulated wire harness with connectors',
    rates: [
      {
        authority: '',
        rate: 2.6,
        from: '1995-01-01',
        c99: '',
        note: 'USMCA preference not modelled - brief section 10',
      },
    ],
  },
  {
    code: '8536.50.9065',
    country: 'VN',
    description: 'Switches, other - the sourcing-move alternative',
    rates: [
      {
        authority: '',
        rate: 2.7,
        from: '1995-01-01',
        c99: '',
        note: 'No China action. This is what moving origin buys you.',
      },
    ],
  },
  {
    code: '8501.10.4060',
    country: 'CN',
    description: 'DC motors under 18.65 W - an action that was LIFTED',
    rates: [
      { authority: '', rate: 4.4, from: '1995-01-01', c99: '', note: '' },
      {
        authority: 'Section 301 List 4A',
        rate: 15,
        from: '2019-09-01',
        c99: '9903.88.15',
        note: '',
      },
      {
        authority: 'Section 301 List 4A',
        rate: 7.5,
        from: '2020-02-14',
        c99: '9903.88.15',
        note: 'Phase One agreement halved it',
      },
      {
        authority: 'Section 301 List 4A',
        rate: 0,
        from: '2026-01-01',
        c99: '9903.88.15',
        note: 'Lifted. Section 1.4 - an expiry is an explicit 0 row, never a deletion.',
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
  const handler = new UnifiedCrudHandler(ORG, member.userId)

  const existing = await database
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, ORG),
        eq(schema.EntityDefinition.entityType, 'tariff_code')
      )
    )
  console.log(`existing tariff_code rows: ${existing.length}`)

  for (const s of SAMPLES) {
    const created = await handler.create('tariff_code', {
      tariff_code_code: s.code,
      tariff_code_country: s.country,
      tariff_code_description: s.description,
    })
    const codeRecordId = `tariff_code:${created.instance.id}`
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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
