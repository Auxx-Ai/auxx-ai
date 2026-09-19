// apps/web/src/components/purchasing/vendor-bill/vendor-bill-landed-cost-card.tsx
'use client'

// `vendor_bill:landed-cost` — what this shipment's receipts accrued for freight
// and duty against what other vendors' bills have charged for it (73 §7.2), and
// Clear for the under-run nobody will ever bill (74 D4).

import type { RecordId } from '@auxx/lib/resources/client'
import { parseRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Ship } from 'lucide-react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'

export function VendorBillLandedCostCard({ recordId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const { values } = useSystemValues(recordId as RecordId, ['vendor_bill_currency'], {
    autoFetch: true,
  })
  const storedCurrency = unwrapValue(values.vendor_bill_currency)
  const currencyCode =
    (typeof storedCurrency === 'string' && storedCurrency) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const vendorBillInstanceId = parseRecordId(recordId as RecordId).entityInstanceId
  const { data, isLoading } = api.purchasing.readLandedCostByBill.useQuery({
    vendorBillInstanceId,
  })

  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const clearLandedCost = api.purchasing.clearLandedCost.useMutation({
    onSuccess: () => {
      void utils.purchasing.readLandedCostByBill.invalidate()
      void utils.purchasing.readLandedCostByVendorPart.invalidate()
      void utils.ledger.listPostingsForSource.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error clearing landed cost', description: error.message })
    },
  })

  if (isLoading || !data) return <Skeleton className='h-24 w-full' />

  const nothing =
    data.receiptCount === 0 && data.landedLineCount === 0 && data.otherBilledMinor === 0
  if (nothing) {
    return (
      <EmptySection
        icon={<Ship className='size-5' />}
        title='No landed cost yet'
        description='Receipts against this bill accrue freight and duty here, and a carrier or broker bill charged against it shows what it actually cost.'
      />
    )
  }

  const money = (value: number) => formatCurrency(value, { currencyCode })
  const signed = (value: number) =>
    value === 0 ? money(0) : `${value > 0 ? '+' : '-'}${money(Math.abs(value))}`

  const legs = [
    { label: 'Freight', ...data.freight },
    { label: 'Duty', ...data.duties },
  ]
  const outstanding = data.freight.differenceMinor + data.duties.differenceMinor
  const remaining = data.freight.remainingMinor + data.duties.remainingMinor

  const onClear = async () => {
    const confirmed = await confirm({
      title: 'Clear the landed cost?',
      description: `${money(remaining)} still accrued for this shipment posts to purchase price variance. A carrier or broker bill arriving after this posts there too.`,
      confirmText: 'Clear',
      cancelText: 'Cancel',
    })
    if (confirmed) clearLandedCost.mutate({ vendorBillInstanceId })
  }

  return (
    <div className='flex flex-col gap-3 pe-3'>
      <PurchasingSummaryStrip
        cells={[
          { label: 'Receipts', value: String(data.receiptCount) },
          { label: 'Landed lines', value: String(data.landedLineCount) },
          {
            label: 'Outstanding',
            value: signed(outstanding),
            tone: outstanding === 0 ? 'muted' : 'warning',
          },
        ]}
      />

      {remaining > 0 && (
        <div className='flex items-center justify-between gap-3'>
          <p className='text-muted-foreground text-xs'>
            {money(remaining)} is still accrued for this shipment. Clear it once no carrier or
            broker bill is coming.
          </p>
          <Button
            variant='outline'
            size='xs'
            loading={clearLandedCost.isPending}
            loadingText='Clearing...'
            onClick={onClear}>
            Clear
          </Button>
        </div>
      )}

      <div className='border-t'>
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead>Accrual</TableHead>
              <TableHead className='text-right'>Accrued</TableHead>
              <TableHead className='text-right'>Billed</TableHead>
              <TableHead className='text-right'>Cleared</TableHead>
              <TableHead className='text-right'>Remaining</TableHead>
              <TableHead className='text-right'>Difference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {legs.map((legRow) => (
              <TableRow key={legRow.label} className='border-0 hover:bg-transparent'>
                <TableCell className='align-top'>{legRow.label}</TableCell>
                <TableCell className='text-right align-top tabular-nums'>
                  {money(legRow.accruedMinor)}
                </TableCell>
                <TableCell className='text-right align-top tabular-nums'>
                  {money(legRow.billedMinor)}
                </TableCell>
                <TableCell className='text-right align-top tabular-nums'>
                  {money(legRow.clearedMinor)}
                </TableCell>
                <TableCell className='text-right align-top tabular-nums'>
                  {money(legRow.remainingMinor)}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right align-top tabular-nums',
                    legRow.differenceMinor === 0
                      ? 'text-muted-foreground'
                      : 'font-medium text-amber-600'
                  )}>
                  {signed(legRow.differenceMinor)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data.otherBilledMinor !== 0 && (
        <p className='text-muted-foreground text-xs'>
          {money(data.otherBilledMinor)} on landed-cost lines coded to neither accrual account.
        </p>
      )}

      <ConfirmDialog />
    </div>
  )
}
