// packages/lib/src/data-migrations/migrations/150-strip-legacy-address-components.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:150')

/**
 * The component id that marks a stored list as pre-editor, held as a literal
 * rather than imported from `address-component-editor.tsx` — that module lives
 * in `apps/web` and, like `132-card-clearing-rename.ts` and
 * `144-gl-account-code-optional-and-subtype.ts`, this is the VALUE this
 * migration matches on, not a reference to whatever the constant says later.
 */
const LEGACY_UNCONFIGURED_ID = 'street'

/**
 * Migration 150: strip the pre-editor `addressComponents` list off every
 * address field that still carries one.
 *
 * `plans/apps/shipstation/shipstation-workflow-expansion-plan.md` §5.
 *
 * ## What was stored, and why it is wrong
 *
 * Five registry address fields — `company_headquarters`,
 * `purchase_order_ship_to`, `order_shipping_address`,
 * `service_request_address` and `work_order_address` — shipped
 * `options.addressComponents = ['street', 'city', 'state', 'country']`. That
 * list predates the component editor's id set: it names `street`, an id no
 * editor has ever produced, and omits `street2` and `zipCode` entirely.
 *
 * Nothing read the option, so the literals were inert. Step 0c of the
 * ShipStation expansion made `addressComponents` actually drive
 * `AddressStructFields`, `AddressSingleFields` and `DisplayAddressStruct`, at
 * which point honoring these lists literally would have deleted the ZIP line
 * from every order, work order and company address in every org — which no
 * admin ever asked for. `parseAddressComponents` therefore treats a list
 * carrying `street` as un-configured and falls back to the default six.
 *
 * ## Why a migration, and not just the registry edit
 *
 * The registry literals are gone as of this change, but a registry edit reaches
 * no existing org: `ensureCustomFields` is INSERT-only and ships nothing to a
 * `CustomField` row already in the database. Every org created before this
 * still holds the stale list on five rows. This removes it, so the stored
 * options say what they mean — absent, therefore the defaults — rather than
 * leaning on the guard to reinterpret them.
 *
 * The guard in `address-component-editor.tsx` stays regardless. It is what
 * keeps an org that has not yet run this migration rendering correctly, and
 * removing it is a separate decision to make once this has run everywhere.
 *
 * ## Matched on the value, not the five attributes
 *
 * The predicate is "an address field whose stored list contains `street`",
 * not a list of the five `systemAttribute`s. Any row carrying that id is
 * un-configured by definition — the editor cannot emit it — so this also
 * catches copies that were cloned onto other defs, and can never swallow a
 * real admin choice.
 *
 * ## Bulk, never a per-row loop
 *
 * One `UPDATE` per org with the key removed by jsonb `-`. The `@>` containment
 * test is what selects the rows, so the statement is a no-op on an org with
 * nothing stale.
 *
 * **No DDL.** This rewrites `CustomField.options` on existing rows; nothing
 * here touches a Postgres table. If a `.sql` file appears under
 * `packages/database/drizzle/` for this work, something is wrong.
 *
 * ## Idempotent
 *
 * A re-run matches nothing, because the key it matches on is the key it
 * removed — `alreadyUpToDate: true`, nothing written. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 150-strip-legacy-address-components`.
 */
export const migration150StripLegacyAddressComponents: PerOrgMigration = {
  id: '150-strip-legacy-address-components',
  description:
    "Strip the pre-editor addressComponents list (['street', 'city', 'state', 'country']) off " +
    'every address field still carrying one, so the stored options say what they mean instead ' +
    'of relying on the parse-time guard to reinterpret an id no editor can produce',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const stripped = await db
      .update(schema.CustomField)
      .set({
        options: sql`${schema.CustomField.options} - 'addressComponents'`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          sql`${schema.CustomField.options} -> 'addressComponents' @> ${JSON.stringify([
            LEGACY_UNCONFIGURED_ID,
          ])}::jsonb`
        )
      )
      .returning({ id: schema.CustomField.id })

    if (stripped.length === 0) {
      return { ...state, alreadyUpToDate: true }
    }

    // The direct `CustomField` write bypasses the org cache, and every renderer
    // resolves a field's options from it — a stale entry would keep handing the
    // stale list to `parseAddressComponents` until something else evicted it.
    // `perOrgMigration` flushes after the whole batch, but `up()` is
    // also called directly by `scripts/run-entity-migration.ts`, so do it here
    // too (as 137, 139 and 144 do).
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    logger.info('Migration 150 applied', { organizationId, stripped: stripped.length })

    return { ...state, alreadyUpToDate: false }
  },
}
