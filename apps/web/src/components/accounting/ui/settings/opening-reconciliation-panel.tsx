// apps/web/src/components/accounting/ui/settings/opening-reconciliation-panel.tsx
'use client'

// The two opening snapshots, side by side, with their difference.
//
// 🛑 Neither number silently overrides the other, which is why this is a
// DIFFERENCE rather than a fallback. A difference falling into January's
// balancing plug would classify a cutover problem as January COGS; the auxx
// number alone would let QuickBooks and the subledger disagree from day one.
//
// ⚠️ These controls are handed to `SettingsFieldRow` through its `children`
// escape hatch, so they keep the row chrome (label, icon, description tooltip,
// `AdminGate`). `AdminGate` clones the child with `disabled` and `className`,
// which is why both props are declared even where this file never sets them.

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FrozenLock } from './frozen-lock'

/** The two snapshots' column captions, rendered once above the first pair. */
const COLUMN_LABELS = ['auxx.ai', 'QuickBooks', 'Difference'] as const

/**
 * Shared by the caption row and every value row so the columns line up.
 *
 * ⚠️ The fourth track is the freeze lock, and it is reserved **whether or not
 * anything is frozen**. Adding the column only once frozen would shift the
 * difference cell sideways the first time a month posts, on a page nobody is
 * looking at when it happens.
 */
const COLUMN_GRID = 'grid grid-cols-[1fr_1fr_7rem_1.25rem]'

interface OpeningPairFieldProps {
  auxx: number | null
  qbo: number | null
  onAuxxChange: (value: number | null) => void
  onQboChange: (value: number | null) => void
  /** Per-input validation, from `minorUnitError`. */
  auxxError?: string
  qboError?: string
  /** Column captions render only on the first pair, so the panel is not repetitive. */
  showLabels?: boolean
  /** After the freeze, both snapshots render as values with the reason attached. */
  readOnly?: boolean
  readOnlyReason?: string
  disabled?: boolean
  className?: string
}

/** One account: the auxx snapshot, the provider snapshot, and their difference. */
export function OpeningPairField({
  auxx,
  qbo,
  onAuxxChange,
  onQboChange,
  auxxError,
  qboError,
  showLabels,
  readOnly,
  readOnlyReason,
  disabled,
  className,
}: OpeningPairFieldProps) {
  const difference = auxx === null || qbo === null ? null : auxx - qbo

  return (
    <div className={cn('py-1', className)}>
      {showLabels && (
        <div className={cn(COLUMN_GRID, 'gap-2 px-2 pb-1')}>
          {COLUMN_LABELS.map((label) => (
            <span key={label} className='text-[10px] text-muted-foreground uppercase tracking-wide'>
              {label}
            </span>
          ))}
        </div>
      )}

      <div className={cn(COLUMN_GRID, 'items-center gap-2')}>
        {readOnly ? (
          <>
            <span className='px-2 text-sm tabular-nums'>{formatCurrency(auxx)}</span>
            <span className='px-2 text-sm tabular-nums'>{formatCurrency(qbo)}</span>
          </>
        ) : (
          <>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              value={auxx}
              disabled={disabled}
              onChange={(next) => onAuxxChange((next as number | undefined) ?? null)}
              placeholder='Not set'
            />
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              value={qbo}
              disabled={disabled}
              onChange={(next) => onQboChange((next as number | undefined) ?? null)}
              placeholder='Not set'
            />
          </>
        )}

        <DifferenceCell difference={difference} />

        {/*
          The reason moved into this lock's tooltip. It used to render as body
          text under every pair, so the same three sentences appeared once per
          account, the panel's own `showLabels` rule against repetition applies
          to the explanation just as much as to the captions.
        */}
        {readOnly && readOnlyReason && <FrozenLock reason={readOnlyReason} />}
      </div>

      {(auxxError || qboError) && (
        <p className='px-2 pt-1 text-destructive text-xs'>{auxxError ?? qboError}</p>
      )}
    </div>
  )
}

/** A single difference, with "not comparable yet" kept distinct from "agrees". */
function DifferenceCell({ difference }: { difference: number | null }) {
  if (difference === null) {
    return <span className='px-2 text-muted-foreground text-xs'>Not comparable</span>
  }
  if (difference === 0) {
    return (
      <Badge variant='green' size='xs' className='justify-self-start whitespace-nowrap'>
        Agrees
      </Badge>
    )
  }
  return (
    <span className='px-2 font-medium text-destructive text-sm tabular-nums'>
      {difference > 0 ? '+' : ''}
      {formatCurrency(difference)}
    </span>
  )
}

interface OpeningTotalRowProps {
  /** `openingDifference(settings)` over the DRAFT, so the verdict tracks the form. */
  total: number
  /** True while any of the six balances is still unset. */
  incomplete: boolean
  className?: string
}

/**
 * The summed verdict.
 *
 * 🛑 The two snapshots must agree before setup can be finalized, and when they
 * do NOT this row says so in as many words rather than leaving a bookkeeper to
 * infer it from a disabled button on another page. Agreement gets the badge
 * alone, see the comment on the paragraph below.
 */
export function OpeningTotalRow({ total, incomplete, className }: OpeningTotalRowProps) {
  const agrees = !incomplete && total === 0

  return (
    <div className={cn('space-y-1 py-1', className)}>
      <div className={cn(COLUMN_GRID, 'items-center gap-2')}>
        <span className='px-2 font-medium text-sm'>Total difference</span>
        <span />
        {incomplete ? (
          <span className='px-2 text-muted-foreground text-xs'>Not comparable</span>
        ) : agrees ? (
          <Badge variant='green' size='xs' className='justify-self-start whitespace-nowrap'>
            Agrees
          </Badge>
        ) : (
          <span className='px-2 font-medium text-destructive text-sm tabular-nums'>
            {total > 0 ? '+' : ''}
            {formatCurrency(total)}
          </span>
        )}
      </div>

      {/*
        🛑 Only the states somebody must ACT on get a paragraph. Agreement is
        already carried by the green badge and by this row's own description
        ("The two snapshots must agree before setup can be finalized."), so
        spelling it out a third time made the settled case the loudest row on
        the page, and pushed its badge out of line with the three above it.
      */}
      {!agrees && (
        <p className='px-2 text-muted-foreground text-xs'>
          {incomplete
            ? 'Some balances are still unset, so there is nothing to compare yet. Zero is a real ' +
              'balance; unset is not.'
            : 'Setup cannot be finalized while these disagree. Neither number overrides the ' +
              "other: a difference left to fall into the first month's balancing plug would be " +
              "booked as that month's COGS, and taking the auxx figure alone would let " +
              'QuickBooks and the subledger diverge from day one. Fix the count or the journal ' +
              'entry, then re-enter both.'}
        </p>
      )}
    </div>
  )
}
