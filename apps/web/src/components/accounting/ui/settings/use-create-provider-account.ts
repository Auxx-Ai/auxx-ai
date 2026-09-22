// apps/web/src/components/accounting/ui/settings/use-create-provider-account.ts

'use client'

import {
  type AccountIdentityRow,
  accountPath,
  type ChartAccountRow,
} from '@auxx/lib/accounting/ledger/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import type { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { formatAccountLabel } from '../account-label-format'

type ConfirmFn = ReturnType<typeof useConfirm>[0]

interface UseCreateProviderAccountParams {
  /** The org's whole chart, for the ancestor walk. */
  accounts: ChartAccountRow[]
  /** The account map row per `gl_account` id - which ancestors are already linked. */
  byAccountId: Map<string, AccountIdentityRow>
  /** `'QuickBooks Online'`, or null with nothing connected. Never hardcode it. */
  providerLabel: string | null
  /** The host's own `useConfirm`, so a screen keeps one dialog rather than two. */
  confirm: ConfirmFn
}

/** `Sales, 4100 · Product Income` - the accounts a toast has to name. */
function accountNameList(created: Array<{ row: { account: ChartAccountRow } }>): string {
  return created.map(({ row }) => formatAccountLabel(row.account)).join(', ')
}

/**
 * Create ONE row's account in the connected system and link it.
 *
 * 🛑 Confirms first, and the confirm is not a formality: every other write on
 * these screens changes something of ours, and this one adds an account to
 * somebody's real books. QuickBooks cannot delete an account - the most anyone
 * can do afterwards is deactivate it - so "are you sure" is the last point at
 * which a misclick is free.
 *
 * Toasts its refusal rather than rejecting: a list row has no field for a
 * sentence to land on, and the row is on screen so the message can name the
 * account.
 */
export function useCreateProviderAccount({
  accounts,
  byAccountId,
  providerLabel,
  confirm,
}: UseCreateProviderAccountParams): {
  createInProvider: (glAccountId: string) => Promise<void>
  creatingAccountId: string | null
} {
  const utils = api.useUtils()
  const [creatingAccountId, setCreatingAccountId] = useState<string | null>(null)
  const createInProvider = api.ledger.createProviderAccount.useMutation()

  const run = useCallback(
    async (glAccountId: string) => {
      const account = accounts.find((row) => row.id === glAccountId)
      const where = providerLabel ?? 'the connected accounting system'
      // A sub-account cannot be nested under a parent the provider does not
      // have yet, so the parents come along - named here, because they are
      // accounts somebody did not click and they land in the same real books.
      const parents = accountPath(accounts, glAccountId)
        .slice(0, -1)
        .filter((ancestor) => !byAccountId.get(ancestor.id)?.providerAccountId)
      const parentNote =
        parents.length > 0
          ? ` Its parent ${parents.length === 1 ? 'account' : 'accounts'} ${parents
              .map((ancestor) => formatAccountLabel(ancestor))
              .join(
                ', '
              )} ${parents.length === 1 ? 'is' : 'are'} not linked yet and will be created first.`
          : ''
      const confirmed = await confirm({
        title: `Create this account in ${where}?`,
        description: `${formatAccountLabel(account)} will be added to ${where}'s chart of accounts and linked to this one.${parentNote} ${where} cannot delete an account once it exists - it can only be made inactive.`,
        confirmText: parents.length > 0 ? 'Create all and link' : 'Create and link',
        cancelText: 'Cancel',
      })
      if (!confirmed) return

      setCreatingAccountId(glAccountId)
      try {
        const result = await createInProvider.mutateAsync({
          glAccountId,
          includeAncestors: parents.length > 0,
        })
        await utils.ledger.accountMap.invalidate()
        // The server re-releases the failed batches this unblocks, so an Outbox
        // open in another tab is now showing a stale refusal.
        void utils.ledger.exportBatches.list.invalidate()
        void utils.ledger.exportBatches.summaryRows.invalidate()
        void utils.ledger.outboxCounts.invalidate()
        // ⚠️ Not success toasts - the page has none, and the link badge flipping
        // to Linked is the confirmation. These are the outcomes that are NOT what
        // the button said it would do, so they are worth a sentence: accounts
        // nobody clicked were added to the provider's books, the account already
        // existed and nothing was created, or the code did not survive because
        // the company keeps no account numbers.
        if (result.ancestors.length > 0) {
          const created = result.ancestors.filter((row) => row.outcome === 'created')
          const existing = result.ancestors.filter((row) => row.outcome === 'existing')
          toastError({
            title: `${result.ancestors.length} parent ${result.ancestors.length === 1 ? 'account' : 'accounts'} went to ${where} too`,
            description: [
              created.length > 0 &&
                `${accountNameList(created)} ${created.length === 1 ? 'was' : 'were'} created and linked.`,
              existing.length > 0 &&
                `${accountNameList(existing)} already existed there and ${existing.length === 1 ? 'was' : 'were'} linked.`,
            ]
              .filter(Boolean)
              .join(' '),
          })
        } else if (result.outcome === 'existing') {
          toastError({
            title: `${where} already had this account`,
            description: `Linked to '${result.row.providerAccountName}'. Nothing was created.`,
          })
        } else if (result.numberDropped) {
          toastError({
            title: 'Linked, but without the account number',
            description: `${where} has account numbers turned off, so '${formatAccountLabel(account)}' was created by name only.`,
          })
        }
      } catch (error) {
        toastError({
          title: `Error creating the account in ${where}`,
          description: error instanceof Error ? error.message : 'Could not create the account.',
        })
      } finally {
        setCreatingAccountId(null)
      }
    },
    [accounts, byAccountId, confirm, createInProvider, providerLabel, utils]
  )

  return { createInProvider: run, creatingAccountId }
}
