// packages/lib/src/data-migrations/migrations/088-phone-geo-backfill.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { lookupPhoneGeo } from '../../phone-geo'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-088')

/** Target systemAttribute → the `PhoneGeo` key that feeds it. Mirrors `derive-geo-hook.ts`. */
const GEO_ATTRIBUTES = [
  ['city', 'city'],
  ['region', 'region'],
  ['country', 'country'],
  ['timezone', 'timezone'],
] as const

/** Contacts pulled per round. Bounded so one org with a large book cannot balloon the heap. */
const BATCH_SIZE = 500

interface FieldIds {
  organizationId: string
  phoneFieldId: string
  targets: Array<{ attribute: (typeof GEO_ATTRIBUTES)[number][1]; fieldId: string }>
}

/**
 * Backfill contact city/region/country/timezone from the numbering-plan origin of each contact's
 * primary phone number.
 *
 * The `PHONE_INTL` field hook (`phone-geo/derive-geo-hook.ts`) covers every phone written from
 * now on; this catches everything already stored — most importantly the contacts auto-created by
 * SMS ingest, whose only content is a phone number.
 *
 * **Self-sufficient.** Reads and writes `FieldValue` directly and derives via the same
 * `lookupPhoneGeo` the hook uses; it does not depend on the hook having run, on the org cache
 * being warm, or on any field being newly seeded — the four target fields have existed since
 * entity migration 023.
 *
 * **Fill-only-if-blank, exactly like the hook.** A row is written only where the contact has no
 * value for that attribute, so chat's visitor-IP geo and anything a user typed both survive.
 * Number portability makes area-code geo the weakest of the three signals, and it must never
 * outrank them.
 *
 * **Writes are quiet.** Direct inserts fire no field hooks, no timeline entries and no realtime
 * publish — correct for a bulk derivation, which is not a user edit and should not read as a few
 * hundred thousand activity-feed rows.
 *
 * Idempotent: re-running only matches contacts that are still blank.
 */
export const migration088PhoneGeoBackfill: DataMigrationDef = {
  id: '088-phone-geo-backfill',
  description: 'Derive contact city/region/country/timezone from existing phone numbers',
  async run(db: Database): Promise<void> {
    // The five field ids per org, scoped to the CONTACT def. `systemAttribute = 'phone'` alone is
    // too broad — org-created `leads`/`vendors` defs use it too (see migration 086) — and those
    // defs have no city/region/country/timezone to fill anyway.
    const fieldRows = await db.execute<{
      organizationId: string
      systemAttribute: string
      fieldId: string
    }>(sql`
      SELECT cf."organizationId", cf."systemAttribute", cf."id" AS "fieldId"
      FROM "CustomField" cf
      JOIN "EntityDefinition" ed ON ed."id" = cf."entityDefinitionId"
      WHERE ed."entityType" = 'contact'
        AND cf."systemAttribute" IN ('phone', 'city', 'region', 'country', 'timezone')
    `)

    const byOrg = new Map<string, Map<string, string>>()
    for (const row of fieldRows.rows) {
      const existing = byOrg.get(row.organizationId) ?? new Map<string, string>()
      existing.set(row.systemAttribute, row.fieldId)
      byOrg.set(row.organizationId, existing)
    }

    const orgs: FieldIds[] = []
    for (const [organizationId, attributes] of byOrg) {
      const phoneFieldId = attributes.get('phone')
      if (!phoneFieldId) continue
      const targets = GEO_ATTRIBUTES.flatMap(([attribute]) => {
        const fieldId = attributes.get(attribute)
        return fieldId ? [{ attribute, fieldId }] : []
      })
      if (targets.length > 0) orgs.push({ organizationId, phoneFieldId, targets })
    }

    let contactsScanned = 0
    let valuesWritten = 0

    for (const org of orgs) {
      const targetFieldIds = org.targets.map((t) => t.fieldId)
      let cursor = ''

      for (;;) {
        // One row per contact: the primary phone is the lowest `sortKey` for that entity, which
        // is the same value outbound SMS/voice dials.
        const contacts = await db.execute<{
          entityId: string
          entityDefinitionId: string
          valueText: string
        }>(sql`
          SELECT DISTINCT ON (fv."entityId")
            fv."entityId", fv."entityDefinitionId", fv."valueText"
          FROM "FieldValue" fv
          WHERE fv."fieldId" = ${org.phoneFieldId}
            AND fv."valueText" IS NOT NULL
            AND fv."valueText" <> ''
            AND fv."entityId" > ${cursor}
          ORDER BY fv."entityId", fv."sortKey"
          LIMIT ${BATCH_SIZE}
        `)
        if (contacts.rows.length === 0) break

        const entityIds = contacts.rows.map((r) => r.entityId)
        cursor = entityIds[entityIds.length - 1] as string
        contactsScanned += entityIds.length

        // Which (contact, target field) pairs already hold a value — the blank test.
        const filled = await db.execute<{ entityId: string; fieldId: string }>(sql`
          SELECT DISTINCT fv."entityId", fv."fieldId"
          FROM "FieldValue" fv
          WHERE fv."fieldId" IN (${sql.join(
            targetFieldIds.map((id) => sql`${id}`),
            sql`, `
          )})
            AND fv."entityId" IN (${sql.join(
              entityIds.map((id) => sql`${id}`),
              sql`, `
            )})
            AND fv."valueText" IS NOT NULL
            AND fv."valueText" <> ''
        `)
        const filledKeys = new Set(filled.rows.map((r) => `${r.entityId}:${r.fieldId}`))

        const inserts: Array<typeof schema.FieldValue.$inferInsert> = []
        for (const contact of contacts.rows) {
          // No region argument: `valueText` is E.164 (`fieldValueSchemas.phone` normalizes on
          // write), which is self-describing. Any legacy national-format row resolves to `null`
          // rather than being guessed against US — the right outcome for a job whose entire
          // output is a claim about where a number is from.
          const geo = lookupPhoneGeo(contact.valueText)
          if (!geo) continue
          for (const target of org.targets) {
            const value = geo[target.attribute]
            if (!value) continue
            if (filledKeys.has(`${contact.entityId}:${target.fieldId}`)) continue
            inserts.push({
              organizationId: org.organizationId,
              fieldId: target.fieldId,
              entityId: contact.entityId,
              entityDefinitionId: contact.entityDefinitionId,
              valueText: value,
            })
          }
        }

        if (inserts.length > 0) {
          await db.insert(schema.FieldValue).values(inserts)
          valuesWritten += inserts.length
        }

        if (contacts.rows.length < BATCH_SIZE) break
      }
    }

    logger.info('phone geo backfill complete', {
      organizationsScanned: orgs.length,
      contactsScanned,
      valuesWritten,
    })
  },
}
