// packages/lib/src/accounting/connect-and-go/backlog-preview.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import type { ExportSettings, SummaryGrain } from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import { isMonthKey } from '../ledger/setup/setup-readiness'
import { countMovementAccountingBacklog } from '../money/blocked-movements'
import {
  countUnbridgedFinancialRecords,
  countUnmaterializedCustomerTransactions,
} from '../money/customer-money/bridge-sweep'
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
  params: {
    organizationId: string
    cutoffPeriod: string
    /** The draft's; the saved one when absent. */
    bookTimeZone?: string | null
    exportMode?: ExportSettings['mode'] | null
  }
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
        params.bookTimeZone?.trim() || settings['accounting.bookTimeZone']?.trim() || 'UTC'
      const window = { cutoffPeriod, bookTimeZone }

      const [shipments, movementRows, recordMoney, relief, acceptances, unbridged, exportSettings] =
        await Promise.all([
          countFulfillmentAccountingBacklog(db, organizationId, window),
          countMovementAccountingBacklog(db, organizationId, window),
          // In draft nothing materializes, so the records are the backlog (110 G5).
          countUnmaterializedCustomerTransactions(db, { organizationId, ...window }),
          countWorkItemsAtStage(db, organizationId, {
            stage: 'relieve',
            sourceKind: 'fulfillment',
          }),
          countImportedCustomerMoneyBacklog(db, organizationId),
          countUnbridgedFinancialRecords(db, { organizationId, kind: 'customer_transaction' }),
          readExportSettings(organizationId),
        ])
      // Disjoint rows; the two day spans overlap, so the larger is a floor on their union.
      const movements = {
        count: movementRows.count + recordMoney.count,
        days: Math.max(movementRows.days, recordMoney.days),
        months: Math.max(movementRows.months, recordMoney.months),
      }
      const importedPayments = acceptances + unbridged

      const exportMode = params.exportMode ?? exportSettings.mode
      const estimatedExports =
        exportMode === 'transaction'
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
        exportMode,
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
