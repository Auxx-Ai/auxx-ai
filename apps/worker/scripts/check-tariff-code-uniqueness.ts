// apps/worker/scripts/check-tariff-code-uniqueness.ts
/**
 * Proves `guardTariffCodeUniqueness` refuses a duplicate `(code, country)`
 * (plans/money/tasks/29-tariff-schedule.md section 12 d).
 *
 * Run (from repo root):
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/check-tariff-code-uniqueness.ts
 */
import { database, schema } from '@auxx/database'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { eq } from 'drizzle-orm'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

async function main() {
  // The hook registry self-initializes on first read (`ensureInitialized`), so the
  // create path below registers the guard on its own.
  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, ORG))
    .limit(1)
  const handler = new UnifiedCrudHandler(ORG, member!.userId)

  const cases = [
    {
      label: 'duplicate of an existing code',
      code: '8481.80.9005',
      country: 'CN',
      expect: 'refused',
    },
    {
      label: 'same code, different origin',
      code: '8481.80.9005',
      country: 'JP',
      expect: 'allowed',
    },
  ]

  const created: string[] = []
  for (const c of cases) {
    try {
      const r = await handler.create('tariff_code', {
        tariff_code_code: c.code,
        tariff_code_country: c.country,
        tariff_code_description: 'uniqueness probe',
      })
      created.push(r.instance.id)
      const fv = await database
        .select({ t: schema.FieldValue.valueText, o: schema.FieldValue.optionId })
        .from(schema.FieldValue)
        .where(eq(schema.FieldValue.entityId, r.instance.id))
      const code = fv.find((x) => x.t?.startsWith('84'))?.t ?? 'MISSING'
      const country = fv.find((x) => x.o)?.o ?? 'MISSING'
      console.log(
        `${c.expect === 'allowed' ? 'PASS' : 'FAIL'}  ${c.label}: created code=${code} country=${country}`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`${c.expect === 'refused' ? 'PASS' : 'FAIL'}  ${c.label}: refused - ${msg}`)
    }
  }

  for (const id of created) {
    await database.delete(schema.EntityInstance).where(eq(schema.EntityInstance.id, id))
    console.log(`cleaned up ${id}`)
  }
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
