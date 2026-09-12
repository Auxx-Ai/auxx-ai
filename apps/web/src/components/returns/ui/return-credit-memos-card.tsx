// apps/web/src/components/returns/ui/return-credit-memos-card.tsx
'use client'

// `return:credit-memos` — the money that went back out, and what we kept
// (plans/money/tasks/54-returns.md sections 5.1 and 5.2).
//
// 🔑 A return LINKS to a credit memo and never creates one. On the channel path
// the refund is issued in Shopify, the connector projects it into a
// `credit_memo` with `source: channel`, and it is settled the instant it lands
// — so by the time somebody records the return the memo already exists,
// unclaimed. The FK therefore lives on the MEMO: a memo very often has no
// return at all (an allowance, a cancellation), and one return can produce
// several.
//
// 🛑 Nothing here writes to a channel-sourced memo beyond that one link. Its
// fields are connector-managed and the sync re-delivers every refund on every
// order sync.
//
// This card is also where `goodsValue` / `creditedAmount` / `withheldAmount`
// live. They are `showInPanel: false` because three money rows in Details earn
// less than one sentence that says what was withheld and why — which is the
// sentence a chargeback rebuttal quotes.

import { FieldType } from '@auxx/database/enums'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { TreeRow, TreeRowEmpty } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Link2, Receipt } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useRecords } from '~/components/resources/hooks'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { api } from '~/trpc/react'

/** The owning side: the FK is on the memo, pointing at the return. */
const CREDIT_MEMO_RETURN_ATTR = 'credit_memo_return'

/** Minor units to a plain amount. Returns a dash rather than inventing a zero. */
function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—'
  return (minor / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export function ReturnCreditMemosCard({ recordId }: DrawerTabProps) {
  const utils = api.useUtils()
  const { data: record, isLoading } = api.return.get.useQuery({ returnRecordId: recordId })

  const orderRecordId = record?.orderId ? toRecordId('order', record.orderId) : null

  // Only the order's own unclaimed memos, which is the whole of the help
  // section 5.1 asks for: without it the picker offers every memo in the org.
  const { data: suggestions = [] } = api.return.unlinkedCreditMemos.useQuery(
    { orderRecordId: orderRecordId as RecordId },
    { enabled: orderRecordId !== null }
  )

  const linkedIds = useMemo(() => record?.creditMemoIds ?? [], [record?.creditMemoIds])
  const linkedRecordIds = useMemo(
    () => linkedIds.map((id) => toRecordId('credit_memo', id)),
    [linkedIds]
  )
  const { records: linkedRecords } = useRecords({
    recordIds: linkedRecordIds,
    enabled: linkedRecordIds.length > 0,
  })

  const refresh = useCallback(() => {
    void utils.return.get.invalidate({ returnRecordId: recordId })
    if (orderRecordId) void utils.return.unlinkedCreditMemos.invalidate({ orderRecordId })
  }, [utils, recordId, orderRecordId])

  // No `onError`: the hook has no such option and raises its own `toastError`
  // from `handleMutationError`. Adding one here would double the toast.
  const { saveFieldValue, isPending } = useSaveFieldValue({ onSuccess: refresh })

  const link = useCallback(
    (creditMemoId: string) => {
      // The write lands on the MEMO, not the return: `credit_memo.return` is
      // the owning half. Writing the return's `creditMemos` mirror instead
      // would be writing the inverse, which accepts the value and reads empty.
      saveFieldValue(
        toRecordId('credit_memo', creditMemoId),
        CREDIT_MEMO_RETURN_ATTR,
        recordId,
        FieldType.RELATIONSHIP
      )
    },
    [recordId, saveFieldValue]
  )

  const linkedRows = useMemo(
    () =>
      linkedIds.map((id) => {
        // `useRecords` answers `(T | undefined)[]` - a requested id that does
        // not resolve is a hole, not a shorter array - and `recordId` is itself
        // optional on the row, so both have to be checked before parsing.
        const found = linkedRecords?.find(
          (r) => r?.recordId !== undefined && parseRecordId(r.recordId).entityInstanceId === id
        )
        return {
          id,
          label: typeof found?.displayName === 'string' ? found.displayName : 'Credit memo',
        }
      }),
    [linkedIds, linkedRecords]
  )

  const withheld = record?.withheldAmount
  const hasWithheld = withheld !== null && withheld !== undefined && withheld !== 0

  return (
    <div className='flex flex-col gap-3'>
      {/* The arithmetic section 5.2 keeps on the return rather than on the memo:
          Auxx-Lift refunds 800 instead of 1000, the memo IS 800, and the 200 was
          never credited. There is nothing to post, only something to state. */}
      <dl className='grid grid-cols-3 gap-2 text-xs'>
        <div>
          <dt className='text-muted-foreground'>Goods value</dt>
          <dd className='font-medium tabular-nums'>{money(record?.goodsValue)}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>Credited</dt>
          <dd className='font-medium tabular-nums'>{money(record?.creditedAmount)}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>Withheld</dt>
          <dd className='font-medium tabular-nums'>{money(record?.withheldAmount)}</dd>
        </div>
      </dl>

      {hasWithheld && record?.withheldReason ? (
        <p className='text-muted-foreground text-xs leading-relaxed'>{record.withheldReason}</p>
      ) : null}

      {linkedRows.length === 0 ? (
        <TreeRowEmpty
          icon={<Receipt className='size-4' />}
          {...(isLoading
            ? { loading: true as const }
            : {
                title: 'No credit memos',
                description: record?.orderId
                  ? 'Link the refund once it has synced from the sales channel.'
                  : 'This return names no order, so there is nothing to suggest.',
              })}
        />
      ) : (
        <TreeRowList
          items={linkedRows}
          getKey={(row) => row.id}
          renderRow={(row) => (
            <TreeRow key={row.id} icon={<Receipt className='size-4' />} title={row.label} />
          )}
        />
      )}

      {suggestions.length > 0 && (
        <div className='flex flex-col gap-1'>
          <p className='text-muted-foreground text-xs'>
            On this order, not yet linked to any return
          </p>
          {suggestions.map((memo) => (
            <div
              key={memo.creditMemoId}
              className='flex items-center justify-between gap-2 rounded-md border px-2 py-1.5'>
              <span className='truncate text-xs'>
                <span className='font-medium'>{memo.number ?? 'Credit memo'}</span>
                <span className='text-muted-foreground'> · {money(memo.total)}</span>
              </span>
              <Button
                variant='outline'
                size='xs'
                loading={isPending}
                loadingText='Linking...'
                onClick={() => link(memo.creditMemoId)}>
                <Link2 /> Link
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
