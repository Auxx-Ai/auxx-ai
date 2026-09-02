// apps/web/src/components/manufacturing/ui/settings/tariff-resync-dialog.tsx
'use client'

// "Catalogue updates" on Parts > Settings > Tariffs (money 35 §7).
//
// `adoptTariffStarters` writes a code's rates once, at adoption, and never looks
// at the catalogue again - so a correction to the catalogue never reaches an org
// that already adopted. This dialog is where that correction is consented to and
// applied.
//
// 🛑 THE ACTION IS THE UNIT OF CONSENT, and there is deliberately no "apply
// everything" button. One row per government action, and the four Section 301
// lists stay FOUR ROWS rather than being grouped under a "Section 301" family:
// each list is its own authority to the resolver, and a family grouping invites
// an "apply all of Section 301" button that would be four different government
// actions behind one click.
//
// 🛑 THE PLAN IS DISPLAY ONLY. `purchasing.applyTariffResync` re-derives the
// diff from the live schedule inside the write, so what is on screen here can
// never be what gets written - it is what gets consented to. The
// `codeInstanceIds` posted are a narrowing, not a payload.
//
// 🛑 AN APPLY CAN PARTIALLY COMPLETE (35 §5.1). The transaction unit is ONE
// CODE, so a run over 200 codes that fails at 137 leaves 136 committed. The
// result renders `applied` / `failed` / `remaining` and never reads "done" for a
// run that stopped.
//
// `diverged` rows are rendered READ-ONLY and nothing is ever written for them:
// an org that set List 3 to 30% themselves meant it (§3.2), and correcting a
// wrong row is out of scope by decision - it is done by hand in the rate editor.

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav } from '@auxx/ui/components/dialog-nav'
import { Kbd } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, Landmark, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { composeTariffLabel, formatRate } from '../../tariff-types'

type ResyncPlan = RouterOutputs['purchasing']['planTariffResync']
type ResyncAction = ResyncPlan['actions'][number]
type ResyncCode = ResyncAction['codes'][number]
type ResyncApplyResult = RouterOutputs['purchasing']['applyTariffResync']

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** `+25.0 pts`, `-20.0 pts`, or the honest `no change` when a step is not in force yet. */
function formatSwing(before: number, after: number): string {
  const delta = after - before
  if (Math.abs(delta) < 0.001) return 'no change today'
  return `${delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)} pts`
}

/** How an action reads when it has no authority of its own - the MFN base row. */
function actionTitle(action: ResyncAction): string {
  return action.authority ?? 'Ordinary duty (base rate)'
}

/**
 * What changed, in the ACTION's own terms rather than as a row count.
 *
 * The three shapes an append actually takes: an action that ended (a dated `0`
 * step - 35 §3.3's model of an expiry, since there is no end date), an action
 * that gained one step, and an action being written onto codes for the first
 * time, which brings its whole history at once.
 */
function describeAction(action: ResyncAction): string {
  const additions = action.codes.flatMap((code) => code.additions)
  if (additions.length === 0) return 'Nothing to add'

  const days = [...new Set(additions.map((addition) => addition.effectiveFrom))].sort()
  const first = days[0] as string
  const last = days[days.length - 1] as string

  if (additions.every((addition) => addition.rate === 0)) {
    return `Terminated ${last} (0%)`
  }
  if (days.length === 1) {
    const rates = [...new Set(additions.map((addition) => addition.rate))]
    const rate = rates.length === 1 ? ` (${formatRate(rates[0] as number)})` : ''
    return `New step ${first}${rate}`
  }
  return `${plural(days.length, 'step')}, ${first} to ${last}`
}

/** The aggregate - a HEADER, not the whole story. The per-code table below is. */
function describeSpread(action: ResyncAction): string {
  const swings = action.codes.map((code) => code.after - code.before)
  const min = Math.min(...swings)
  const max = Math.max(...swings)
  const codes = plural(action.codes.length, 'code')
  if (Math.abs(max - min) < 0.001) {
    return `${codes}, ${formatSwing(0, max)}${Math.abs(max) < 0.001 ? '' : ' each'}`
  }
  return `${codes}, ${formatSwing(0, min)} to ${formatSwing(0, max)}`
}

interface TariffResyncDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The whole-org plan. `undefined` while the query is in flight. */
  plan: ResyncPlan | undefined
  isLoading: boolean
  /**
   * Narrows the dialog to one code - the per-row button (§7.2). The plan is the
   * same one, filtered here rather than re-queried: the page already holds it.
   */
  focusCodeInstanceId?: string | null
  /** Refetch the plan and the page's rate rows. */
  onApplied: (result: ResyncApplyResult) => void
}

export function TariffResyncDialog({
  open,
  onOpenChange,
  plan,
  isLoading,
  focusCodeInstanceId,
  onApplied,
}: TariffResyncDialogProps) {
  const apply = api.purchasing.applyTariffResync.useMutation()
  const [openActions, setOpenActions] = useState<Set<string>>(new Set())
  /** The last apply's outcome per action, so a partial run stays on screen. */
  const [results, setResults] = useState<Record<string, ResyncApplyResult>>({})
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const actions = useMemo(() => {
    const all = plan?.actions ?? []
    if (!focusCodeInstanceId) return all
    return all
      .map((action) => ({
        ...action,
        codes: action.codes.filter((code) => code.codeInstanceId === focusCodeInstanceId),
      }))
      .filter((action) => action.codes.length > 0)
  }, [plan, focusCodeInstanceId])

  const diverged = useMemo(() => {
    const all = plan?.diverged ?? []
    if (!focusCodeInstanceId) return all
    return all.filter((row) => row.codeInstanceId === focusCodeInstanceId)
  }, [plan, focusCodeInstanceId])

  const toggleOpen = useCallback((actionKey: string) => {
    setOpenActions((prev) => {
      const next = new Set(prev)
      if (next.has(actionKey)) next.delete(actionKey)
      else next.add(actionKey)
      return next
    })
  }, [])

  const handleApply = useCallback(
    async (action: ResyncAction) => {
      setPendingKey(action.actionKey)
      try {
        const result = await apply.mutateAsync({
          actionKey: action.actionKey,
          codeInstanceIds: action.codes.map((code) => code.codeInstanceId),
        })
        setResults((prev) => ({ ...prev, [action.actionKey]: result }))
        onApplied(result)
      } catch (error) {
        toastError({
          title: 'Could not apply the catalogue update',
          description:
            error instanceof Error ? error.message : 'Could not write the catalogue rows.',
        })
      } finally {
        setPendingKey(null)
      }
    },
    [apply, onApplied]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='3xl' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Catalogue updates'
          description={
            focusCodeInstanceId
              ? 'What the catalogue would add to this code. Rows are only ever appended - nothing is edited or removed.'
              : 'What the catalogue would add to the codes you already hold. Rows are only ever appended - nothing is edited or removed.'
          }
          crumbs={[{ label: 'Catalogue updates' }]}
        />

        <div className='flex flex-col gap-3 p-3'>
          {isLoading ? (
            <EmptySection loading />
          ) : actions.length === 0 ? (
            // 🛑 "Nothing to apply" says WHICH catalogue said so. A button that
            // sometimes does nothing silently is worse than one that explains.
            <EmptySection
              icon={<CheckCircle2 className='size-5' />}
              title='Up to date'
              description={`Nothing in the auxx catalogue (${plan?.version ?? '-'}) is missing from ${
                focusCodeInstanceId ? 'this code' : 'the codes you hold'
              }.`}
            />
          ) : (
            <ScrollArea viewportClassName='max-h-[26rem]'>
              <div className={cn('flex flex-col gap-0.5 pe-3', TREE_SECONDARY_NOTRUNCATE)}>
                {actions.map((action) => (
                  <ResyncActionRow
                    key={action.actionKey}
                    action={action}
                    isOpen={openActions.has(action.actionKey)}
                    onToggleOpen={() => toggleOpen(action.actionKey)}
                    isPending={pendingKey === action.actionKey}
                    disabled={pendingKey !== null}
                    result={results[action.actionKey]}
                    onApply={() => void handleApply(action)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          {diverged.length > 0 && (
            <div className='rounded-md border bg-muted/30 p-2.5'>
              <div className='mb-1.5 flex items-center gap-1.5'>
                <TriangleAlert className='size-3.5 text-amber-600' />
                <span className='font-medium text-xs'>
                  {plural(diverged.length, 'row')} you changed
                </span>
              </div>
              {/* Read-only, and it says so: a row the org edited is theirs. §3.2 */}
              <p className='mb-2 text-muted-foreground text-xs'>
                These rows disagree with the catalogue at the same date. Nothing here is written or
                overwritten - edit them in the rate history if you want the catalogue's number.
              </p>
              <div className='flex flex-col gap-1'>
                {diverged.map((row) => (
                  <div
                    key={row.rateId}
                    className='flex flex-wrap items-baseline gap-x-2 text-muted-foreground text-xs'>
                    <span className='tabular-nums text-foreground'>{row.code}</span>
                    <span className='tabular-nums'>{row.effectiveFrom}</span>
                    {row.chapter99Code && <span className='tabular-nums'>{row.chapter99Code}</span>}
                    <span>
                      you have {formatRate(row.ours)}; the catalogue says {formatRate(row.theirs)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className='items-center gap-3 border-t px-4 py-3 sm:justify-between'>
          <p className='text-muted-foreground text-xs'>
            From the auxx catalogue, dated {plan?.version ?? '-'}. Rows are appended, never edited
            or removed - verify against your broker's entry summary.
          </p>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={apply.isPending}>
            Close <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ResyncActionRowProps {
  action: ResyncAction
  isOpen: boolean
  onToggleOpen: () => void
  isPending: boolean
  disabled: boolean
  result: ResyncApplyResult | undefined
  onApply: () => void
}

/** One government action, with its per-code table underneath. */
function ResyncActionRow({
  action,
  isOpen,
  onToggleOpen,
  isPending,
  disabled,
  result,
  onApply,
}: ResyncActionRowProps) {
  const applied = result !== undefined

  return (
    <TreeRow
      icon={<Landmark className='size-4 text-muted-foreground' />}
      title={
        <span className='flex min-w-0 items-baseline gap-2'>
          <span className='shrink-0 text-sm'>{actionTitle(action)}</span>
          {action.chapter99Code && (
            <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
              {action.chapter99Code}
            </span>
          )}
        </span>
      }
      secondaryFill
      secondary={
        <span className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs'>
          <span className='shrink-0'>{describeAction(action)}</span>
          <span className='min-w-0 truncate'>{describeSpread(action)}</span>
        </span>
      }
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      rowClassName='hover:bg-primary-100'
      actions={
        applied ? (
          <ApplyOutcome result={result} />
        ) : (
          <Button
            variant='outline'
            size='xs'
            onClick={onApply}
            disabled={disabled}
            loading={isPending}
            loadingText='Applying...'>
            Apply
          </Button>
        )
      }>
      <div className='flex flex-col gap-0.5'>
        {action.codes.map((code) => (
          <ResyncCodeRow key={code.codeInstanceId} action={action} code={code} />
        ))}
      </div>
    </TreeRow>
  )
}

/**
 * 🛑 Never "done" for a run that stopped partway (§5.1). All three counts are
 * rendered, and a failure keeps its message.
 */
function ApplyOutcome({ result }: { result: ResyncApplyResult }) {
  const failure = result.failed[0]
  if (!failure && result.remaining.length === 0) {
    return (
      <span className='flex items-center gap-1 text-xs text-good-600'>
        <CheckCircle2 className='size-3.5' />
        {plural(result.applied.length, 'code')} updated
      </span>
    )
  }
  return (
    <span
      className='flex items-center gap-1 text-bad-600 text-xs'
      title={failure ? `${failure.code}: ${failure.error}` : undefined}>
      <TriangleAlert className='size-3.5' />
      {result.applied.length} applied, {result.failed.length} failed, {result.remaining.length} not
      attempted
    </span>
  )
}

/**
 * One code under an action: what it resolves to today, and what it would
 * resolve to once these rows land.
 *
 * ⚠️ `spellingFromOrg` is SAID, never hidden. When a code carries its own
 * spelling of the authority, the appended step takes that spelling so it lands
 * in the same group the resolver already sums - rule 3 doing its job should be
 * visible, not magic. It is only rendered when the spelling actually differs
 * from the catalogue's, because "we used your spelling, which is our spelling"
 * is noise.
 */
function ResyncCodeRow({ action, code }: { action: ResyncAction; code: ResyncCode }) {
  const ownSpelling = code.additions.find(
    (addition) => addition.spellingFromOrg && addition.authority !== action.authority
  )

  return (
    <TreeRow
      depth={1}
      title={
        <span className='flex min-w-0 items-baseline gap-2'>
          <span className='shrink-0 text-sm tabular-nums'>
            {composeTariffLabel(code.code, code.country)}
          </span>
          <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
            {formatRate(code.before)} &rarr; {formatRate(code.after)}
          </span>
        </span>
      }
      secondaryFill
      secondary={
        <span className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs'>
          <Badge variant='outline' size='xs' className='shrink-0'>
            {formatSwing(code.before, code.after)}
          </Badge>
          <span className='min-w-0 truncate'>
            {plural(code.additions.length, 'row')}
            {ownSpelling ? ` - written as "${ownSpelling.authority}", your spelling` : ''}
          </span>
        </span>
      }
      rowClassName='hover:bg-primary-100'
    />
  )
}
