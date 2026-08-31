// apps/web/src/components/accounting/ui/settings/account-map-list.tsx
'use client'

// The `G19` account map: which account in the connected accounting system each
// of the org's own accounts corresponds to.
//
// 🛑 ONE home, since task 19: the setup wizard's mapping step. This used to be
// the Accounts settings page's third tab as well, and that tab is gone - the
// provider account is an attribute of a `gl_account`, so in settings it is a row
// in `chart-account-editor.tsx` beside the code, the name and the type, with the
// list-level half (counter, bulk accept, broken banner, badges) in
// `chart-list.tsx`.
//
// What survives here is the WIZARD's version, and the difference is the point:
// `compact` shows only what still needs a decision, because a wizard page
// answers "what is left" where settings answers "what is the state of things".
// `wizard-accounts-page.tsx` does the opposite again (a read-only summary
// linking to settings) because the ROLE map is a review, not a task. This one is
// a task: it is the step between connecting QuickBooks and being able to post,
// and sending somebody out of the wizard to do it is losing them at the exact
// moment they were going to finish.
//
// ── Why this list has no detail pane ────────────────────────────────────────
//
// `chart-list.tsx`'s row shape, deliberately - the same `TreeRow`, the same
// `code · name` title, the same badge-shaped `secondary`. What differs is the
// trailing slot: the chart's rows OPEN an editor, and these rows ARE the editor.
// A mapping is one value chosen from one list, so inside a wizard a detail pane
// would hold a single dropdown and cost a click to reach it. The picker lives in
// `actions`.
//
// That is also why no row is selectable and `onToggleOpen` is unset: a row click
// would have nothing to do, and with an interactive `actions` slot it would fire
// on every use of the picker.
//
// ⚠️ Two renderings of one map now exist, and that is accepted. The shared
// authority is the three `ledger` procedures, NOT this component:
// `setAccountIdentity` revalidates against the live provider chart before
// writing, whatever any picker was offering. `isMappingBroken` is shared for the
// same reason - it is the predicate a close refuses on.
//
// 🛑 A confirmation is a WRITE, and the picker only ever offers type-compatible
// active accounts. Both are conveniences, not authorities: `setAccountIdentity`
// re-checks existence, active status and classification against the LIVE
// provider chart before writing, because a picker rendered five minutes ago may
// be offering an account somebody has since deactivated. Filtering here keeps a
// person from being offered a choice that would be refused; it does not replace
// the refusal.

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Combobox } from '@auxx/ui/components/combobox'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Landmark, Link2, Sparkles, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import {
  ACCOUNT_SUGGESTION_REASON_COPY,
  accountTypeColor,
  accountTypeLabel,
  formatProviderAccount,
  isMappingBroken,
} from './accounts-types'

export interface AccountMapListProps {
  /**
   * Show only the rows that still need a decision. The wizard wants a short list
   * of what is left; settings wants the whole map, including what is settled.
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
 * | `confirmed` | somebody paired these two | change it, or unmap it |
 * | `unmapped` + suggestion | we found a likely match, and here is why | accept it, or pick another |
 * | `unmapped` | nothing plausible matched | pick one |
 *
 * ⚠️ A `confirmed` row whose `liveProviderAccount` is null is the DANGLING case
 * - the provider account was deleted or deactivated under a confirmed mapping -
 * and it renders as a repair rather than as a mapping. `G19` requires every
 * close to refuse on exactly these, so the screen has to lead with them.
 */
export function AccountMapList({ compact = false }: AccountMapListProps) {
  const [search, setSearch] = useState('')
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
      <EmptySection
        icon={<Link2 className='size-5' />}
        title='No accounting system connected'
        description='Entries are still built, balanced and stored here. There is just nothing to map them onto yet.'
      />
    )
  }

  const mapped = rows.filter((row) => row.state === 'confirmed')
  const suggested = rows.filter((row) => row.suggestion)

  const visible = (
    compact ? rows.filter((row) => row.state !== 'confirmed' || isMappingBroken(row)) : rows
  ).filter(
    (row) =>
      !search ||
      row.account.name.toLowerCase().includes(search.toLowerCase()) ||
      row.account.code.includes(search)
  )

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search accounts...'
          className='min-w-40 flex-1'
        />
        <span className='text-muted-foreground text-sm tabular-nums'>
          {mapped.length} of {rows.length} mapped
        </span>
        {suggested.length > 0 && (
          <Button
            variant='outline'
            size='sm'
            loading={confirmSuggested.isPending}
            loadingText='Confirming...'
            onClick={() => confirmSuggested.mutate()}>
            <Sparkles />
            Accept {suggested.length}
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
              {broken.join(', ')}{' '}
              {broken.length === 1
                ? 'points at an account that has'
                : 'point at accounts that have'}{' '}
              been removed, deactivated or moved to a different section. Every close refuses until{' '}
              {broken.length === 1 ? 'it is' : 'they are'} re-mapped.
            </p>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptySection
          icon={<Landmark className='size-5' />}
          title={search ? 'No matches' : 'Every account is mapped'}
          description={search ? undefined : 'Nothing here needs a decision.'}
        />
      ) : (
        // `TREE_SECONDARY_NOTRUNCATE`: TreeRow's `secondary` slot truncates by
        // default, which clips a Badge's pill edges and its ring. `secondary`
        // here is badge-shaped ONLY - the provider account's name lives in the
        // picker, which is the control that owns it - so this list wears the
        // class for the same reason `chart-list.tsx` does. Do not put a sentence
        // in `secondary` without taking it back off.
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          {visible.map((row) => {
            const brokenRow = isMappingBroken(row)
            const options = providerAccounts
              .filter(
                (account) => account.active && account.classification === row.account.accountType
              )
              .map((account) => ({ value: account.id, label: formatProviderAccount(account) }))

            return (
              <TreeRow
                key={row.account.id}
                icon={<Landmark className='size-4 text-muted-foreground' />}
                title={
                  <span className='flex items-baseline gap-2'>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {row.account.code}
                    </span>
                    <span className='text-sm'>{row.account.name}</span>
                  </span>
                }
                secondaryFill
                rowClassName={cn(
                  'bg-primary-100/50 hover:bg-primary-100',
                  brokenRow && 'ring-1 ring-destructive/40'
                )}
                secondary={
                  <span className='flex items-center gap-1.5'>
                    <Badge variant={accountTypeColor(row.account.accountType)} size='xs'>
                      {accountTypeLabel(row.account.accountType)}
                    </Badge>
                    {brokenRow ? (
                      <Badge variant='destructive' size='xs'>
                        Re-map
                      </Badge>
                    ) : row.state === 'unmapped' && !row.suggestion ? (
                      <Badge variant='outline' size='xs'>
                        Not mapped
                      </Badge>
                    ) : null}
                  </span>
                }
                actions={
                  <span className='flex items-center gap-1'>
                    {row.suggestion && (
                      <Button
                        variant='outline'
                        size='xs'
                        disabled={setAccountIdentity.isPending}
                        title={`Suggested by ${ACCOUNT_SUGGESTION_REASON_COPY[row.suggestion.reason]}`}
                        onClick={() =>
                          setAccountIdentity.mutate({
                            glAccountId: row.account.id,
                            providerAccountId: row.suggestion?.account.id,
                          })
                        }>
                        <Check />
                        <span className='max-w-32 truncate'>
                          {row.suggestion.account.fullyQualifiedName}
                        </span>
                      </Button>
                    )}
                    <Combobox
                      size='xs'
                      className='max-w-56'
                      placeholder={row.suggestion ? 'Or pick...' : 'Pick an account'}
                      emptyText='No compatible account'
                      value={row.providerAccountId ?? undefined}
                      options={options}
                      disabled={setAccountIdentity.isPending}
                      onChangeValue={(value) =>
                        setAccountIdentity.mutate({
                          glAccountId: row.account.id,
                          providerAccountId: value,
                        })
                      }
                    />
                    {row.state === 'confirmed' && (
                      <Button
                        variant='ghost'
                        size='xs'
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
                    )}
                  </span>
                }
              />
            )
          })}
        </div>
      )}

      <p className='text-muted-foreground text-xs'>
        A suggestion is a guess from the account number or name. Confirm it so a later rename or
        renumber on either side cannot quietly move where a role posts.
      </p>
    </div>
  )
}
