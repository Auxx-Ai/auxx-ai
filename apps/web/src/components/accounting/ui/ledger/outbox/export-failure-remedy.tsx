// apps/web/src/components/accounting/ui/ledger/outbox/export-failure-remedy.tsx

'use client'

// The drawer's half of 89 D5/D6: what a refused (or table-refused) batch offers
// to DO about itself. The row on the queue deep-links to the Chart tab; here the
// picker is inline, because somebody reading the batch is already looking at the
// accounts it names.

import type { ExportFailureClass, ExportFailureItem } from '@auxx/lib/accounting/export/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { ExternalLink, Landmark, Map as MapIcon, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useAccountingProviderStatus } from '../../../hooks/use-accounting-provider-status'
import { ProviderAccountPicker } from '../../provider-account-picker'
import { useCreateProviderAccount } from '../../settings/use-create-provider-account'

interface ExportFailureRemedyProps {
  batchId: string
  /** `failed` gets Retry; `ready` gets the pickers alone - it has a Send now of its own. */
  state: 'failed' | 'ready'
  failureClass: ExportFailureClass | null
  /** `failureItems` on a failed batch, `blockers` on a ready one. */
  items: ExportFailureItem[]
  /**
   * What the mapping table still refuses, live. On a failed batch that is the
   * verdict's own items minus whatever has been mapped since the send, so an
   * empty array with a non-empty {@link items} means the batch is ready to retry.
   */
  blockers?: ExportFailureItem[]
  lastError: string | null
  /** When the sweep will try again. Only `transport` ever carries one (89 D3). */
  nextAttemptAt?: string | null
  /** Invalidate whatever the host frame reads - a mapping save changes both. */
  onChanged: () => void
}

/** The Chart tab's editor pane, seeded with one account - the row's remedy, for a reader who may not map. */
function chartAccountHref(glAccountId: string): string {
  return `/app/accounting/settings/accounts?s=chart&account=${encodeURIComponent(glAccountId)}`
}

/**
 * A stored refusal minus what has been mapped since it was recorded (89 D6).
 *
 * `invalid_mapping` always survives: the preflight is a mapping-table read and
 * cannot see that the provider account a mapping names is gone.
 */
export function remainingFailureItems(
  items: readonly ExportFailureItem[],
  blockers: readonly ExportFailureItem[]
): ExportFailureItem[] {
  return items.filter(
    (item) => item.key === 'invalid_mapping' || blockers.some((blocker) => blocker.ref === item.ref)
  )
}

/**
 * The remedy for one batch's refusal: a picker per account it named, then Retry.
 *
 * Every picker it was refused over stays on screen once mapped - it is the
 * record of what was chosen - so `allMapped` turns the Retry primary instead.
 */
export function ExportFailureRemedy({
  batchId,
  state,
  failureClass,
  items,
  blockers,
  lastError,
  nextAttemptAt = null,
  onChanged,
}: ExportFailureRemedyProps) {
  const { can } = useAccess()
  const canControl = can(PermissionKey.ledgerControl)
  const canRetry = can(PermissionKey.ledgerPost)
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { providerLabel } = useAccountingProviderStatus()

  // 🛑 A provider round trip (the router's own caveat on `accountMap`), so it is
  // asked for only when there is a picker to feed.
  const map = api.ledger.accountMap.useQuery(undefined, {
    enabled: items.length > 0 && canControl,
  })

  const setIdentity = api.ledger.setAccountIdentity.useMutation({
    onSuccess: () => {
      void utils.ledger.accountMap.invalidate()
      onChanged()
    },
    onError: (error) =>
      toastError({ title: 'Could not map the account', description: error.message }),
  })

  const retry = api.ledger.exportBatches.retry.useMutation({
    onSuccess: onChanged,
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })

  const rows = useMemo(() => map.data?.rows ?? [], [map.data])
  const chart = useMemo(() => rows.map((row) => row.account), [rows])
  const byAccountId = useMemo(() => new Map(rows.map((row) => [row.account.id, row])), [rows])
  const { createInProvider, creatingAccountId } = useCreateProviderAccount({
    accounts: chart,
    byAccountId,
    providerLabel,
    confirm,
  })

  const mapped = (glAccountId: string) =>
    map.data?.rows.find((row) => row.account.id === glAccountId)?.providerAccountId ?? null
  // Either witness will do: the account map is the picker's own view, `blockers`
  // the server's, and a refetch of one can land before the other.
  const allMapped =
    items.length > 0 && (blockers?.length === 0 || items.every((item) => mapped(item.ref) !== null))
  // Nothing left to pick, so the line above stops asking for it. The pickers
  // stay - they are the record of what was chosen.
  const settled =
    state === 'failed' &&
    allMapped &&
    (blockers === undefined || remainingFailureItems(items, blockers).length === 0)

  return (
    <div className='flex flex-col gap-2'>
      {/* The items ARE the refusal, split up: printing `lastError` beside them
          says the same thing twice (`entry-blockers.tsx`'s rule). */}
      {items.length === 0 && lastError && <p className='text-destructive text-xs'>{lastError}</p>}

      {failureClass === 'transport' && (
        <p className='text-muted-foreground text-xs'>
          {nextAttemptAt
            ? `Retrying automatically at ${new Date(nextAttemptAt).toLocaleString()}`
            : 'No more automatic attempts'}
        </p>
      )}

      {items.length === 0 && failureClass === 'configuration' && (
        <Button asChild variant='outline' size='sm' className='self-start'>
          <Link href='/app/accounting/settings/provider'>
            <ExternalLink />
            Open the connection
          </Link>
        </Button>
      )}

      {items.length > 0 && (
        <>
          <p className='text-muted-foreground text-xs'>
            {settled
              ? 'Every account this batch named is mapped now. Retry to send it.'
              : canControl
                ? 'Pick the account each of these is in the connected accounting system, then retry.'
                : 'These accounts are not linked in the connected accounting system.'}
          </p>
          {/* The same label-left, control-right rows as the Chart editor, so the
              picker reads as the one it is there rather than a stray dropdown. */}
          <FieldPanel
            orientation='responsive'
            breakpoint='sm'
            resizeId='export-failure-remedy'
            defaultLabelWidth={200}
            className='p-0'>
            {items.map((item) => {
              const row = map.data?.rows.find((candidate) => candidate.account.id === item.ref)
              return (
                <FieldPanelRow
                  key={`${item.key}-${item.ref}`}
                  title={item.label}
                  icon={<Landmark className='size-4' />}>
                  {canControl ? (
                    <ProviderAccountPicker
                      value={row?.providerAccountId ?? null}
                      accounts={map.data?.providerAccounts ?? []}
                      // The account's CURRENT type, off the map - never the frozen
                      // payload's, which is what the batch was built against.
                      target={{
                        accountType: row?.account.accountType ?? null,
                        subtype: row?.account.subtype ?? null,
                      }}
                      disabled={
                        map.isPending || setIdentity.isPending || creatingAccountId === item.ref
                      }
                      placeholder='Select account'
                      onChange={(providerAccountId) =>
                        setIdentity.mutate({ glAccountId: item.ref, providerAccountId })
                      }
                      // The hook invalidates `accountMap`; the host frame reads
                      // the batch too, so it needs telling as well.
                      onCreate={
                        map.data?.canCreateProviderAccounts && canControl && !row?.providerAccountId
                          ? () => {
                              void createInProvider(item.ref).then(onChanged)
                            }
                          : undefined
                      }
                      createLabel={`Create in ${providerLabel ?? 'the accounting system'}`}
                    />
                  ) : (
                    <div className='flex min-h-8 items-center'>
                      <Button asChild variant='outline' size='xs'>
                        <Link href={chartAccountHref(item.ref)}>
                          <MapIcon />
                          Map account
                        </Link>
                      </Button>
                    </div>
                  )}
                </FieldPanelRow>
              )
            })}
          </FieldPanel>
        </>
      )}

      {state === 'failed' && canRetry && (
        <div>
          <Button
            variant={allMapped ? 'default' : 'outline'}
            size='sm'
            loading={retry.isPending}
            loadingText='Retrying...'
            onClick={() => retry.mutate({ batchId })}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}
