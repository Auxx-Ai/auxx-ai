// packages/lib/src/apps/installations/uninstall-app.ts

import { database, schema, type Transaction } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { deleteAppFields } from '../../custom-fields/delete-field'
import {
  type DeleteSyncedDataBehavior,
  deleteConnector,
  disconnectConnectors,
} from '../../data-connectors/mutations'

/**
 * Input parameters for uninstallApp
 */
export interface UninstallAppInput {
  appId: string
  organizationId: string
  uninstalledById: string
  installationType?: 'development' | 'production'
  /**
   * What happens to the records this installation's connectors CREATED
   * (plans/money/tasks/44 D-2/D-3). Defaults to `'keep'`, which is also what every
   * caller that predates the confirm dialog gets.
   *
   * - `'keep'`    → connectors are DISCONNECTED, rows and records untouched.
   * - `'archive'` → connectors torn down, minted records soft-deleted.
   * - `'delete'`  → connectors torn down, minted records and owned defs removed.
   */
  syncedData?: DeleteSyncedDataBehavior
}

/**
 * Uninstall result
 */
export interface UninstallAppOutput {
  success: true
  uninstalledAt: Date
  app: {
    slug: string
    title: string
  }
  installationType: 'development' | 'production'
}

/**
 * Uninstall an app from an organization
 *
 * @param input - App uninstall parameters
 * @returns Result with uninstall confirmation
 */
export async function uninstallApp(input: UninstallAppInput) {
  const { appId, organizationId, uninstalledById, installationType, syncedData = 'keep' } = input

  // Find app
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
    }),
    'get-app-for-uninstall'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: `App "${appId}" not found`,
      appId,
    })
  }

  // Find active installation
  const installationResult = await fromDatabase(
    database.query.AppInstallation.findFirst({
      where: (installations, { and, eq, isNull }) => {
        const conditions = [
          eq(installations.appId, app.id),
          eq(installations.organizationId, organizationId),
          isNull(installations.uninstalledAt),
        ]

        // If installationType specified, match it
        if (installationType) {
          conditions.push(eq(installations.installationType, installationType))
        }

        return and(...conditions)
      },
    }),
    'get-active-installation'
  )

  if (installationResult.isErr()) {
    return installationResult
  }

  const installation = installationResult.value

  if (!installation) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: installationType
        ? `App "${app.slug}" is not installed as ${installationType}`
        : `App "${app.slug}" is not installed`,
      appId,
    })
  }

  // The connector disposition the merchant picked in the confirm dialog
  // (plans/money/tasks/44 D-3). `'keep'` is the default and the safe one.
  //
  // On `'keep'` the connectors are DISCONNECTED, not deleted. That loop used to be
  // `deleteConnector(…, 'keep')`, which kept the synced RECORDS but destroyed the
  // connector row and, with it, every `DataConnectorItem` binding: the only memory of
  // which external id maps to which record, plus the per-field sync pins. Those
  // bindings are connector-scoped, so a reinstall minting a new connector id re-mints
  // duplicates of everything.
  //
  // The real bug that loop was written to fix — a BullMQ schedule still ticking and
  // failing auth on every run, because uninstall preserves the credential but not the
  // app behind it — is closed on every branch: `disconnectConnectors` tears the
  // schedule down, and `deleteConnector` always has.
  // Read by the field sweep below: an installation that owned no connector has nothing
  // to defer the sweep to (see the comment there).
  let ownedConnectorCount = 0
  const connectorCleanupResult = await fromDatabase(
    (async () => {
      const ownedConnectors = await database
        .select({ id: schema.DataConnector.id })
        .from(schema.DataConnector)
        .where(
          and(
            eq(schema.DataConnector.organizationId, organizationId),
            eq(schema.DataConnector.appInstallationId, installation.id)
          )
        )
      ownedConnectorCount = ownedConnectors.length

      if (syncedData === 'keep') {
        await disconnectConnectors(
          database,
          organizationId,
          ownedConnectors.map((c) => c.id),
          `${app.title} was uninstalled`
        )
        return
      }

      if (ownedConnectors.length === 0) return
      // No real actor for a lifecycle-triggered teardown; `deleteConnector`'s userId is
      // only read on the non-'keep' branches, which is exactly where we are.
      const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
      for (const connector of ownedConnectors) {
        await deleteConnector(database, organizationId, systemUserId, connector.id, syncedData)
      }
    })(),
    'uninstall-app-connector-disposition'
  )

  if (connectorCleanupResult.isErr()) {
    return connectorCleanupResult
  }

  // Uninstall in a transaction
  const now = new Date()

  const transactionResult = await fromDatabase(
    database.transaction(async (tx: Transaction) => {
      // Preserve AppSettings and Credential on uninstall so they survive
      // reinstall (Approach A: stable installation identity). OAuth tokens may expire
      // but refresh logic or re-auth flow handles that without destroying the row.

      // Soft delete installation
      const [updated] = await tx
        .update(schema.AppInstallation)
        .set({ uninstalledAt: now, updatedAt: now })
        .where(eq(schema.AppInstallation.id, installation.id))
        .returning()

      if (!updated) {
        throw new Error('Failed to uninstall app')
      }

      // 🛑 The app's registered custom fields are NOT swept here on the normal path
      // (plans/money/tasks/44 D-2b). This call used to be unconditional, and it
      // contradicted the connector disposition above it: `'keep'` promised to keep the
      // synced records while this deleted every `CustomField` carrying this
      // installation's id — and `FieldValue.fieldId` cascades. `EntityInstance` stores
      // no user data at all, so "keep the records" kept the rows and deleted their
      // contents: 31,737 values on one dev org, 96% of them on records the connector
      // had minted.
      //
      // The original justification was stale identity links (a contact↔Shopify-customer
      // link the chat fence trusts). Traced end to end, it does not hold:
      // `find-or-create-from-jwt.ts` short-circuits Shopify identity resolution when the
      // installation is uninstalled, so the stale link is never read. Deleting the
      // column closed nothing — and since `RecordIdentity.fieldId` cascades off it,
      // KEEPING it is what lets a reinstall re-link every contact instantly.
      //
      // The sweep now happens when the connector that was part of the app is gone
      // (`sweepAppFieldsIfLastConnectorGone`, at the tail of the teardown chain).
      //
      // ⚠️ EXCEPT when there is no connector to wait for. That is not an edge case:
      // 4 of the 6 installations owning fields on the dev org own ZERO connectors
      // (quickbooks, two shopify, stripe). A purely connector-tied rule would leave
      // their columns unremovable forever, so an installation with no connectors sweeps
      // here and now.
      if (ownedConnectorCount === 0) {
        const swept = await deleteAppFields({ appInstallationId: installation.id }, tx)
        if (swept.isErr()) throw new Error(swept.error.message)
      }

      // Log event
      await tx.insert(schema.AppEventLog).values({
        appId: app.id,
        organizationId: organizationId,
        appDeploymentId: updated.currentDeploymentId,
        userId: uninstalledById,
        eventType: 'app.uninstalled',
        eventData: {
          installationType: updated.installationType,
        },
      })

      return updated
    }),
    'uninstall-app-transaction'
  )

  if (transactionResult.isErr()) {
    return transactionResult
  }

  const uninstalledInstallation = transactionResult.value

  return ok({
    success: true,
    uninstalledAt: now,
    app: {
      slug: app.slug,
      title: app.title,
    },
    installationType: uninstalledInstallation.installationType as 'development' | 'production',
  })
}
