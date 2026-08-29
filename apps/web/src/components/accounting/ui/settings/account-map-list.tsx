// apps/web/src/components/accounting/ui/settings/account-map-list.tsx
'use client'

// The `G19` account map: which account in the connected accounting system each
// of the org's own accounts corresponds to.
//
// 🛑 One component, two homes - the setup wizard's mapping step and the Accounts
// settings page's third tab. `wizard-accounts-page.tsx` deliberately does the
// opposite (a read-only summary linking to settings) because the ROLE map is a
// review, not a task. This one is a task: it is the step between connecting
// QuickBooks and being able to post, and sending somebody out of the wizard to
// do it is sending them out of the wizard at its most important moment.
//
// 🛑 A confirmation is a WRITE, and the picker only ever offers type-compatible
// active accounts. Both are conveniences, not authorities: `setAccountIdentity`
// re-checks existence, active status and classification against the LIVE
// provider chart before writing, because a picker rendered five minutes ago may
// be offering an account somebody has since deactivated. Filtering here keeps a
// person from being offered a choice that would be refused; it does not replace
// the refusal.

import type { AccountIdentityRow, AccountSuggestionReason } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Combobox } from '@auxx/ui/components/combobox'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { Check, Sparkles, TriangleAlert, X } from 'lucide-react'
import { api } from '~/trpc/react'
import { accountTypeColor, accountTypeLabel } from './accounts-types'

/** How a suggestion earned itself, in the words the row shows. */
const REASON_COPY: Record<AccountSuggestionReason, string> = {
  number: 'same account number',
  name: 'same name',
}

export interface AccountMapListProps {
  /**
   * Hide the mapped rows once everything that needs attention is dealt with.
   * The wizard wants a short list of what is left; settings wants the whole map.
   */
  compact?: boolean
}

/**
 * Every account in the org's chart and the provider account it points at.
 *
 * Three states per row, and they are the whole screen:
 *
 * | State | What the reader is being told | What they can do |
 * | --- | --- | --- |
 * | `confirmed` | somebody paired these two | unmap it |
 * | `unmapped` + suggestion | we found a likely match, and here is why | confirm, or pick another |
 * | `unmapped` | nothing plausible matched | pick one |
 *
 * ⚠️ A `confirmed` row whose `liveProviderAccount` is null is the DANGLING case
 * - the provider account was deleted or deactivated under a confirmed mapping -
 * and it renders as a repair rather than as a mapping. `G19` requires every
 * close to refuse on exactly these, so the screen has to lead with them.
 */
export function AccountMapList({ compact = false }: AccountMapListProps) {
  const accountMap = api.ledger.accountMap.useQuery()
  const utils = api.useUtils()

  const invalidate = async () => {
    await utils.ledger.accountMap.invalidate()
  }

  const setAccountIdentity = api.ledger.setAccountIdentity.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error saving the mapping', description: error.message })
    },
  })

  const confirmSuggested = api.ledger.confirmSuggestedAccounts.useMutation({
    onSuccess: async (result) => {
      await invalidate()
      if (result.failures.length > 0) {
        toastError({
          title: `${result.failures.length} mapping${result.failures.length === 1 ? '' : 's'} could not be saved`,
          description: result.failures.join(' '),
        })
      }
    },
    onError: (error) => {
      toastError({ title: 'Error confirming the suggestions', description: error.message })
    },
  })

  if (accountMap.isPending) return <EmptySection loading />

  if (accountMap.isError) {
    return (
      <div className='rounded-xl border border-destructive/40 bg-destructive/5 p-3'>
        <p className='font-medium text-sm'>Could not read the account map</p>
        <p className='text-muted-foreground text-xs'>{accountMap.error.message}</p>
      </div>
    )
  }

  const { rows, providerAccounts, broken, providerId } = accountMap.data

  // 🛑 Gate on the PROVIDER, not on an empty chart. "Nothing is connected" and
  // "connected but nothing mapped" are different answers needing different
  // actions, and collapsing them would tell somebody to map a chart that has
  // nothing to map against.
  if (providerId === 'none' || providerAccounts.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        No accounting system is connected, so there is nothing to map yet. Entries are still built,
        balanced and stored here.
      </p>
    )
  }

  const mapped = rows.filter((row) => row.state === 'confirmed')
  const suggested = rows.filter((row) => row.suggestion)
  const visible = compact ? rows.filter((row) => row.state !== 'confirmed' || isBroken(row)) : rows

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='font-medium text-foreground text-sm'>
          {mapped.length} of {rows.length} accounts mapped
        </span>
        {suggested.length > 0 && (
          <Button
            variant='outline'
            size='sm'
            loading={confirmSuggested.isPending}
            loadingText='Confirming...'
            onClick={() => confirmSuggested.mutate()}>
            <Sparkles />
            Confirm {suggested.length} suggestion{suggested.length === 1 ? '' : 's'}
          </Button>
        )}
      </div>

      {broken.length > 0 && (
        <div className='flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0 text-destructive' />
          <div className='min-w-0'>
            <p className='font-medium text-sm'>
              {broken.length} mapping{broken.length === 1 ? '' : 's'} no longer valid
            </p>
            <p className='text-muted-foreground text-xs'>
              {broken.join(', ')} point at accounts that have been removed, deactivated or moved to
              a different section. Every close refuses until they are re-mapped.
            </p>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Every account is mapped. Nothing here needs a decision.
        </p>
      ) : (
        <div className='overflow-hidden rounded-xl border'>
          <ul className='flex flex-col'>
            {visible.map((row) => (
              <li
                key={row.account.id}
                className='flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0'>
                <div className='flex min-w-0 flex-1 items-center gap-2'>
                  <span className='truncate font-medium'>{row.account.code}</span>
                  <span className='truncate text-muted-foreground'>{row.account.name}</span>
                  <Badge variant={accountTypeColor(row.account.accountType)} size='sm'>
                    {accountTypeLabel(row.account.accountType)}
                  </Badge>
                </div>

                <div className='flex min-w-0 flex-1 items-center justify-end gap-2'>
                  {row.state === 'confirmed' && !isBroken(row) ? (
                    <>
                      <span className='min-w-0 truncate text-muted-foreground'>
                        {row.providerAccountName}
                      </span>
                      <Button
                        variant='ghost'
                        size='sm'
                        title='Remove this mapping'
                        disabled={setAccountIdentity.isPending}
                        onClick={() =>
                          setAccountIdentity.mutate({
                            glAccountId: row.account.id,
                            providerAccountId: null,
                          })
                        }>
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      {row.suggestion && (
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={setAccountIdentity.isPending}
                          title={`Suggested by ${REASON_COPY[row.suggestion.reason]}`}
                          onClick={() =>
                            setAccountIdentity.mutate({
                              glAccountId: row.account.id,
                              providerAccountId: row.suggestion?.account.id,
                            })
                          }>
                          <Check />
                          {row.suggestion.account.fullyQualifiedName}
                        </Button>
                      )}
                      <Combobox
                        size='sm'
                        placeholder={row.suggestion ? 'Or pick...' : 'Pick an account'}
                        emptyText='No compatible account'
                        value={row.providerAccountId ?? undefined}
                        options={providerAccounts
                          .filter(
                            (account) =>
                              account.active && account.classification === row.account.accountType
                          )
                          .map((account) => ({
                            value: account.id,
                            label: account.number
                              ? `${account.number} · ${account.fullyQualifiedName}`
                              : account.fullyQualifiedName,
                          }))}
                        onChangeValue={(value) =>
                          setAccountIdentity.mutate({
                            glAccountId: row.account.id,
                            providerAccountId: value,
                          })
                        }
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className='text-muted-foreground text-xs'>
        A suggestion is a guess from the account number or name. Confirm it so a later rename or
        renumber on either side cannot quietly move where a role posts.
      </p>
    </div>
  )
}

/** A confirmed mapping whose target has gone, been deactivated, or changed section. */
function isBroken(row: AccountIdentityRow): boolean {
  if (row.state !== 'confirmed') return false
  const live = row.liveProviderAccount
  return !live || !live.active || live.classification !== row.account.accountType
}
