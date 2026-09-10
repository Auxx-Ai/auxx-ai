// apps/web/src/components/accounting/ui/settings/chart-packs-dialog.tsx
'use client'

// "From catalogue" - the door onto the standard chart, from both tabs of
// Accounting > Settings > Accounts (brief 16 §3.2).
//
// 🛑 SELECTION IS BY ACCOUNT, NOT BY PACK. A pack is the unit the SEEDER walks
// and the unit `provisionChart` takes; it is not a fine enough unit for a
// person who wants Deferred Revenue and not Customer Deposits. Checking a pack
// row is shorthand for checking every account under it - the footer counts
// accounts, and `ledger.adoptChartAccounts` takes codes. The pack pages remain
// how the catalogue is ORGANISED, which is a different job from how it is
// chosen.
//
// 🛑 Two pages through `DialogNavPages` (ui-design-guide §6), never conditional
// rendering under a hand-rolled header: the packs list, and one pack's
// accounts. Drilling in is what makes per-account selection possible at all -
// the whole catalogue as one flat ungrouped list is something nobody reads,
// and a pack row that cannot be opened cannot tell you what you are accepting.
//
// 🛑 `requires` is stated ON the row and resolved on selection, not hidden in a
// tooltip: checking Purchase orders also checks Inventory's accounts
// (`resolveSelectedPacks`, `accounts-types.ts`), and a person needs to see that
// before pressing Add, not discover it afterwards on the chart.
//
// 🛑 No success toast (CLAUDE.md). Adopting is additive and idempotent, so
// there is nothing here for `useConfirm` to gate either.

import type { ChartAccountRow } from '@auxx/lib/postings/client'
import {
  ACCOUNT_ROLE_LABELS,
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPackKey,
  type DefaultChartAccount,
} from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Landmark } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { accountTypeColor, accountTypeLabel, forcedPacks } from './accounts-types'

interface ChartPacksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The org's live chart. Which catalogue codes are ALREADY here is read from
   * this rather than from the role map: a code is either in the chart or it is
   * not, where a role can be mapped to an account the catalogue never named.
   */
  accounts: ChartAccountRow[]
}

/** `'packs'` is the list; anything else is that pack's accounts. */
type Page = 'packs' | ChartPackKey

export function ChartPacksDialog({ open, onOpenChange, accounts }: ChartPacksDialogProps) {
  const utils = api.useUtils()
  const [page, setPage] = useState<Page>('packs')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // A fresh open starts on the list with nothing picked - the dialog does not
  // remember what somebody chose and cancelled last time (ui-design-guide §6).
  useEffect(() => {
    if (open) {
      setPage('packs')
      setSelected(new Set())
    }
  }, [open])

  /** Every catalogue code the org already holds. */
  const present = useMemo(
    () => new Set(accounts.flatMap((account) => (account.code ? [account.code] : []))),
    [accounts]
  )

  const adopt = api.ledger.adoptChartAccounts.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.ledger.chartAccounts.invalidate(),
        utils.ledger.roleMap.invalidate(),
      ])
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error adding accounts', description: error.message })
    },
  })

  /**
   * Which packs a selection implies, so `requires` can be honoured on a
   * per-account picker: any account of `purchasing` checked means `inventory`
   * comes too. Derived from the SELECTION rather than from checked pack rows,
   * because a person can reach the same state either way.
   */
  const impliedPacks = useMemo(() => {
    const packs = new Set<ChartPackKey>()
    for (const key of CHART_PACK_KEYS) {
      if (CHART_PACKS[key].accounts.some((account) => selected.has(account.code))) packs.add(key)
    }
    return packs
  }, [selected])

  const forced = useMemo(() => forcedPacks(impliedPacks), [impliedPacks])

  /**
   * The codes actually sent: everything checked, plus every still-missing
   * account of a pack forced on by `requires`.
   *
   * 🛑 Resolved HERE and not on the server, so the count in the footer and the
   * write can never disagree - the same reason `resolveSelectedPacks` resolves
   * the pack cascade on the client.
   */
  const codesToSubmit = useMemo(() => {
    const codes = new Set(selected)
    for (const key of forced) {
      for (const account of CHART_PACKS[key].accounts) {
        if (!present.has(account.code)) codes.add(account.code)
      }
    }
    return [...codes]
  }, [selected, forced, present])

  function toggleCodes(codes: readonly string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const code of codes) {
        if (checked) next.add(code)
        else next.delete(code)
      }
      return next
    })
  }

  const openPack = page === 'packs' ? null : CHART_PACKS[page]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Add accounts from the catalogue'
          description='The standard chart, grouped the way it is provisioned. Take a whole group or pick single accounts - nothing you already have is touched.'
          crumbs={[
            {
              label: 'Catalogue',
              onClick: page === 'packs' ? undefined : () => setPage('packs'),
            },
            ...(openPack ? [{ label: openPack.label }] : []),
          ]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='packs' size='md'>
            <div className='flex flex-col gap-0.5 px-2 pt-4'>
              {CHART_PACK_KEYS.map((key) => (
                <PackRow
                  key={key}
                  packKey={key}
                  present={present}
                  selected={selected}
                  forced={forced.has(key)}
                  selecting={selected.size > 0}
                  onToggle={(checked) =>
                    toggleCodes(
                      CHART_PACKS[key].accounts
                        .filter((account) => !present.has(account.code))
                        .map((account) => account.code),
                      checked
                    )
                  }
                  onOpen={() => setPage(key)}
                />
              ))}
            </div>
          </DialogNavPage>

          {CHART_PACK_KEYS.map((key) => (
            <DialogNavPage key={key} value={key} size='md'>
              <div className='flex flex-col gap-0.5 px-2 pt-4'>
                {CHART_PACKS[key].accounts.map((account) => (
                  <AccountRow
                    key={account.code}
                    account={account}
                    here={present.has(account.code)}
                    selected={selected.has(account.code)}
                    selecting={selected.size > 0}
                    onToggle={(checked) => toggleCodes([account.code], checked)}
                  />
                ))}
              </div>
            </DialogNavPage>
          ))}
        </DialogNavPages>

        {/* 🛑 A SIBLING of `DialogNavPages`, and therefore gutterless unless it
            says so. `DialogFooter` carries only `pt-4`; its side and bottom
            padding normally comes from `DialogContent`'s inner `p-4`, which
            `innerClassName='p-0'` removes - and that is mandatory for
            `DialogNavPages` to own the width/height spring. `footerGutter` does
            NOT cover this case: it re-applies the gutter to a footer nested
            INSIDE a page, and this one deliberately is not. It sits outside so
            the running count holds still while the pages animate under it. */}
        <DialogFooter className='px-4 pb-4'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={adopt.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={() => adopt.mutate({ codes: codesToSubmit })}
            variant='outline'
            size='sm'
            loading={adopt.isPending}
            loadingText='Adding...'
            disabled={codesToSubmit.length === 0}
            data-dialog-submit>
            {codesToSubmit.length === 1 ? 'Add 1 account' : `Add ${codesToSubmit.length} accounts`}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PackRowProps {
  packKey: ChartPackKey
  present: Set<string>
  selected: Set<string>
  /** Pulled in by another pack's `requires` - shown checked, not toggleable. */
  forced: boolean
  /** Anything selected anywhere → checkboxes are pinned rather than hover-revealed. */
  selecting: boolean
  onToggle: (checked: boolean) => void
  onOpen: () => void
}

function PackRow({
  packKey,
  present,
  selected,
  forced,
  selecting,
  onToggle,
  onOpen,
}: PackRowProps) {
  const pack = CHART_PACKS[packKey]
  const missing = pack.accounts.filter((account) => !present.has(account.code))
  const here = pack.accounts.length - missing.length
  const picked = missing.filter((account) => selected.has(account.code)).length

  // 🛑 Three states, not two. A partly-picked pack renders the dash box rather
  // than an empty one, or drilling in, checking one account and coming back
  // would read as "nothing selected here".
  const checked: boolean | 'indeterminate' =
    forced || (missing.length > 0 && picked === missing.length)
      ? true
      : picked > 0
        ? 'indeterminate'
        : false

  const parts: string[] = []
  if (missing.length === 0) parts.push('All here')
  else parts.push(`${missing.length} of ${pack.accounts.length} to add`)
  if (here > 0 && missing.length > 0) parts.push(`${here} already here`)
  if (pack.requires?.length) {
    parts.push(`Also adds ${pack.requires.map((req) => CHART_PACKS[req].label).join(', ')}`)
  }

  return (
    <TreeRow
      icon={<Landmark className='size-4 text-muted-foreground' />}
      title={pack.label}
      description={pack.description}
      // Nothing left to add → no checkbox at all. A disabled one on a settled
      // pack is a control that can never do anything, and the badge already
      // says why.
      selectable={missing.length > 0 && !forced}
      selecting={selecting && missing.length > 0}
      selected={checked}
      onSelectChange={(next) => onToggle(next)}
      selectLabel={`Add every account in ${pack.label}`}
      // Drilling in is the row click. `onToggleOpen` rather than `onDrill` so
      // the whole row opens the pack: the checkbox stops its own bubble, so a
      // click on it still only selects.
      onToggleOpen={onOpen}
      onDrill={onOpen}
      // ⚠️ NO `TREE_SECONDARY_NOTRUNCATE` here, unlike the chart lists. That
      // class exists for a BADGE-shaped secondary whose pill edges get clipped;
      // this secondary is a sentence, and letting a sentence refuse to truncate
      // pushed the row's own checkbox off the edge.
      secondary={<span className='text-muted-foreground text-xs'>{parts.join(' · ')}</span>}
      secondaryFill
      rowClassName={cn('hover:bg-primary-100', missing.length === 0 && 'opacity-70')}
      actions={
        missing.length === 0 ? (
          <Badge variant='green' size='xs'>
            <Check />
            All here
          </Badge>
        ) : undefined
      }
    />
  )
}

interface AccountRowProps {
  account: DefaultChartAccount
  /** The org's chart already holds this code. */
  here: boolean
  selected: boolean
  selecting: boolean
  onToggle: (checked: boolean) => void
}

function AccountRow({ account, here, selected, selecting, onToggle }: AccountRowProps) {
  return (
    <TreeRow
      icon={<Landmark className='size-4 text-muted-foreground' />}
      title={
        <span className='truncate text-sm'>
          <span className='text-muted-foreground tabular-nums'>{account.code}</span> {account.name}
        </span>
      }
      // The role is why an account is not optional in practice - a role with
      // nowhere to post refuses every preview - so it rides beside the title as
      // the row's help tooltip rather than competing with the type badge for
      // the secondary slot.
      description={account.role ? ACCOUNT_ROLE_LABELS[account.role] : undefined}
      selectable={!here}
      selecting={selecting && !here}
      selected={selected}
      onSelectChange={(next) => onToggle(next)}
      selectLabel={`Add ${account.code} ${account.name}`}
      // The row toggles its own checkbox - a picker where only the box is a
      // target is a picker people miss.
      onToggleOpen={here ? undefined : () => onToggle(!selected)}
      secondary={
        <span className='flex items-center gap-1.5 p-[1px]'>
          <Badge variant={accountTypeColor(account.accountType)} size='xs'>
            {accountTypeLabel(account.accountType)}
          </Badge>
        </span>
      }
      secondaryFill
      rowClassName={cn('hover:bg-primary-100', here && 'opacity-70')}
      actions={
        here ? (
          <Badge variant='green' size='xs'>
            <Check />
            Here
          </Badge>
        ) : undefined
      }
    />
  )
}
