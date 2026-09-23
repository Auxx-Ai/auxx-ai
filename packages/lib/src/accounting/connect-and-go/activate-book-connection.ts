// packages/lib/src/accounting/connect-and-go/activate-book-connection.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { cutoverDateFor } from '../ledger/builders/opening-balance'
import {
  activateAccountingBookConnection,
  readAccountingBookConnectionStatus,
  readActiveBookConnection,
} from '../providers/book-connections'
import { NONE_PROVIDER_ID, resolveAccountingProvider } from '../providers/provider'
import { type BookConnectionSetupResult, CONNECT_AND_GO_OPENING_REASON } from './client'
import { guard } from './guard'

/** The day after the cutover month's last day. A calendar date, so no time zone applies. */
export function exportFromDateForCutoff(cutoffPeriod: string): string {
  const cutover = new Date(`${cutoverDateFor(cutoffPeriod)}T00:00:00.000Z`)
  cutover.setUTCDate(cutover.getUTCDate() + 1)
  return cutover.toISOString().slice(0, 10)
}

/**
 * Activate the book connection headlessly with `exportFromDate = cutover + 1 day`, over the org's
 * single connected provider authorization. Returns the active connection untouched when one exists.
 * No permission checks - the router asserts.
 */
export async function activateBookConnectionForSetup(
  db: Database,
  params: { organizationId: string; actorUserId: string }
): Promise<Result<BookConnectionSetupResult, Error>> {
  const { organizationId, actorUserId } = params
  return guard(
    async () => {
      const active = await readActiveBookConnection(db, organizationId)
      if (active) {
        return { activated: false, connectionId: active.id, exportFromDate: active.exportFromDate }
      }

      const provider = await resolveAccountingProvider(organizationId)
      if (provider.id === NONE_PROVIDER_ID) {
        throw new UnprocessableEntityError(
          'No accounting system is connected. Connect one before activating exports.',
          { organizationId }
        )
      }

      // Read through `db`: this date is frozen into the connection, so it must be the committed value.
      const settings = await readOrganizationSettings(
        organizationId,
        ['accounting.cutoffPeriod'] as const,
        db
      )
      const cutoffPeriod = settings['accounting.cutoffPeriod']?.trim()
      if (!cutoffPeriod) {
        throw new UnprocessableEntityError(
          'Choose the cutover month before activating exports - they start the day after it.',
          { organizationId }
        )
      }
      const exportFromDate = exportFromDateForCutoff(cutoffPeriod)

      const status = await readAccountingBookConnectionStatus(db, organizationId)
      const usable = status.credentials.filter((credential) => credential.companyId)
      const companies = new Set(usable.map((credential) => credential.companyId))
      const credential = usable[0]
      if (!credential) {
        throw new UnprocessableEntityError(
          'The accounting connection has no usable company authorization. Reconnect it.',
          { organizationId }
        )
      }
      if (companies.size > 1) {
        throw new ConflictError(
          'More than one accounting company is connected. Choose one in accounting settings.',
          { organizationId }
        )
      }

      const connection = await activateAccountingBookConnection(db, {
        organizationId,
        actorUserId,
        credentialId: credential.id,
        exportFromDate,
        expectedActiveConnectionId: null,
        openingPolicy: {
          version: 1,
          kind: 'explicit_cutover',
          exportFromDate,
          reason: CONNECT_AND_GO_OPENING_REASON,
        },
      })
      return { activated: true, connectionId: connection.id, exportFromDate }
    },
    'Failed to activate the book connection for setup',
    { organizationId }
  )
}
