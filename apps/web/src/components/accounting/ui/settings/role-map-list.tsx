// apps/web/src/components/accounting/ui/settings/role-map-list.tsx
'use client'

// The `G19` role map: the thirteen posting roles, grouped by the statement
// classification each one's account must carry (13-accounting-ui.md §5.4).
//
// 🛑 A `Section` per group with a FLAT `TreeRow` list, not nested `TreeRow`
// depth. The tree is two levels and a parent row would add a chevron that
// answers nothing.
//
// ⚠️ Grouping is derived from `ROLE_ACCOUNT_TYPES`, which already declares the
// expected type per role, so no new constant is needed. Note what it yields
// today: asset 4, liability 5, expense 4. There are no revenue and no equity
// roles, so only three of the five groups render. The loop is written over all
// five anyway, so the day a revenue role is added it appears on its own.
//
// 🛑 There are NO phantom drafts on this tab. The thirteen roles are a fixed
// vocabulary and a person cannot create one; adding a role is a code change to
// `ACCOUNT_ROLES`.
//
// 🛑 The rows come from `ledger.roleMap`, which returns one row for EVERY role
// whether or not an assignment exists. That is what makes this a checklist, so
// this component renders whatever it is handed rather than filtering.
//
// ⚠️ No `TREE_SECONDARY_NOTRUNCATE` here, unlike the chart list. This list's
// `secondary` slot carries a SENTENCE ("Every preview refuses until this is
// set"), and the class turns the slot's truncation off - which would let the
// sentence push the row wide instead of ellipsing. It belongs on a badge-shaped
// secondary only.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  ROLE_ACCOUNT_TYPES,
  type RoleAssignmentRow,
} from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Ban, Coins, CreditCard, Pencil, Receipt, RotateCcw, Sparkles } from 'lucide-react'
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
}

export function RoleMapList({
  rows,
  isLoading,
  selectedRole,
  onSelect,
  onToggleUnused,
}: RoleMapListProps) {
  if (isLoading) {
    // 🛑 A spinner, never thirteen `unmapped` rows. "Not mapped - every preview
    // refuses until this is set" is an assertion about the organization, and
    // rendering it before the answer arrives makes it a false one.
    return (
      <div className='p-3'>
        <EmptySection loading />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4 p-3'>
      {ACCOUNT_TYPE_OPTIONS.map(({ value: type, label }) => {
        const group = rows.filter((row) => ROLE_ACCOUNT_TYPES[row.role as AccountRole] === type)
        // Equity and revenue have no roles today, and an empty section headed
        // "no roles here" would be noise rather than information.
        if (group.length === 0) return null

        const Icon = GROUP_ICONS[type] ?? Coins
        const needed = group.filter((row) => row.state !== 'unused')
        const mapped = needed.filter(
          (row) => row.state === 'confirmed' || row.state === 'suggested'
        )

        return (
          <Section
            key={type}
            collapsible={false}
            icon={<Icon className='size-4' />}
            title={label}
            secondary={`${mapped.length} of ${needed.length} mapped`}>
            <div className='flex flex-col gap-0.5'>
              {group.map((row) => (
                <RoleRow
                  key={row.role}
                  row={row}
                  selected={selectedRole === row.role}
                  onSelect={onSelect}
                  onToggleUnused={onToggleUnused}
                />
              ))}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

function RoleRow({
  row,
  selected,
  onSelect,
  onToggleUnused,
}: {
  row: RoleAssignmentRow
  selected: boolean
  onSelect: (role: AccountRole) => void
  onToggleUnused: (role: AccountRole) => void
}) {
  const role = row.role as AccountRole
  const Icon = GROUP_ICONS[ROLE_ACCOUNT_TYPES[role]] ?? Coins

  return (
    <TreeRow
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
        // from reaching the row's own `onToggleOpen`.
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
  if (row.state === 'unused') {
    return (
      <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
        <Badge variant='outline' size='xs'>
          Unused
        </Badge>
        Nothing posts to this role
      </span>
    )
  }

  if (row.state === 'unmapped') {
    return (
      <span className='flex items-center gap-1.5 text-xs'>
        <Badge variant='destructive' size='xs'>
          Not mapped
        </Badge>
        <span className='text-muted-foreground'>Every preview refuses until this is set</span>
      </span>
    )
  }

  if (!row.account) {
    return (
      <span className='flex items-center gap-1.5 text-xs'>
        <Badge variant='destructive' size='xs'>
          Account missing
        </Badge>
        <span className='text-muted-foreground'>
          The account this role names is archived or gone. Pick another.
        </span>
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
        <span className='truncate text-amber-700 dark:text-amber-400'>
          {formatAccount(row.account)}
        </span>
      </span>
    )
  }

  return (
    <span className='truncate text-muted-foreground text-xs'>{formatAccount(row.account)}</span>
  )
}
