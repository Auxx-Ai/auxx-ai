// packages/lib/src/apps/installations/uninstall-impact.ts
// What an uninstall would actually do, for the confirm dialog.
// See plans/money/tasks/44 D-3.
//
// The uninstall button had no confirmation of any kind, and the two things it
// destroys are invisible from the app page: the connectors the installation owns,
// and the values behind its registered columns. A dialog that names neither is not
// a confirmation, it is a speed bump — so this is the read that makes the numbers
// sayable.

import { type Database, schema } from '@auxx/database'
import { and, count, eq, isNotNull } from 'drizzle-orm'
import { countMintedRecords } from '../../data-connectors/teardown'

/** One connector an uninstall would act on. */
export interface UninstallImpactConnector {
  id: string
  name: string
  /** Rows the connector has bound — its `itemCount` stamp, not a live count. */
  itemCount: number
}

/** What a delete would take with it, for one set of app-registered columns. */
export interface AppFieldImpact {
  /** Columns in scope. */
  total: number
  /** Of those, how many the merchant can actually see (`isHidden: false`). */
  visible: number
  /** FieldValue rows behind them — the number that decides whether to press the button. */
  valuesAffected: number
}

/**
 * Which columns to count: the ones an INSTALLATION registered, or the ones scoped to a single
 * CONNECTION. The two are different cascades reached by different buttons — uninstalling an app
 * sweeps by `appInstallationId`, disconnecting one account sweeps by `connectionId` (that FK is
 * `ON DELETE CASCADE`, so the connection-scoped columns and every value under them go with the
 * credential).
 */
export type AppFieldScope = { appInstallationId: string } | { connectionId: string }

/** Everything the uninstall confirm needs to state plainly. */
export interface UninstallImpact {
  connectors: UninstallImpactConnector[]
  /** Records the connectors CREATED, per definition — never the ones they enriched. */
  mintedByDef: Array<{ entityDefinitionId: string; count: number }>
  /** Total of {@link mintedByDef}, precomputed so the dialog does not re-reduce it. */
  mintedTotal: number
  appFields: AppFieldImpact
}

/**
 * Count the app-registered columns in `scope` and the `FieldValue` rows behind them.
 *
 * 🛑 The three numbers are what makes a confirm dialog a confirmation rather than a speed
 * bump, so state them for exactly what they count and nothing more: `total` is columns,
 * `visible` is the subset a person would notice going blank, `valuesAffected` is the rows
 * whose contents the cascade deletes. It does NOT count records — the records survive with
 * empty cells, which is precisely the outcome a dialog saying "records are kept" gets wrong.
 */
export async function countAppFieldImpact(
  db: Database,
  organizationId: string,
  scope: AppFieldScope
): Promise<AppFieldImpact> {
  const inScope =
    'appInstallationId' in scope
      ? eq(schema.CustomField.appInstallationId, scope.appInstallationId)
      : eq(schema.CustomField.connectionId, scope.connectionId)

  const owned = and(eq(schema.CustomField.organizationId, organizationId), inScope)

  const [fieldRow] = await db
    .select({ total: count(schema.CustomField.id) })
    .from(schema.CustomField)
    .where(owned)

  const [visibleRow] = await db
    .select({ visible: count(schema.CustomField.id) })
    .from(schema.CustomField)
    .where(and(owned, eq(schema.CustomField.isHidden, false)))

  const [valueRow] = await db
    .select({ values: count(schema.FieldValue.id) })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(owned)

  return {
    total: fieldRow?.total ?? 0,
    visible: visibleRow?.visible ?? 0,
    valuesAffected: valueRow?.values ?? 0,
  }
}

/**
 * Summarise what uninstalling this installation would touch.
 *
 * ⚠️ `mintedByDef` reuses {@link countMintedRecords}, which counts only records a
 * connector CREATED (`mintedInstance`). A pre-existing contact it merely enriched is
 * deliberately excluded and is never removed by any branch — so the dialog must not
 * present this as "records affected", only as "records these connectors created".
 *
 * ⚠️ `appFields.valuesAffected` is NOT symmetric with that. It counts every value
 * behind the installation's columns, including values sitting on records the
 * connector never created — which on one dev org is 96%/4%. The two numbers answer
 * different questions and the dialog states them separately for exactly that reason.
 */
export async function getUninstallImpact(
  db: Database,
  organizationId: string,
  appInstallationId: string
): Promise<UninstallImpact> {
  const connectors = await db
    .select({
      id: schema.DataConnector.id,
      name: schema.DataConnector.name,
      itemCount: schema.DataConnector.itemCount,
    })
    .from(schema.DataConnector)
    .where(
      and(
        eq(schema.DataConnector.organizationId, organizationId),
        eq(schema.DataConnector.appInstallationId, appInstallationId)
      )
    )

  // Per-connector, then folded: `countMintedRecords` is connector-scoped and two
  // connectors on one installation can both mint into the same definition.
  const perDef = new Map<string, number>()
  for (const connector of connectors) {
    for (const row of await countMintedRecords(db, organizationId, connector.id)) {
      perDef.set(row.entityDefinitionId, (perDef.get(row.entityDefinitionId) ?? 0) + row.count)
    }
  }
  const mintedByDef = [...perDef].map(([entityDefinitionId, count]) => ({
    entityDefinitionId,
    count,
  }))

  return {
    connectors,
    mintedByDef,
    mintedTotal: mintedByDef.reduce((sum, row) => sum + row.count, 0),
    appFields: await countAppFieldImpact(db, organizationId, { appInstallationId }),
  }
}

/** What an uninstalled installation still owns, for D-5's removal action. */
export interface LeftoverAppFields {
  /** The soft-deleted installation still holding columns, or null when there is none. */
  appInstallationId: string | null
  fields: number
  /** Of those, how many the merchant can actually see. */
  visible: number
  values: number
}

/**
 * The columns an UNINSTALLED installation still owns (plans/money/tasks/44 D-5).
 *
 * 🛑 This exists because `get-app-details` cannot answer it. That query resolves the
 * installation with `isNull(uninstalledAt)`, so for an uninstalled app it returns
 * `isInstalled: false` and `installation.id: undefined` — no id to key on and no counts
 * to show. Widening `installation` there would make `isInstalled` and every caller
 * downstream misread a soft-deleted row as a live one, so this asks the narrow question
 * separately instead.
 *
 * Returns `appInstallationId: null` when the app is currently installed, was never
 * installed, or left nothing behind — all three mean "offer no removal action".
 */
export async function getLeftoverAppFields(
  db: Database,
  organizationId: string,
  appId: string
): Promise<LeftoverAppFields> {
  const empty: LeftoverAppFields = { appInstallationId: null, fields: 0, visible: 0, values: 0 }

  // Only a SOFT-DELETED installation qualifies, and `isNotNull(uninstalledAt)` is the
  // whole guard: a reinstall reactivates the SAME row (`uninstalledAt: null`), so a
  // reinstalled app simply stops matching here and the action disappears on its own.
  //
  // ⚠️ Development and production are SEPARATE installation rows. An app uninstalled as
  // development while production stays live matches here — correctly: those are
  // different installation ids owning different columns, and the dev row's are genuinely
  // left behind.
  const installation = await db.query.AppInstallation.findFirst({
    where: and(
      eq(schema.AppInstallation.appId, appId),
      eq(schema.AppInstallation.organizationId, organizationId),
      isNotNull(schema.AppInstallation.uninstalledAt)
    ),
    columns: { id: true },
  })
  if (!installation) return empty

  const [total] = await db
    .select({ n: count(schema.CustomField.id) })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.appInstallationId, installation.id)
      )
    )
  if ((total?.n ?? 0) === 0) return empty

  const [visible] = await db
    .select({ n: count(schema.CustomField.id) })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.appInstallationId, installation.id),
        eq(schema.CustomField.isHidden, false)
      )
    )

  const [values] = await db
    .select({ n: count(schema.FieldValue.id) })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.appInstallationId, installation.id)
      )
    )

  return {
    appInstallationId: installation.id,
    fields: total?.n ?? 0,
    visible: visible?.n ?? 0,
    values: values?.n ?? 0,
  }
}
