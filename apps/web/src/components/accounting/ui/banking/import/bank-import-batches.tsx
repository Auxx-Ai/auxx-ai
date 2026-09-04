// apps/web/src/components/accounting/ui/banking/import/bank-import-batches.tsx

'use client'

// Every statement import filed against an account, and the one destructive
// action on this screen (HANDOFF slot 3D, plans/accounting/ui-plan.md §2.9).
//
// 🛑 **A reverse is partial by design.** It deletes the rows nobody has decided
// anything about and REFUSES the rest by name: a coded line is the source
// document of a journal entry and a matched one is what says a payment we
// already posted cleared, so deleting either is deleting evidence for a posting
// that stays in the books. The refusals are rendered as a card, never a toast -
// "31 Jan, -$50.00, FUEL STOP 12 - carries posting gp_42" is the only sentence
// that says what to do next.

import type { BankImportBatch, ReverseImportRefusal } from '@auxx/lib/banking'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { FileClock, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { EMPTY_CELL, formatMinor } from '../../ledger/format'

interface BankImportBatchesProps {
  bankAccountId: string | null
  currencyCode: string
}

export function BankImportBatches({ bankAccountId, currencyCode }: BankImportBatchesProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [refusals, setRefusals] = useState<ReverseImportRefusal[]>([])
  const [reversingId, setReversingId] = useState<string | null>(null)

  const utils = api.useUtils()
  const batches = api.banking.bankingImport.listBatches.useQuery(
    bankAccountId ? { bankAccountId } : {}
  )
  const reverse = api.banking.bankingImport.reverse.useMutation()

  const handleReverse = async (batch: BankImportBatch) => {
    const confirmed = await confirm({
      title: 'Reverse this import?',
      description:
        batch.protectedCount > 0
          ? `${batch.rowCount} lines came in with this import and ${batch.protectedCount} of them ` +
            'have been coded, matched or posted. Those will be kept and named; the rest will be ' +
            'deleted. This cannot be undone.'
          : `${batch.rowCount} lines came in with this import and none has been reviewed yet. ` +
            'They will be deleted. This cannot be undone.',
      confirmText: 'Reverse import',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return

    setReversingId(batch.importBatchId)
    setRefusals([])
    try {
      const result = await reverse.mutateAsync({ importBatchId: batch.importBatchId })
      setRefusals(result.refused)
      await utils.banking.bankingImport.listBatches.invalidate()
      await utils.banking.bankAccount.list.invalidate()
      if (batch.bankAccountId) {
        await utils.banking.bankAccount.coverage.invalidate({ id: batch.bankAccountId })
      }
    } catch (error) {
      toastError({
        title: 'The import could not be reversed',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
    } finally {
      setReversingId(null)
    }
  }

  const rows = batches.data ?? []

  return (
    <Section
      title='Imports on this account'
      description='Every statement file already filed. Reversing one removes the lines it brought in that nobody has acted on yet.'>
      <ConfirmDialog />

      {refusals.length > 0 && (
        <div className='mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40'>
          <p className='font-medium text-sm'>
            {refusals.length} line{refusals.length === 1 ? ' was' : 's were'} kept
          </p>
          <ul className='mt-2 flex flex-col gap-1'>
            {refusals.map((refusal) => (
              <li key={refusal.id} className='text-muted-foreground text-xs'>
                <span className='font-mono tabular-nums'>{refusal.postedAt ?? EMPTY_CELL}</span>{' '}
                <span className='font-mono tabular-nums'>
                  {refusal.amountMinor == null
                    ? EMPTY_CELL
                    : formatMinor(Math.abs(refusal.amountMinor), currencyCode)}
                </span>{' '}
                <span className='text-foreground'>{refusal.description || EMPTY_CELL}</span> -{' '}
                {refusal.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!batches.isPending && rows.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title='No statements imported yet'
          description={
            <span>
              Once a file is imported and filed against this account it shows here, and can be
              reversed as a unit.
            </span>
          }
        />
      ) : (
        <TreeRowList
          items={rows}
          loading={batches.isPending}
          skeletonCount={2}
          getKey={(batch: BankImportBatch) => batch.importBatchId}
          renderRow={(batch: BankImportBatch) => (
            <TreeRow
              className={TREE_SECONDARY_NOTRUNCATE}
              icon={<FileClock className='size-4 text-muted-foreground' />}
              title={
                <span className='truncate text-sm'>
                  {batch.from && batch.to ? `${batch.from} → ${batch.to}` : 'Undated statement'}
                </span>
              }
              secondary={
                <span className='flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs'>
                  <span>
                    {batch.rowCount} line{batch.rowCount === 1 ? '' : 's'}
                  </span>
                  {batch.bankAccountName && <span>{batch.bankAccountName}</span>}
                  {batch.protectedCount > 0 && (
                    <Badge variant='outline' size='xs'>
                      {batch.protectedCount} reviewed
                    </Badge>
                  )}
                  <span className='font-mono'>{batch.importBatchId.slice(0, 8)}</span>
                </span>
              }
              actions={
                <Button
                  variant='destructive-hover'
                  size='sm'
                  loading={reversingId === batch.importBatchId}
                  onClick={() => void handleReverse(batch)}>
                  <Undo2 />
                  Reverse this import
                </Button>
              }
            />
          )}
        />
      )}
    </Section>
  )
}
