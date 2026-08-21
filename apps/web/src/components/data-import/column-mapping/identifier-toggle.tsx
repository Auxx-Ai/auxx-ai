// apps/web/src/components/data-import/column-mapping/identifier-toggle.tsx

'use client'

import { type ImportableField, TIER_2_IDENTIFIER_NOTE } from '@auxx/lib/import/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { KeyRound } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'

interface IdentifierToggleProps {
  /** The field this column is mapped to. */
  field: ImportableField
  /** Whether this column currently carries the identity flag. */
  isFlagged: boolean
  /** How many OTHER columns currently carry the flag. */
  otherFlaggedCount: number
  /** Disables the control while a save is in flight. */
  disabled?: boolean
  onToggle: (next: boolean) => void
}

/**
 * Why a composite-only field cannot be flagged on its own.
 *
 * A lone RELATION identifier is never valid, "the row whose supplier is
 * Acme" identifies a supplier, not a record. It is eligible only as one leg of
 * a composite key such as `(part, supplier)` on `vendor_part`.
 */
const COMPOSITE_ONLY_REASON =
  'A linked record can only be part of a combined match key. Flag another column first, then add this one.'

/**
 * Whether this column may be flagged as (part of) the import match key.
 *
 * The answer is driven by `identifierTier`, NOT by `group`. `group:
 * 'identifier'` is the picker's HEADING and holds tier-1 fields only; a tier-2
 * field keeps its natural System/Custom group and still carries the tier. Keying
 * this off the group would hide the toggle on every eligible non-unique field,
 * which is the state that produced duplicate records in the first place.
 */
export function canFlagAsIdentifier(field: ImportableField | undefined): boolean {
  return field?.identifierTier !== undefined
}

/**
 * The identity toggle: mark this column as (part of) the job's match key.
 *
 * Toggling is a per-COLUMN write with per-JOB consequences, it moves
 * `identifierFieldKeys` and can flip `defaultStrategy` to `create-or-update`.
 * The caller is responsible for reconciling the job-level read; this component
 * only reports the intent.
 */
export function IdentifierToggle({
  field,
  isFlagged,
  otherFlaggedCount,
  disabled,
  onToggle,
}: IdentifierToggleProps) {
  const compositeOnly = field.identifierCompositeOnly === true
  const blockedAsLoneKey = compositeOnly && !isFlagged && otherFlaggedCount === 0

  const reason = blockedAsLoneKey
    ? COMPOSITE_ONLY_REASON
    : isFlagged
      ? `Matching on ${field.label}. Rows whose ${field.label} already exists will update that record instead of creating a second one.`
      : field.identifierTier === 2
        ? `Match existing records on ${field.label}, ${TIER_2_IDENTIFIER_NOTE.toLowerCase()}, so make sure it really identifies a row.`
        : `Match existing records on ${field.label}.`

  return (
    // The Button is wrapped, not the tooltip target itself: a `disabled`
    // button fires no pointer events, so a tooltip attached directly to it goes
    // silent in exactly the case that most needs to explain itself.
    <Tooltip content={reason}>
      <span className='inline-flex'>
        <Button
          variant='outline'
          size='icon-sm'
          aria-pressed={isFlagged}
          aria-label={isFlagged ? `Stop matching on ${field.label}` : `Match on ${field.label}`}
          disabled={disabled || blockedAsLoneKey}
          className={cn(
            'rounded-none border-r-0 bg-linear-0 shadow-none hover:inset-shadow-none',
            isFlagged
              ? 'border-info/40 text-info bg-info/10 hover:bg-info/15'
              : 'text-muted-foreground'
          )}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(!isFlagged)
          }}>
          <KeyRound />
        </Button>
      </span>
    </Tooltip>
  )
}

interface UniquenessSignalProps {
  distinctValueCount: number
  totalValueCount: number
}

/**
 * The per-FILE uniqueness signal, shown on a flagged column.
 *
 * Field-level `isUnique` is a claim about the DATABASE. This is the question
 * that actually decides whether a column can key an import: *can it identify a
 * row in THIS file?* A column that is unique in the DB but duplicated in the
 * upload quietly creates two records that no later import can ever match again
 *the exact failure this whole plan exists to kill, and the one `isUnique`
 * cannot see.
 */
export function UniquenessSignal({ distinctValueCount, totalValueCount }: UniquenessSignalProps) {
  if (totalValueCount === 0) return null
  const hasDuplicates = distinctValueCount < totalValueCount

  return (
    <p
      className={cn(
        'mt-1 text-xs',
        hasDuplicates ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
      )}>
      {distinctValueCount.toLocaleString()} unique value
      {distinctValueCount === 1 ? '' : 's'} across {totalValueCount.toLocaleString()} row
      {totalValueCount === 1 ? '' : 's'}
      {hasDuplicates && ', duplicates in this file will create duplicate records'}
    </p>
  )
}
