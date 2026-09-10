// apps/web/src/components/accounting/ui/settings/role-map-list.tsx
'use client'

// The `G19` role map: every posting role (`Object.values(ACCOUNT_ROLES).length`
// of them, across five chart packs - brief 16 §1), grouped by the statement
// classification each one's account must carry (13-accounting-ui.md §5.4).
//
// 🛑 A `TreeRow` PARENT per group with its rows nested inside it, not a
// `Section` wrapping a flat list. Both levels are then the same primitive, so
// the connector line draws the nesting instead of leaving it to be inferred
// from padding - and the group collapses, which a fixed `Section` header could
// not. The Chart tab is built the same way, for the same reason.
//
// ⚠️ Grouping is derived from `ROLE_ACCOUNT_TYPES`, which already declares the
// expected type per role, so no new constant is needed. The loop is written
// over all five statement types and drops the empty ones, so a type that has
// no roles today appears on its own the day one is added - which is why this
// comment does not name a count per group. It used to, and the counts were
// wrong within a release.
//
// 🛑 There are NO phantom drafts on this tab. The roles are a fixed vocabulary
// and a person cannot create one; adding a role is a code change to
// `ACCOUNT_ROLES`. What a person CAN do is provision the accounts a role's pack
// needs - the "Add accounts" button above the list, opening
// `chart-packs-dialog.tsx` (brief 16 §3.2).
//
// 🛑 The rows come from `ledger.roleMap`, which returns one row for EVERY role
// whether or not an assignment exists. That is what makes this a checklist, so
// this component renders whatever it is handed rather than filtering.
//
// ⚠️ No `TREE_SECONDARY_NOTRUNCATE` here, unlike the chart list. This list's
// `secondary` slot carries SENTENCES ("The account this role names is archived
// or gone"), and the class turns the slot's truncation off - which would let a
// sentence push the row wide instead of ellipsing. It belongs on a badge-shaped
// secondary only.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  type GlAccountTypeValue,
  ROLE_ACCOUNT_TYPES,
  type RoleAssignmentRow,
} from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Ban, Coins, CreditCard, Pencil, Plus, Receipt, RotateCcw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { AccountLabel } from '../account-label'
import { ACCOUNT_TYPE_OPTIONS, formatAccount } from './accounts-types'

/** Statement-section icon, one per group. */
const GROUP_ICONS: Record<string, typeof Coins> = {
  asset: Coins,
  liability: CreditCard,
  equity: Coins,
  revenue: Receipt,
  expense: Receipt,
}

interface RoleMapListProps {
  rows: RoleAssignmentRow[]
  /** True while `ledger.roleMap` is in flight. */
  isLoading: boolean
  selectedRole: AccountRole | null
  onSelect: (role: AccountRole) => void
  onToggleUnused: (role: AccountRole) => void
  /** Opens `chart-packs-dialog.tsx` (brief 16 §3.2). */
  onAddAccounts: () => void
  /** `PermissionKey.ledgerControl`. False hides the inline "Change account" /
   *  "Mark unused" / "Mark used again" `TreeRowButton`s, and the "Add accounts"
   *  toolbar button - selecting a row to read it stays available. */
  canControl: boolean
}

export function RoleMapList({
  rows,
  isLoading,
  selectedRole,
  onSelect,
  onToggleUnused,
  onAddAccounts,
  canControl,
}: RoleMapListProps) {
  const [search, setSearch] = useState('')
  // Collapsed groups by statement type. Open is the default: a role that needs
  // an account is the whole point of this screen, and a group that starts shut
  // hides the "Not mapped" badge the list exists to surface.
  const [collapsed, setCollapsed] = useState<GlAccountTypeValue[]>([])

  const toggleGroup = (type: GlAccountTypeValue) =>
    setCollapsed((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))

  if (isLoading) {
    // 🛑 A spinner, never every role rendered `unmapped`. "Not mapped - every preview
    // refuses until this is set" is an assertion about the organization, and
    // rendering it before the answer arrives makes it a false one.
    return (
      <div className='p-3'>
        <EmptySection loading />
      </div>
    )
  }

  // One row per role, recomputed per keystroke. A `useMemo` here would cost
  // more to read than the loop costs to run - same call `chart-list.tsx` makes.
  const needle = search.trim().toLowerCase()
  const filtered = needle
    ? rows.filter((row) => {
        const label = ACCOUNT_ROLE_LABELS[row.role as AccountRole] ?? row.role
        // The ACCOUNT is searchable too, not just the role. "which role posts
        // to 1100" is the question this list is read backwards to answer, and
        // matching the role name alone cannot answer it.
        return (
          label.toLowerCase().includes(needle) ||
          row.role.toLowerCase().includes(needle) ||
          formatAccount(row.account).toLowerCase().includes(needle)
        )
      })
    : rows

  return (
    <div className='flex flex-col gap-4 p-3'>
      {/* The Chart tab's toolbar exactly: search fills the row, the one button
          sits beside it. Two tabs of one page reading differently is what this
          screen kept doing. */}
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search roles and accounts...'
          className='flex-1'
        />
        {canControl && (
          <Button variant='outline' size='sm' className='shrink-0' onClick={onAddAccounts}>
            <Plus />
            Add accounts
          </Button>
        )}
      </div>

      {/* 🛑 Gate on the SEARCH, not on the row count. An empty result from a
          search and an org with no roles are different answers, and the second
          cannot happen - `ledger.roleMap` returns a row per role always. */}
      {needle && filtered.length === 0 && (
        <EmptySection icon={<Coins className='size-5' />} title='No matches' />
      )}

      {/* 🛑 A `TreeRow` parent per statement type, not a `Section`. The rows
          under it are `TreeRow`s, so a `Section` wrapping them made the group
          header and its children two different primitives with two different
          indents and no connector between them - the nesting had to be inferred
          from the padding. A parent row draws the line to its own children. */}
      <div className='flex flex-col gap-0.5'>
        {ACCOUNT_TYPE_OPTIONS.map(({ value: type, label }) => {
          const group = filtered.filter(
            (row) => ROLE_ACCOUNT_TYPES[row.role as AccountRole] === type
          )
          // Equity and revenue have no roles today, and an empty group headed
          // "no roles here" would be noise rather than information.
          if (group.length === 0) return null

          const Icon = GROUP_ICONS[type] ?? Coins
          const needed = group.filter((row) => row.state !== 'unused')
          const mapped = needed.filter(
            (row) => row.state === 'confirmed' || row.state === 'suggested'
          )

          return (
            <TreeRow
              key={type}
              expandable
              // 🛑 A search FORCES every group open. `filtered` has already
              // dropped the rows that do not match, so a collapsed group would
              // hide the very hits the search just found and read as "no
              // results" while holding some.
              isOpen={!!needle || !collapsed.includes(type)}
              onToggleOpen={() => toggleGroup(type)}
              icon={<Icon className='size-4 text-muted-foreground' />}
              title={<span className='truncate font-medium text-sm'>{label}</span>}
              secondary={
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {mapped.length} of {needed.length} mapped
                </span>
              }>
              <TreeRowList
                items={group}
                getKey={(row: RoleAssignmentRow) => row.role}
                renderRow={(row: RoleAssignmentRow) => (
                  <RoleRow
                    row={row}
                    selected={selectedRole === row.role}
                    onSelect={onSelect}
                    onToggleUnused={onToggleUnused}
                    canControl={canControl}
                  />
                )}
              />
            </TreeRow>
          )
        })}
      </div>
    </div>
  )
}

function RoleRow({
  row,
  selected,
  onSelect,
  onToggleUnused,
  canControl,
}: {
  row: RoleAssignmentRow
  selected: boolean
  onSelect: (role: AccountRole) => void
  onToggleUnused: (role: AccountRole) => void
  canControl: boolean
}) {
  const role = row.role as AccountRole
  const Icon = GROUP_ICONS[ROLE_ACCOUNT_TYPES[role]] ?? Coins

  return (
    <TreeRow
      depth={1}
      icon={<Icon className='size-4 text-muted-foreground' />}
      title={ACCOUNT_ROLE_LABELS[role] ?? row.role}
      secondaryFill
      onToggleOpen={() => onSelect(role)}
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        selected && 'bg-primary-100 ring-1 ring-primary-200',
        row.state === 'unused' && 'opacity-60'
      )}
      secondary={<AssignmentSecondary row={row} />}
      actions={
        // Always `TreeRowButton`, never a raw icon Button: it owns the
        // hover-fade, the sizing and the tooltip side, and it stops the click
        // from reaching the row's own `onToggleOpen`. Absent entirely for a
        // viewer without `ledgerControl` - selecting the row to read it still
        // works through `onToggleOpen` above.
        canControl && (
          <div className='flex items-center gap-1'>
            {row.state !== 'unused' && (
              <TreeRowButton tooltipText='Change account' onClick={() => onSelect(role)}>
                <Pencil />
              </TreeRowButton>
            )}
            {/* 🛑 No "mark unused" on an UNMAPPED role. `GlRoleAssignment.glAccountId`
                is `NOT NULL`, so there is no row to flip and the server answers
                `NotFoundError`. Offering the button and toasting a 404 would read as
                a bug; the editor pane renders it disabled beside the reason, which
                is where somebody looking for it will be. */}
            {row.state !== 'unmapped' && (
              <TreeRowButton
                tooltipText={
                  row.state === 'unused'
                    ? 'Mark used again'
                    : 'Mark unused. Nothing posts to it, so it stops blocking a preview.'
                }
                onClick={() => onToggleUnused(role)}>
                {row.state === 'unused' ? <RotateCcw /> : <Ban />}
              </TreeRowButton>
            )}
          </div>
        )
      }
    />
  )
}

/**
 * The mapped account, or why there isn't one.
 *
 * ⚠️ A suggested match reads visibly differently from a confirmed one. A
 * suggestion is auxx's guess from the seeded default chart; nobody has agreed
 * to it, and `resolveRoles` will happily post to whatever it names.
 *
 * ⚠️ `confirmed` with no account is a real state and it is not the same as
 * `unmapped`: somebody chose an account and it has since been archived or
 * deleted out from under the mapping. `listRoleMap` returns exactly that, and it
 * is the repair `resolveRoles` would otherwise refuse a close over.
 */
function AssignmentSecondary({ row }: { row: RoleAssignmentRow }) {
  // 🛑 EVERY state's consequence lives in its badge's tooltip, never beside it.
  // The badge already says the state and its colour already says the severity;
  // what a badge cannot carry is WHY, which is what a tooltip is for. Spelling
  // the consequence out on each row turned the sentences that matter into
  // wallpaper - on a fresh org most of this list said "every preview refuses
  // until this is set", one row after another.
  //
  // ⚠️ The `p-[1px]` wrapper is load-bearing, not spacing. `Badge` draws its
  // edge as `ring-1 ring-current/35`, and a ring renders OUTSIDE the box; this
  // secondary slot is `overflow-hidden` because it truncates, so a badge flush
  // against the slot loses the ring on whichever side it touches. One pixel
  // gives the ring somewhere to land.
  if (row.state === 'unused') {
    return (
      <span className='flex items-center gap-1.5 text-xs'>
        <Tooltip content='Nothing posts to this role'>
          <div className='p-[1px]'>
            <Badge variant='outline' size='xs'>
              Unused
            </Badge>
          </div>
        </Tooltip>
      </span>
    )
  }

  if (row.state === 'unmapped') {
    return (
      <span className='flex items-center gap-1.5 text-xs'>
        <Tooltip content='Every preview refuses until this is set'>
          <div className='p-[1px]'>
            <Badge variant='destructive' size='xs'>
              Not mapped
            </Badge>
          </div>
        </Tooltip>
      </span>
    )
  }

  if (!row.account) {
    return (
      <span className='flex items-center gap-1.5 text-xs'>
        <Tooltip content='The account this role names is archived or gone. Pick another.'>
          <div className='p-[1px]'>
            <Badge variant='destructive' size='xs'>
              Account missing
            </Badge>
          </div>
        </Tooltip>
      </span>
    )
  }

  if (row.state === 'suggested') {
    return (
      <span className='flex min-w-0 items-center gap-1.5 text-xs'>
        <Badge variant='amber' size='xs' className='shrink-0'>
          <Sparkles className='size-3' />
          Suggested
        </Badge>
        <AccountLabel
          account={row.account}
          density='compact'
          className='text-amber-700 dark:text-amber-400'
        />
      </span>
    )
  }

  return (
    <AccountLabel
      account={row.account}
      density='compact'
      className='text-muted-foreground text-xs'
    />
  )
}
