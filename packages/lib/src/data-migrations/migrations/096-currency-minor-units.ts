// packages/lib/src/data-migrations/migrations/096-currency-minor-units.ts
//
// 🛑 The "a fractional value proves the data is still in major units" heuristic
// below (~line 145) predates rate precision (`plans/money/tasks/31-sub-cent-rates.md`)
// and must not be reused: a rate field can legitimately hold a fractional minor unit.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { DisplayFieldService } from '../../field-values/display-field-service'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-096')

/**
 * Bring CURRENCY values onto one convention — integer minor units — and give
 * `FieldValue.valueJson` a single unambiguous shape.
 * (`plans/currency/06-per-value-metadata.md`, `07-value-implementation-steps.md`)
 *
 * FOUR ORDERED STEPS, one migration because they are one change and the order
 * between them matters:
 *
 *   1. Wrap json-typed values into the `{ v, meta }` envelope.
 *   2. Re-home the AI metadata bag under `meta.ai`.
 *   3. Rescale Shopify-owned CURRENCY values from decimal dollars to minor units.
 *   4. Recompute persisted display values for CURRENCY display fields.
 *
 * Step 4 MUST follow step 3: recompute first and the Shopify rows get rendered
 * from data still in dollars, needing a second pass.
 *
 * Every step is individually idempotent, so re-running the whole migration is a
 * no-op rather than a double-application. That is load-bearing, not incidental:
 * a combined migration has one ledger id, so a partial failure re-runs the
 * steps that already succeeded.
 *
 * Raw Drizzle on purpose — data migrations do not use the `ensure*` entity
 * helpers.
 */
export const migration096CurrencyMinorUnits: DataMigrationDef = {
  id: '096-currency-minor-units',
  description:
    'Wrap valueJson in the { v, meta } envelope, re-home AI metadata, rescale Shopify currency to minor units, recompute currency display values',
  async run(db: Database): Promise<void> {
    // ───────────────────────────────────────────────────────────────────────
    // Step 1 — wrap json-typed values into the envelope
    //
    // `valueJson` had two owners and no discriminator: the VALUE for json-typed
    // fields, and the AI metadata bag for any type carrying `aiStatus`. That was
    // safe only because no AI-eligible field type writes its own value there — a
    // coincidence of the type roster, not an invariant, and `applyAiMarker`
    // replaced the whole column.
    //
    // 🛑 Five raw-SQL readers resolve the value out of `valueJson` (search-text's
    // NAME/ADDRESS key lists, FILE remove, the thumbnail callback, the uniqueness
    // check, json filters). A root read on an enveloped row — or an envelope read
    // on a root-shaped one — returns NULL rather than raising. Those are the only
    // failures in this change that are both silent and typecheck-clean.
    // ───────────────────────────────────────────────────────────────────────

    // The two owners must be disjoint: a row that is both json-typed AND
    // AI-marked would be wrapped as a value by step 1 and as metadata by step 2,
    // destroying one of them. That disjointness is exactly the coincidence the
    // envelope exists to stop relying on, so assert it rather than assume it.
    const overlap = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM "FieldValue" fv
      JOIN "CustomField" cf ON cf."id" = fv."fieldId"
      WHERE fv."valueJson" IS NOT NULL
        AND fv."aiStatus" IS NOT NULL
        AND cf."type" IN ('FILE', 'NAME', 'ADDRESS_STRUCT', 'JSON')
    `)
    const overlapCount = overlap.rows[0]?.count ?? 0
    if (overlapCount > 0) {
      throw new Error(
        `[096] ${overlapCount} FieldValue row(s) are BOTH json-typed and AI-marked. ` +
          'The value and the AI bag are sharing one column with no discriminator, so ' +
          'neither step can wrap them without destroying one of them. ' +
          'Resolve these rows by hand before re-running.'
      )
    }

    // Skips rows already carrying `v`/`meta`, so a re-run cannot double-wrap
    // into `{ v: { v: … } }`.
    const wrapped = await db.execute<{ id: string }>(sql`
      UPDATE "FieldValue" fv
      SET "valueJson" = jsonb_build_object('v', fv."valueJson")
      FROM "CustomField" cf
      WHERE cf."id" = fv."fieldId"
        AND fv."valueJson" IS NOT NULL
        AND cf."type" IN ('FILE', 'NAME', 'ADDRESS_STRUCT', 'JSON')
        AND NOT (fv."valueJson" ? 'v' OR fv."valueJson" ? 'meta')
      RETURNING fv."id"
    `)

    // ───────────────────────────────────────────────────────────────────────
    // Step 2 — re-home the AI metadata bag under `meta.ai`
    //
    // Scoped by `aiStatus IS NOT NULL`, which is precisely what `readAiMetadata`
    // gates on: a row with no `aiStatus` never had its `valueJson` read as an AI
    // bag, so there is nothing to move.
    // ───────────────────────────────────────────────────────────────────────
    const rehomed = await db.execute<{ id: string }>(sql`
      UPDATE "FieldValue"
      SET "valueJson" = jsonb_build_object('meta', jsonb_build_object('ai', "valueJson"))
      WHERE "aiStatus" IS NOT NULL
        AND "valueJson" IS NOT NULL
        AND NOT ("valueJson" ? 'v' OR "valueJson" ? 'meta')
      RETURNING "id"
    `)

    // ───────────────────────────────────────────────────────────────────────
    // Step 3 — rescale Shopify CURRENCY values to minor units
    //
    // Shopify reports money as a decimal string ("49.99"). The connector's
    // `ConnectorFieldDecl` is a JSON path with no transform channel, so the
    // projection passed those through untouched and they landed in `valueNumber`
    // as dollars — in a column every other reader treats as minor units.
    //
    // Scope is the DEF, not `managedByConnectorId`: that column is NULL on every
    // one of these rows, so it does not identify connector-written data.
    //
    // 🛑 The app-side fix (`decimalToMinorUnits` in the auxxai-apps Shopify
    // connector) must be deployed in the same window. The connector write path is
    // a DELETE+INSERT replace, so a sync from the old app re-writes dollars over
    // the rescaled values.
    // ───────────────────────────────────────────────────────────────────────
    const scope = sql`
      fv."valueNumber" IS NOT NULL
      AND cf."type" = 'CURRENCY'
      AND ed."apiSlug" LIKE 'shopify\\_%'
    `

    const survey = await db.execute<{ total: number; fractional: number }>(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE fv."valueNumber" <> trunc(fv."valueNumber"))::int AS fractional
      FROM "FieldValue" fv
      JOIN "CustomField" cf ON cf."id" = fv."fieldId"
      JOIN "EntityDefinition" ed ON ed."id" = cf."entityDefinitionId"
      WHERE ${scope}
    `)
    const total = survey.rows[0]?.total ?? 0
    const fractional = survey.rows[0]?.fractional ?? 0

    let rescaled = 0
    if (total === 0) {
      logger.info('No Shopify CURRENCY values in scope — nothing to rescale')
    } else if (fractional === 0) {
      // A fractional value is definitive evidence the data is still in major
      // units — minor units are integers for every ISO currency. With none, this
      // cannot distinguish "already converted" from "a store whose prices happen
      // to be round", so it refuses instead of risking a 100x over-scale.
      logger.warn(
        'Every Shopify CURRENCY value in scope is already a whole number — REFUSING to rescale. ' +
          'Expected on a re-run; otherwise verify by hand.',
        { total }
      )
    } else {
      const result = await db.execute<{ id: string }>(sql`
        UPDATE "FieldValue" fv
        SET "valueNumber" = round(fv."valueNumber" * 100)
        FROM "CustomField" cf, "EntityDefinition" ed
        WHERE cf."id" = fv."fieldId"
          AND ed."id" = cf."entityDefinitionId"
          AND ${scope}
        RETURNING fv."id"
      `)
      rescaled = result.rows.length
    }

    // ───────────────────────────────────────────────────────────────────────
    // Step 4 — recompute persisted CURRENCY display values
    //
    // `currencyConverter.toDisplayValue` used to do `Math.round(num * 100)`
    // before handing the value to `formatCurrency`, which divides by 100 — the
    // two cancel, so it rendered stored minor units as if they were major units.
    // `display-field-service` writes that string into a real column, so the
    // 100x-high text is DENORMALIZED INTO THE DATABASE and does not self-heal
    // when the converter is fixed.
    //
    // Idempotent by construction: rewrites each column from the current field
    // values rather than transforming the stored text.
    // ───────────────────────────────────────────────────────────────────────
    const targets = await db.execute<{
      organizationId: string
      entityDefinitionId: string
      isPrimary: boolean
      isSecondary: boolean
    }>(sql`
      SELECT
        ed."organizationId"                            AS "organizationId",
        ed."id"                                        AS "entityDefinitionId",
        bool_or(cf."id" = ed."primaryDisplayFieldId")   AS "isPrimary",
        bool_or(cf."id" = ed."secondaryDisplayFieldId") AS "isSecondary"
      FROM "EntityDefinition" ed
      JOIN "CustomField" cf
        ON cf."id" IN (ed."primaryDisplayFieldId", ed."secondaryDisplayFieldId")
      WHERE cf."type" = 'CURRENCY'
        AND ed."archivedAt" IS NULL
      GROUP BY ed."organizationId", ed."id"
    `)

    let recomputed = 0
    let failed = 0
    for (const target of targets.rows) {
      const displayFieldTypes: ('primary' | 'secondary')[] = []
      if (target.isPrimary) displayFieldTypes.push('primary')
      if (target.isSecondary) displayFieldTypes.push('secondary')

      try {
        const service = new DisplayFieldService(target.organizationId, db)
        await service.recalculateDisplayFields(target.entityDefinitionId, displayFieldTypes)
        recomputed += 1
      } catch (error) {
        // One definition failing must not strand the rest — the remaining defs
        // still carry 100x-high text. Count and report instead of aborting.
        failed += 1
        logger.error('Failed to recompute display values for entity definition', {
          entityDefinitionId: target.entityDefinitionId,
          organizationId: target.organizationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('Currency minor-units migration complete', {
      wrapped: wrapped.rows.length,
      aiRehomed: rehomed.rows.length,
      shopifyRescaled: rescaled,
      displayDefinitions: targets.rows.length,
      displayRecomputed: recomputed,
      displayFailed: failed,
    })

    if (failed > 0) {
      throw new Error(
        `[096] ${failed} of ${targets.rows.length} entity definition(s) failed to recompute. ` +
          'Their displayName/secondaryDisplayValue still hold 100x-high currency text. ' +
          'Every other step already succeeded and is idempotent, so a re-run is safe.'
      )
    }
  },
}
