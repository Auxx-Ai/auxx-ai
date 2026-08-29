// apps/web/src/components/accounting/ui/settings/role-map-editor.tsx
'use client'

// The right pane of the Roles tab: pick the account a role points at, and say
// why one was suggested.
//
// 🛑 The picker only offers accounts whose statement classification matches
// `ROLE_ACCOUNT_TYPES[role]`. That expectation is DECLARED, never derived from
// the chart, and `resolveRoles` fails closed on a mismatch naming the role, the
// account and both types. An org may legitimately move `grni` from 2160 to
// 2155; it may not point it at a revenue account, because the resulting entry
// would still balance and nothing downstream could detect it.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  ROLE_ACCOUNT_TYPES,
} from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Ban, Check, RotateCcw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import {
  accountTypeLabel,
  type ChartAccount,
  DEFAULT_UNUSED_ROLES,
  type RoleAssignment,
} from './accounts-types'

interface RoleMapEditorProps {
  role: AccountRole | null
  assignment: RoleAssignment | undefined
  accounts: ChartAccount[]
  onAssign: (role: AccountRole, accountId: string) => void
  onClear: (role: AccountRole) => void
  onToggleUnused: (role: AccountRole) => void
}

export function RoleMapEditor({
  role,
  assignment,
  accounts,
  onAssign,
  onClear,
  onToggleUnused,
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
    ? eligible.filter(
        (account) =>
          account.name.toLowerCase().includes(search.toLowerCase()) || account.code.includes(search)
      )
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
            <Badge variant='outline' size='xs'>
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

      {state === 'suggested' && (
        <div className='space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3'>
          <p className='font-medium text-sm'>Why this was suggested</p>
          <p className='text-muted-foreground text-xs'>
            The account number and the statement type both match what the seeded default chart
            assigns to this role, and no one has repointed it. That is a guess, not a decision.
            Confirm it by picking it below, so a close is not resting on an assumption nobody made.
          </p>
        </div>
      )}

      {isDefaultUnused && state !== 'unused' && (
        <div className='space-y-1 rounded-xl border p-3'>
          <p className='font-medium text-sm'>Nothing emits this role today</p>
          <p className='text-muted-foreground text-xs'>
            {role === 'ppv'
              ? 'Purchase price variance is a report, not a posting. Nothing accumulates in 5090 ' +
                'during the year, so no builder ever emits this role.'
              : 'Work in process is structurally zero. A received part maps to raw materials or ' +
                'to finished goods and never to work in process, so no movement can reach it.'}{' '}
            Marking it unused is the expected choice. A map that demanded all thirteen would block
            every preview on two roles nothing can post to.
          </p>
        </div>
      )}

      {state === 'unused' ? (
        <div className='space-y-2 rounded-xl border p-3'>
          <p className='text-muted-foreground text-sm'>
            This role is excused. Previews will not ask for it.
          </p>
          <Button variant='outline' size='sm' onClick={() => onToggleUnused(role)}>
            <RotateCcw />
            Mark used again
          </Button>
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
              {filtered.length === 0 ? (
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
                    onClick={() => onAssign(role, account.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                      'hover:bg-primary-100',
                      currentId === account.id && 'bg-primary-100 ring-1 ring-primary-200'
                    )}>
                    <span className='w-14 shrink-0 text-muted-foreground tabular-nums'>
                      {account.code}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>{account.name}</span>
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

          <div className='flex flex-wrap gap-2 border-t pt-3'>
            <Button variant='ghost' size='sm' disabled={!currentId} onClick={() => onClear(role)}>
              Clear mapping
            </Button>
            <Button variant='outline' size='sm' onClick={() => onToggleUnused(role)}>
              <Ban />
              Mark unused
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
