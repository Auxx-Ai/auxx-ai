// apps/web/src/components/accounting/ui/settings/chart-packs-dialog.tsx
'use client'

// "Add accounts" on the Roles tab (brief 16 §3.2): pick one or more chart
// packs and provision them, without going through the wizard again.
//
// One `TreeRow` per `CHART_PACK_KEYS` entry, in declaration order (`core`
// first - though `core` reads `provisioned` on any org that has ever mapped a
// role and therefore never renders a checkbox). `packState` (from
// `@auxx/lib/postings/client`, derived on the client from `roleMap` and
// `CHART_PACKS` - no new query) decides how a row reads:
//
// - `provisioned` - disabled, with a check. Nothing left for this pack to add.
// - `partial` - a sentence naming which of its roles are still unmapped, and a
//   checkbox: re-provisioning is a no-op on what is already mapped
//   (`seedChartPacks`'s rules 1, 3, 4) and fills only the gap.
// - `absent` - a plain checkbox.
//
// 🛑 `requires` is explained ON the row, not hidden in a tooltip - checking
// `purchasing` submits `inventory` too (`resolveSelectedPacks`,
// `accounts-types.ts`), and a person choosing it needs to see that BEFORE
// pressing Confirm, not discover it afterwards on the chart.
//
// 🛑 No success toast (CLAUDE.md). Provisioning is additive and idempotent, so
// there is nothing here for `useConfirm` to gate.

import {
  ACCOUNT_ROLE_LABELS,
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPackKey,
  packState,
  type RoleAssignmentRow,
} from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Landmark } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { forcedPacks, resolveSelectedPacks } from './accounts-types'

interface ChartPacksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleMap: RoleAssignmentRow[]
}

export function ChartPacksDialog({ open, onOpenChange, roleMap }: ChartPacksDialogProps) {
  const utils = api.useUtils()
  const [selected, setSelected] = useState<Set<ChartPackKey>>(new Set())

  // A fresh open starts with nothing picked - the picker does not remember
  // what somebody chose and cancelled last time.
  useEffect(() => {
    if (open) setSelected(new Set())
  }, [open])

  const provisionChart = api.ledger.provisionChart.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.ledger.roleMap.invalidate(),
        utils.ledger.chartAccounts.invalidate(),
      ])
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error adding accounts', description: error.message })
    },
  })

  const forced = forcedPacks(selected)
  const packsToSubmit = resolveSelectedPacks(selected)

  function toggle(key: ChartPackKey, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Add accounts'
          description='Provision a chart pack. Each pack points its roles at new accounts and never touches one you already mapped.'
          crumbs={[{ label: 'Add accounts' }]}
        />

        <div className={cn('flex flex-col gap-0.5 p-3', TREE_SECONDARY_NOTRUNCATE)}>
          {CHART_PACK_KEYS.map((key) => (
            <PackRow
              key={key}
              packKey={key}
              roleMap={roleMap}
              checked={selected.has(key) || forced.has(key)}
              forced={forced.has(key)}
              onToggle={(checked) => toggle(key, checked)}
            />
          ))}
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={provisionChart.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={() => provisionChart.mutate({ packs: packsToSubmit })}
            variant='outline'
            size='sm'
            loading={provisionChart.isPending}
            loadingText='Adding...'
            disabled={packsToSubmit.length === 0}
            data-dialog-submit>
            Add accounts <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PackRowProps {
  packKey: ChartPackKey
  roleMap: RoleAssignmentRow[]
  /** Checked because it was picked directly, or forced on by `requires`. */
  checked: boolean
  /** Forced on by another selected pack's `requires` - shown checked, not toggleable. */
  forced: boolean
  onToggle: (checked: boolean) => void
}

function PackRow({ packKey, roleMap, checked, forced, onToggle }: PackRowProps) {
  const pack = CHART_PACKS[packKey]
  const state = packState(packKey, roleMap)

  const roles = pack.accounts.flatMap((account) => (account.role ? [account.role] : []))
  const rowsByRole = new Map(roleMap.map((row) => [row.role, row]))
  const unmapped = roles.filter(
    (role) => (rowsByRole.get(role)?.state ?? 'unmapped') === 'unmapped'
  )

  const requiresNote =
    pack.requires && pack.requires.length > 0
      ? `Also adds ${pack.requires.map((req) => CHART_PACKS[req].label).join(', ')}.`
      : null

  const secondaryParts: string[] = []
  if (state === 'partial') {
    secondaryParts.push(
      `Not mapped: ${unmapped.map((role) => ACCOUNT_ROLE_LABELS[role]).join(', ')}`
    )
  } else {
    secondaryParts.push(`${pack.accounts.length} accounts`)
  }
  if (requiresNote) secondaryParts.push(requiresNote)

  return (
    <TreeRow
      icon={<Landmark className='size-4 text-muted-foreground' />}
      title={pack.label}
      description={pack.description}
      secondary={
        <span className='text-muted-foreground text-xs'>{secondaryParts.join(' · ')}</span>
      }
      secondaryFill
      rowClassName={cn('hover:bg-primary-100', state === 'provisioned' && 'opacity-70')}
      actions={
        state === 'provisioned' ? (
          <Badge variant='green' size='xs'>
            <Check className='size-3' />
            Provisioned
          </Badge>
        ) : (
          <Checkbox
            checked={checked}
            disabled={forced}
            onCheckedChange={(value) => onToggle(value === true)}
            aria-label={`Add the ${pack.label} pack`}
          />
        )
      }
    />
  )
}
