// apps/web/src/components/accounting/ui/settings/role-map-editor.tsx
'use client'

// The right pane of the Roles tab: pick the account a role points at, and say
// why one was suggested.
//
// 🛑 The picker only offers accounts whose statement classification matches
// `ROLE_ACCOUNT_TYPES[role]`. That is a CONVENIENCE, not an authority:
// `setRoleAssignment` performs the identical check server-side before writing
// anything, and refuses with a message naming the role, the account and both
// types. Filtering here keeps a person from being offered a choice that would be
// refused; it does not replace the refusal, and the server's sentence is what
// gets surfaced when one happens.
//
// The same filter is why an org may legitimately move `grni` from 2160 to 2155
// but may not point it at a revenue account: the resulting entry would still
// balance, so nothing downstream could ever detect it.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  type ChartAccountRow,
  ROLE_ACCOUNT_TYPES,
  type RoleAssignmentRow,
} from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { Ban, Check, RotateCcw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { AccountLabel } from '../account-label'
import { accountMatchesSearch } from '../account-label-format'
import {
  accountTypeColor,
  accountTypeLabel,
  DEFAULT_UNUSED_ROLES,
  formatAccount,
} from './accounts-types'

interface RoleMapEditorProps {
  role: AccountRole | null
  assignment: RoleAssignmentRow | undefined
  accounts: ChartAccountRow[]
  /** True while `ledger.chartAccounts` is in flight. */
  accountsLoading: boolean
  /** True while a `setRoleAssignment` write is in flight. */
  pending: boolean
  onAssign: (role: AccountRole, accountId: string) => void
  onToggleUnused: (role: AccountRole) => void
  /** `PermissionKey.ledgerControl`. False hides the account picker and the
   *  mark-unused / mark-used-again button - the role's current mapping and
   *  status stay visible. */
  canControl: boolean
}

export function RoleMapEditor({
  role,
  assignment,
  accounts,
  accountsLoading,
  pending,
  onAssign,
  onToggleUnused,
  canControl,
}: RoleMapEditorProps) {
  const [search, setSearch] = useState('')

  if (!role) {
    return (
      <div className='p-4 text-muted-foreground text-sm'>
        Select a role to choose the account it posts to.
      </div>
    )
  }

  const expectedType = ROLE_ACCOUNT_TYPES[role]
  const state = assignment?.state ?? 'unmapped'
  const currentId = assignment?.accountId ?? null

  const eligible = accounts.filter((account) => account.accountType === expectedType)
  const filtered = search
    ? eligible.filter((account) => accountMatchesSearch(account, search))
    : eligible

  const isDefaultUnused = DEFAULT_UNUSED_ROLES.includes(role)

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 p-3'>
      {/* `shrink-0 grow-0`: `FieldPanel` bakes `grow` into its own class list
          (field-panel.tsx:45), which is right in a page body and wrong here - this
          is a flex COLUMN, so it stretched three rows to fill 300px. */}
      <FieldPanel
        className='shrink-0 grow-0 p-0'
        resizeId='accounting-role-map'
        defaultLabelWidth={140}>
        <FieldPanelRow title='Role' type={BaseType.STRING} showIcon>
          <div className='flex min-h-8 items-center text-sm'>{ACCOUNT_ROLE_LABELS[role]}</div>
        </FieldPanelRow>
        <FieldPanelRow
          title='Account type'
          type={BaseType.ENUM}
          showIcon
          description='Declared per role and revalidated on every close, so only accounts of this type can be chosen.'>
          <div className='flex min-h-8 items-center'>
            {/* 🛑 The classification's own colour, not `outline`. This badge
                names the same five words the chart list and the roles tab
                colour from `GL_ACCOUNT_TYPE_META`, and rendering it grey here
                made "Equity" purple in one pane and colourless in the next. */}
            <Badge variant={accountTypeColor(expectedType)} size='xs'>
              {accountTypeLabel(expectedType)}
            </Badge>
          </div>
        </FieldPanelRow>
        <FieldPanelRow title='Status' type={BaseType.ENUM} showIcon>
          <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm'>
            {state === 'confirmed' && (
              <Badge variant='green' size='xs'>
                Confirmed
              </Badge>
            )}
            {state === 'suggested' && (
              <Badge variant='amber' size='xs'>
                <Sparkles className='size-3' />
                Suggested
              </Badge>
            )}
            {state === 'unmapped' && (
              <Badge variant='destructive' size='xs'>
                Not mapped
              </Badge>
            )}
            {state === 'unused' && (
              <Badge variant='outline' size='xs'>
                Unused
              </Badge>
            )}
          </div>
        </FieldPanelRow>
      </FieldPanel>

      {/* ⚠️ Chosen, then the account vanished. Not the same as unmapped, and the
          only state where a `confirmed` role still refuses a close. */}
      {state !== 'unmapped' && state !== 'unused' && !assignment?.account && (
        <Alert variant='destructive'>
          <AlertTitle>The account this role names is gone</AlertTitle>
          <AlertDescription>
            It has been archived or deleted since the mapping was made, and a role assignment
            deliberately carries no foreign key. Pick another account below - a close refuses on
            this until you do.
          </AlertDescription>
        </Alert>
      )}

      {state === 'suggested' && (
        <Alert variant='warning'>
          <AlertTitle>Why this was suggested</AlertTitle>
          <AlertDescription>
            The account number and the statement type both match what the seeded default chart
            assigns to this role, and no one has repointed it. That is a guess, not a decision.
            Confirm it by picking it below, so a close is not resting on an assumption nobody made.
          </AlertDescription>
        </Alert>
      )}

      {isDefaultUnused && state !== 'unused' && (
        <Alert variant='neutral'>
          <AlertTitle>Nothing emits this role today</AlertTitle>
          <AlertDescription>
            {role === 'ppv'
              ? 'Purchase price variance is a report, not a posting. Nothing accumulates in 5090 ' +
                'during the year, so no builder ever emits this role.'
              : 'Work in process is structurally zero. A received part maps to raw materials or ' +
                'to finished goods and never to work in process, so no movement can reach it.'}{' '}
            Marking it unused is the expected choice. A map that demanded every role would block
            every preview on two roles nothing can post to.
          </AlertDescription>
        </Alert>
      )}

      {state === 'unused' ? (
        <Alert variant='neutral'>
          <AlertDescription>This role is excused. Previews will not ask for it.</AlertDescription>
          {canControl && (
            <Button
              variant='outline'
              size='sm'
              loading={pending}
              className='mt-2 justify-self-start'
              onClick={() => onToggleUnused(role)}>
              <RotateCcw />
              Mark used again
            </Button>
          )}
        </Alert>
      ) : !canControl ? (
        <div className='rounded-xl border p-3'>
          <p className='text-muted-foreground text-xs'>Posts to</p>
          <p className='text-sm'>{currentId ? formatAccount(assignment?.account) : 'Not mapped'}</p>
        </div>
      ) : (
        <>
          {/* ⚠️ `InputSearch`'s own wrapper is `flex flex-1`, which means "fill the
              row" at every other call site and "grow to 200px tall" inside this
              flex column - which is what detached the magnifier from the input.
              Wrapping in a non-flex, non-growing box is the call-site fix; the
              shared component is correct for the row case and must not change. */}
          <div className='shrink-0'>
            <InputSearch
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${accountTypeLabel(expectedType).toLowerCase()} accounts...`}
            />
          </div>

          <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
            <div className='flex flex-col gap-0.5 pr-1'>
              {accountsLoading ? (
                <EmptySection loading />
              ) : filtered.length === 0 ? (
                <p className='p-3 text-center text-muted-foreground text-sm'>
                  {search
                    ? 'No matches.'
                    : `No ${accountTypeLabel(expectedType).toLowerCase()} accounts in the chart yet.`}
                </p>
              ) : (
                filtered.map((account) => (
                  <button
                    key={account.id}
                    type='button'
                    disabled={pending}
                    onClick={() => onAssign(role, account.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                      'hover:bg-primary-100 disabled:opacity-60',
                      currentId === account.id && 'bg-primary-100 ring-1 ring-primary-200'
                    )}>
                    <AccountLabel account={account} className='min-w-0 flex-1' />
                    {!account.isActive && (
                      <Badge variant='outline' size='xs' className='shrink-0'>
                        Inactive
                      </Badge>
                    )}
                    {currentId === account.id && (
                      <Check className='size-4 shrink-0 text-green-600' />
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          {/* 🛑 "Mark unused" is DISABLED while the role is unmapped, and says why.
              `GlRoleAssignment.glAccountId` is `NOT NULL`, so there is no row to
              flip and the server answers `NotFoundError` - a refusal that would
              read as a bug if the button offered it and then failed. Disabling it
              with the reason in view is the same information, before the click.

              There is no "Clear mapping" button any more: `setRoleAssignment` has
              exactly three modes (map / mark unused / clear the mark) and unset is
              not among them, because a role with no account is precisely the state
              a close refuses on. Repoint it, or excuse it. */}
          <div className='flex flex-col gap-2 border-t pt-3'>
            <Button
              variant='outline'
              size='sm'
              className='self-start'
              disabled={state === 'unmapped'}
              loading={pending}
              onClick={() => onToggleUnused(role)}>
              <Ban />
              Mark unused
            </Button>
            {state === 'unmapped' && (
              <p className='text-muted-foreground text-xs'>
                A role can only be excused once it names an account. Pick one above first, then mark
                it unused.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
