// packages/lib/src/accounting/connect-and-go/backlog-preview.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import type { SummaryGrain } from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import { isMonthKey } from '../ledger/setup/setup-readiness'
import { countMovementAccountingBacklog } from '../money/blocked-movements'
import { countImportedCustomerMoneyBacklog } from '../money/customer-money/ingest'
import { countFulfillmentAccountingBacklog } from '../sales/fulfillments/posting-reads'
import { countWorkItemsAtStage } from '../work-items/sweep'
import type { ConnectAndGoBacklogPreview } from './client'
import { estimateDrainMinutes } from './cutover'
import { guard } from './guard'

/**
 * What the recovery sweeps would post after this cutover once setup finishes, and about how many
 * provider objects that exports as. Reads only; the cutover need not be written yet.
 * No permission checks - the router asserts.
 */
export async function previewConnectAndGoBacklog(
  db: Database,
  params: { organizationId: string; cutoffPeriod: string; bookTimeZone?: string | null }
): Promise<Result<ConnectAndGoBacklogPreview, Error>> {
  const { organizationId, cutoffPeriod } = params
  return guard(
    async () => {
      if (!isMonthKey(cutoffPeriod)) {
        throw new BadRequestError(`"${cutoffPeriod}" is not a YYYY-MM month.`)
      }
      const settings = await readOrganizationSettings(organizationId, [
        'accounting.bookTimeZone',
      ] as const)
      const bookTimeZone =
        settings['accounting.bookTimeZone']?.trim() || params.bookTimeZone?.trim() || 'UTC'
      const window = { cutoffPeriod, bookTimeZone }

      const [shipments, movements, relief, importedPayments, exportSettings] = await Promise.all([
        countFulfillmentAccountingBacklog(db, organizationId, window),
        countMovementAccountingBacklog(db, organizationId, window),
        countWorkItemsAtStage(db, organizationId, { stage: 'relieve', sourceKind: 'fulfillment' }),
        countImportedCustomerMoneyBacklog(db, organizationId),
        readExportSettings(organizationId),
      ])

      const estimatedExports =
        exportSettings.mode === 'transaction'
          ? shipments.count + movements.count
          : buckets(shipments, exportSettings.summaryGrain.fulfillment) +
            buckets(movements, exportSettings.summaryGrain.receipt)

      return {
        cutoffPeriod,
        bookTimeZone,
        shipments: shipments.count,
        movements: movements.count,
        relief,
        importedPayments,
        exportMode: exportSettings.mode,
        estimatedExports,
        drainMinutes: estimateDrainMinutes([
          shipments.count,
          movements.count,
          relief,
          importedPayments,
        ]),
      }
    },
    'Failed to preview the accounting backlog',
    { organizationId }
  )
}

/** Summary objects for a lane: one per grain bucket; a payout bucket is estimated as a day. */
function buckets(
  lane: { count: number; days: number; months: number },
  grain: SummaryGrain
): number {
  if (lane.count === 0) return 0
  return grain === 'month' ? lane.months : lane.days
}
