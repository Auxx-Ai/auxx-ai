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

import {
  ACCOUNT_ROLE_LABELS,
  ACCOUNT_ROLES,
  type AccountRole,
  ROLE_ACCOUNT_TYPES,
} from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Section } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Ban, Coins, CreditCard, Eraser, Pencil, Receipt, RotateCcw, Sparkles } from 'lucide-react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import {
  ACCOUNT_TYPE_OPTIONS,
  type ChartAccount,
  formatAccount,
  type RoleAssignment,
} from './accounts-types'

const ALL_ROLES = Object.values(ACCOUNT_ROLES) as AccountRole[]

/** Statement-section icon, one per group. */
const GROUP_ICONS: Record<string, typeof Coins> = {
  asset: Coins,
  liability: CreditCard,
  equity: Coins,
  revenue: Receipt,
  expense: Receipt,
}

const QUICKBOOKS_APP_SLUG = 'quickbooks'

interface RoleMapListProps {
  assignments: Record<string, RoleAssignment>
  accountsById: Map<string, ChartAccount>
  selectedRole: AccountRole | null
  onSelect: (role: AccountRole) => void
  onClear: (role: AccountRole) => void
  onToggleUnused: (role: AccountRole) => void
}

export function RoleMapList({
  assignments,
  accountsById,
  selectedRole,
  onSelect,
  onClear,
  onToggleUnused,
}: RoleMapListProps) {
  return (
    <div className='flex flex-col gap-4 p-3'>
      <ProviderStatusSection />

      {ACCOUNT_TYPE_OPTIONS.map(({ value: type, label }) => {
        const roles = ALL_ROLES.filter((role) => ROLE_ACCOUNT_TYPES[role] === type)
        // Equity and revenue have no roles today, and an empty section headed
        // "no roles here" would be noise rather than information.
        if (roles.length === 0) return null

        const Icon = GROUP_ICONS[type] ?? Coins
        const needed = roles.filter((role) => assignments[role]?.state !== 'unused')
        const mapped = needed.filter((role) => {
          const state = assignments[role]?.state
          return state === 'confirmed' || state === 'suggested'
        })

        return (
          <Section
            key={type}
            collapsible={false}
            icon={<Icon className='size-4' />}
            title={label}
            secondary={`${mapped.length} of ${needed.length} mapped`}>
            <div className='flex flex-col gap-0.5'>
              {roles.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  assignment={assignments[role]}
                  account={
                    assignments[role]?.accountId
                      ? accountsById.get(assignments[role].accountId as string)
                      : undefined
                  }
                  selected={selectedRole === role}
                  onSelect={onSelect}
                  onClear={onClear}
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
  role,
  assignment,
  account,
  selected,
  onSelect,
  onClear,
  onToggleUnused,
}: {
  role: AccountRole
  assignment: RoleAssignment | undefined
  account: ChartAccount | undefined
  selected: boolean
  onSelect: (role: AccountRole) => void
  onClear: (role: AccountRole) => void
  onToggleUnused: (role: AccountRole) => void
}) {
  const state = assignment?.state ?? 'unmapped'
  const Icon = GROUP_ICONS[ROLE_ACCOUNT_TYPES[role]] ?? Coins

  return (
    <TreeRow
      icon={<Icon className='size-4 text-muted-foreground' />}
      title={ACCOUNT_ROLE_LABELS[role]}
      secondaryFill
      onToggleOpen={() => onSelect(role)}
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        selected && 'bg-primary-100 ring-1 ring-primary-200',
        state === 'unused' && 'opacity-60'
      )}
      secondary={<AssignmentSecondary state={state} account={account} />}
      actions={
        // Always `TreeRowButton`, never a raw icon Button: it owns the
        // hover-fade, the sizing and the tooltip side, and it stops the click
        // from reaching the row's own `onToggleOpen`.
        <div className='flex items-center gap-1'>
          {state !== 'unused' && (
            <TreeRowButton tooltipText='Change account' onClick={() => onSelect(role)}>
              <Pencil />
            </TreeRowButton>
          )}
          {account && state !== 'unused' && (
            <TreeRowButton tooltipText='Clear mapping' onClick={() => onClear(role)}>
              <Eraser />
            </TreeRowButton>
          )}
          <TreeRowButton
            tooltipText={
              state === 'unused'
                ? 'Mark used again'
                : 'Mark unused. Nothing posts to it, so it stops blocking a preview.'
            }
            onClick={() => onToggleUnused(role)}>
            {state === 'unused' ? <RotateCcw /> : <Ban />}
          </TreeRowButton>
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
 */
function AssignmentSecondary({
  state,
  account,
}: {
  state: RoleAssignment['state']
  account: ChartAccount | undefined
}) {
  if (state === 'unused') {
    return (
      <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
        <Badge variant='outline' size='xs'>
          Unused
        </Badge>
        Nothing posts to this role
      </span>
    )
  }

  if (!account) {
    return (
      <span className='flex items-center gap-1.5 text-xs'>
        <Badge variant='destructive' size='xs'>
          Not mapped
        </Badge>
        <span className='text-muted-foreground'>Every preview refuses until this is set</span>
      </span>
    )
  }

  if (state === 'suggested') {
    return (
      <span className='flex min-w-0 items-center gap-1.5 text-xs'>
        <Badge variant='amber' size='xs' className='shrink-0'>
          <Sparkles className='size-3' />
          Suggested
        </Badge>
        <span className='truncate text-amber-700 dark:text-amber-400'>
          {formatAccount(account)}
        </span>
      </span>
    )
  }

  return <span className='truncate text-muted-foreground text-xs'>{formatAccount(account)}</span>
}

/**
 * Whether an accounting provider is connected.
 *
 * 🛑 "None connected" is a NORMAL state, not a warning. `NoneAccountingProvider`
 * makes it first class: the entry is still built, balanced and persisted, and
 * the result is `not_connected` rather than a failure. Nagging for a provider
 * here would contradict the decision the whole poster is built on.
 */
function ProviderStatusSection() {
  const { appInstallations, appConnections } = useAppsContext()

  const installation = appInstallations.find((inst) => inst.app.slug === QUICKBOOKS_APP_SLUG)
  const connected = installation
    ? appConnections.some(
        (conn) => conn.appId === installation.app.id && conn.connectionStatus === 'connected'
      )
    : false

  return (
    <Section
      collapsible={false}
      icon={<CreditCard className='size-4' />}
      title='Accounting provider'
      secondary={connected ? 'QuickBooks Online' : 'None connected'}>
      <div className='rounded-xl border p-3 text-sm'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant={connected ? 'green' : 'outline'} size='xs'>
            {connected ? 'Connected' : 'None connected'}
          </Badge>
          <span className='text-muted-foreground text-xs'>
            {connected
              ? 'Posted entries are mirrored into QuickBooks Online and carry a deep link back.'
              : 'Entries are still built, balanced and stored here. Nothing is blocked by this.'}
          </span>
        </div>
      </div>
    </Section>
  )
}
