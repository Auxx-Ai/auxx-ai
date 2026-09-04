// apps/web/src/components/accounting/ui/setup-wizard/wizard-opening-tb-page.tsx
'use client'

import type { OpeningTrialBalanceRow } from '@auxx/lib/postings/client'
import {
  ACCOUNT_ROLES,
  OPENING_BASELINE_SETTING_KEYS,
  readSettingMinorUnits,
  summariseOpeningTrialBalance,
} from '@auxx/lib/postings/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { AlertTriangle } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import type { LedgerBlocker } from '../ledger/entry-blockers'
import { EntryBlockers } from '../ledger/entry-blockers'
import {
  applyOpeningCellChange,
  OpeningTbGrid,
  openingRowsDifferFromServer,
  openingVerdict,
  overlayInventorySettings,
} from '../settings/opening-tb-grid'
import type { WizardStepHandle } from './wizard-step-handle'

/** Why the three inventory rows cannot be typed in here. */
const LOCK_REASON =
  'Set on the previous page. This is the inventory snapshot the first month-end close measures ' +
  'its delta from, so it has one authority.'

/**
 * Page 3b of `AccountingSetupWizard` - the opening trial balance
 * (plans/accounting/tasks/03-opening-balances.md, ui-plan §2.2).
 *
 * 🛑 **Continue is refused while the difference is non-zero.** This is the one
 * page in the wizard where "fill it in later" is not a survivable answer: a
 * plug account added to make an opening balance agree is precisely what task 03
 * opens with as the worst thing that can happen here, and the 1065 claiming
 * $4,258,818 of cash on a business that never held it is what it looks like
 * three years later. The refusal is scoped to `'next'` - Back and "Set up
 * later" always let a person out with whatever they have typed saved, per
 * `wizard-step-handle.ts` - and it renders as an `EntryBlockers` card under the
 * grid, never as a toast (HANDOFF ground rule 9). A toast is gone in four
 * seconds and takes the only explanation of a disabled Continue with it.
 *
 * ⚠️ The three inventory rows are prefilled from the `accounting.opening*`
 * settings the PREVIOUS page writes, and are locked. They are the same number
 * `readOpeningBaseline` hands the first close, so a second editable copy here
 * would let the ledger and the subledger disagree from day one - and the
 * disagreement would arrive as an unexplainable COGS plug.
 *
 * The draft is persisted through `ledgerOpening.save` on leave, in every
 * direction, for the reason every other draft-holding page in this wizard does:
 * a page that can lose typing has no escape hatch.
 */
export const WizardOpeningTbPage = forwardRef<WizardStepHandle>(
  function WizardOpeningTbPage(_props, ref) {
    const utils = api.useUtils()
    const opening = api.ledgerOpening.get.useQuery()
    // The browser's copy of the three inventory figures. Fresher than the
    // server read - see `overlayInventorySettings`.
    const { getSetting } = useSettings({ scope: 'GENERAL' })
    const save = api.ledgerOpening.save.useMutation({
      onSuccess: () => utils.ledgerOpening.get.invalidate(),
    })

    // `edited` holds ONLY what somebody typed into the grid. The three locked
    // inventory rows are overlaid at RENDER time from the settings store, not
    // written into state, so the previous page's numbers can land after this
    // query did without discarding anything typed here.
    const [edited, setEdited] = useState<OpeningTrialBalanceRow[] | null>(null)
    const [dirty, setDirty] = useState(false)
    // The refusal Continue raised, held so it renders as a card rather than a
    // toast (HANDOFF ground rule 9).
    const [refusal, setRefusal] = useState<LedgerBlocker | null>(null)
    const serverRows = opening.data?.rows

    // A fresh answer from the server supersedes whatever was typed against the old
    // one. `serverRows` is the TRIGGER, not a value the body reads - dropping it
    // would make this a mount-only reset that never fires again.
    // biome-ignore lint/correctness/useExhaustiveDependencies: serverRows is the trigger, not a read value
    useEffect(() => {
      setEdited(null)
      setDirty(false)
    }, [serverRows])

    const K = OPENING_BASELINE_SETTING_KEYS
    const rawMaterialsMinor = readSettingMinorUnits(getSetting(K.inventory_raw_materials))
    const wipMinor = readSettingMinorUnits(getSetting(K.inventory_wip))
    const finishedGoodsMinor = readSettingMinorUnits(getSetting(K.inventory_finished_goods))

    const rows = useMemo(
      () =>
        overlayInventorySettings(edited ?? serverRows ?? [], {
          [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS]: rawMaterialsMinor,
          [ACCOUNT_ROLES.INVENTORY_WIP]: wipMinor,
          [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS]: finishedGoodsMinor,
        }),
      [edited, serverRows, rawMaterialsMinor, wipMinor, finishedGoodsMinor]
    )

    const summary = useMemo(
      () =>
        summariseOpeningTrialBalance(
          rows.flatMap((row) => [
            ...(row.debitMinor
              ? [{ direction: 'debit' as const, amountMinor: row.debitMinor }]
              : []),
            ...(row.creditMinor
              ? [{ direction: 'credit' as const, amountMinor: row.creditMinor }]
              : []),
          ])
        ),
      [rows]
    )

    const currency = opening.data?.currency ?? 'USD'
    const cutoverDate = opening.data?.cutoverDate ?? null
    const unbalanced = summary.rows === 0 || summary.differenceMinor !== 0

    // 🛑 Dirty is "what is on screen differs from what the server holds", not
    // "somebody typed in a cell". The three locked rows are overlaid at render
    // time from the PREVIOUS page's settings, so a changed inventory figure
    // moves this grid without touching `dirty` - and `wizard-done-page` posts
    // the STORED draft, which would still hold the old number.
    const overlayDirty = useMemo(
      () => openingRowsDifferFromServer(rows, serverRows),
      [rows, serverRows]
    )

    // The card clears itself the moment the books agree; leaving it up over a
    // balanced grid would be the same lie a stale toast is.
    useEffect(() => {
      if (!unbalanced) setRefusal(null)
    }, [unbalanced])

    // 🛑 Once the ledger holds a standing entry the opening balance is frozen
    // and `ledgerOpening.save` refuses. Rendering typeable cells over that would
    // hand somebody a grid whose save is rejected only after they had filled it
    // in - the refusal has to be on screen BEFORE the typing, not after. Found
    // by driving the wizard on an org that had already posted.
    const frozen = opening.data?.frozen ?? false

    const persist = () => {
      if (frozen) return
      save.mutate({
        lines: rows.flatMap((row) => [
          ...(row.debitMinor
            ? [
                {
                  accountCode: row.accountCode,
                  direction: 'debit' as const,
                  amountMinor: row.debitMinor,
                },
              ]
            : []),
          ...(row.creditMinor
            ? [
                {
                  accountCode: row.accountCode,
                  direction: 'credit' as const,
                  amountMinor: row.creditMinor,
                },
              ]
            : []),
        ]),
      })
      setDirty(false)
    }

    useImperativeHandle(ref, () => ({
      tryAdvance: (direction) => {
        // A frozen page has nothing to save and nothing to refuse: the entry it
        // would have written is already in the books.
        if (frozen) return true
        if (direction === 'next' && unbalanced) {
          setRefusal({
            status: 'unbalanced',
            error:
              summary.rows === 0
                ? 'Nothing has been entered yet. Fill in what each account was worth at the cutover before continuing.'
                : 'Debits and credits do not agree. Find the missing balance, and never add a plug account to make it agree.',
          })
          return false
        }
        setRefusal(null)
        // Back and "Set up later" save whatever is there and let the user out.
        if (dirty || overlayDirty) persist()
        return true
      },
    }))

    if (opening.isPending) {
      return (
        <div className='flex flex-col gap-3 p-4'>
          <Skeleton className='h-4 w-2/3' />
          <Skeleton className='h-64 w-full' />
        </div>
      )
    }

    if (!cutoverDate) {
      return (
        <div className='flex items-start gap-2 p-4 text-sm'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-500' />
          <span className='text-muted-foreground'>
            Go back to the accounting period page and set a cutoff month and a book timezone. The
            opening entry is dated the last day of that month, so there is nothing to fill in until
            both are set.
          </span>
        </div>
      )
    }

    return (
      <div className='flex flex-col gap-4 p-4'>
        <div className='flex flex-col gap-1'>
          <p className='text-muted-foreground text-sm'>
            What every account was worth at the close of {cutoverDate}, the day before Auxx starts
            valuing your books.
          </p>
          {/*
            The evidence rule, verbatim from the brief. It is here rather than in
            a tooltip because it is the instruction that decides whether the
            numbers are right: the tax return's figure is not usable, and the
            restart this module was built for is blocked on collecting bank
            statements instead.
          */}
          <p className='font-medium text-foreground text-sm'>
            Use the {cutoverDate.slice(5).replace('-', '/')} statement balance for every bank and
            card account. Do not use the tax return.
          </p>
        </div>

        <div className='max-h-[26rem] overflow-y-auto rounded-xl border'>
          <OpeningTbGrid
            rows={rows}
            currency={currency}
            readOnly={frozen}
            lockReason={LOCK_REASON}
            onCellChange={(accountCode, column, minor) => {
              setEdited((prev) =>
                applyOpeningCellChange(prev ?? serverRows ?? [], accountCode, column, minor)
              )
              setDirty(true)
            }}
          />
        </div>

        {frozen && (
          <p className='text-muted-foreground text-xs'>
            The opening entry is already posted, so these figures are frozen. To change a posted
            opening balance, reverse the entry from the ledger and post a new one.
          </p>
        )}

        {refusal && <EntryBlockers blockers={[refusal]} />}

        <div className='sticky bottom-0'>
          <VerdictStrip
            debitMinor={summary.debitMinor}
            creditMinor={summary.creditMinor}
            rowCount={summary.rows}
            currency={currency}
          />
        </div>
      </div>
    )
  }
)

/**
 * The Debits / Credits / Difference strip, under the table rather than inside
 * it.
 *
 * `StatementTable` takes a `verdict` and renders exactly this, but it renders
 * it under a table this page scrolls, so the one number somebody has to watch
 * while typing would scroll out of sight. Same copy, same component
 * (`openingVerdict`), rendered where it stays visible.
 */
function VerdictStrip({
  debitMinor,
  creditMinor,
  rowCount,
  currency,
}: {
  debitMinor: number
  creditMinor: number
  rowCount: number
  currency: string
}) {
  const verdict = openingVerdict(debitMinor, creditMinor, rowCount, currency)
  return (
    <div
      className={
        verdict.ok
          ? 'flex flex-col gap-0.5 rounded-lg border border-green-500/40 bg-background px-3 py-2 text-green-700 text-sm dark:text-green-400'
          : 'flex flex-col gap-0.5 rounded-lg border border-destructive/50 bg-background px-3 py-2 text-destructive text-sm'
      }>
      <span className='font-medium'>{verdict.label}</span>
      {verdict.detail && <span className='text-muted-foreground text-xs'>{verdict.detail}</span>}
    </div>
  )
}
