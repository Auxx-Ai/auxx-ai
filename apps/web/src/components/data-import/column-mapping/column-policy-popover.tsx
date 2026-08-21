// apps/web/src/components/data-import/column-mapping/column-policy-popover.tsx

'use client'

import {
  canCreateOnNoMatch,
  defaultRelationLinkMode,
  effectiveOnNoMatch,
  explainCreateUnavailable,
  type ImportableField,
  type ImportMergeStrategy,
  type ImportStrategyMode,
  type RelationLinkMode,
  type RelationOnNoMatch,
} from '@auxx/lib/import/client'
import type { Resource } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { type PolicyTabOption, PolicyTabs } from './policy-tabs'

/** The subset of the column's policy this popover can change. */
export interface ColumnPolicyPatch {
  mergeStrategy?: ImportMergeStrategy
  onNoMatch?: RelationOnNoMatch
  linkMode?: RelationLinkMode
}

interface ColumnPolicyPopoverProps {
  field: ImportableField
  /** The relation TARGET resource. Undefined for scalar columns. */
  targetResource: Resource | undefined
  matchField: string | null | undefined
  mergeStrategy: ImportMergeStrategy | null
  onNoMatch: RelationOnNoMatch | null
  linkMode: RelationLinkMode | null
  /** Job-level mode. The update policy is meaningless in create-only mode. */
  mode: ImportStrategyMode
  disabled?: boolean
  onChange: (patch: ColumnPolicyPatch) => void
}

const MERGE_OPTIONS: PolicyTabOption<ImportMergeStrategy>[] = [
  {
    value: 'overwrite',
    label: 'Overwrite',
    // A blank cell is an ABSENCE by default. `overwrite` is the ONLY way to
    // empty a field by import, and saying so is the difference between a
    // deliberate clear and silent data loss.
    description:
      'The file wins. Blank cells clear the value — the only way to empty a field by import.',
  },
  {
    value: 'fill_blank',
    label: 'Fill blanks',
    description: 'Only writes where the record is empty. Never overwrites a value someone set.',
  },
  {
    value: 'ignore',
    label: 'Create only',
    description: 'This column is ignored when a row updates an existing record.',
  },
]

const LINK_MODE_OPTIONS: PolicyTabOption<RelationLinkMode>[] = [
  { value: 'add', label: 'Append', description: 'Keep links the file does not mention.' },
  { value: 'set', label: 'Replace', description: 'Links absent from the file are removed.' },
]

/**
 * Whether the policy button has anything to offer for this column.
 *
 * Deliberately NOT "is this a relation". Merge strategy is per-column policy
 * on a scalar too, and it is the ONLY way to clear a field by import, hiding it
 * on text columns makes that unreachable. What is genuinely noise is an
 * update-policy control on a create-only job, so that is what is suppressed.
 */
export function hasColumnPolicy(field: ImportableField | undefined, mode: ImportStrategyMode) {
  if (!field) return false
  return field.isRelation || mode !== 'create'
}

/**
 * per-column policy.
 *
 * This lives on the mapping ROW, never inside the field picker. The picker
 * calls `onOpenChange(false)` on selection and resets its relationship context
 * on close, so a radio in there would cost a reopen and a two-level
 * re-navigation to change. Identity and policy are row concerns; the match field
 *which is part of *what the column means*, stays in the picker.
 *
 * Every rule rendered here is READ from the same pure functions the resolver
 * calls (`canCreateOnNoMatch`, `effectiveOnNoMatch`, `defaultRelationLinkMode`).
 * Restating them in the component is literally how Defect E was born.
 */
export function ColumnPolicyPopover({
  field,
  targetResource,
  matchField,
  mergeStrategy,
  onNoMatch,
  linkMode,
  mode,
  disabled,
  onChange,
}: ColumnPolicyPopoverProps) {
  const [open, setOpen] = useState(false)

  const showMerge = mode !== 'create'
  const isRelation = field.isRelation && !!targetResource
  const isMultiValued =
    field.relationConfig?.relationshipType === 'has_many' ||
    field.relationConfig?.relationshipType === 'many_to_many'

  // Resolved, not read raw: a stored `'create'` on a column whose match field
  // has since moved off the display field is clamped back to `'fail'` here, the
  // same way the resolver clamps it.
  const effectiveNoMatch: RelationOnNoMatch = targetResource
    ? effectiveOnNoMatch(targetResource, {
        matchField: matchField ?? undefined,
        onNoMatch: onNoMatch ?? undefined,
      })
    : 'fail'
  const createAllowed = targetResource
    ? canCreateOnNoMatch(targetResource, matchField ?? undefined)
    : false
  const createReason = targetResource
    ? explainCreateUnavailable(targetResource, matchField ?? undefined)
    : undefined
  const effectiveLinkMode: RelationLinkMode =
    linkMode ??
    (field.relationConfig ? defaultRelationLinkMode(field.relationConfig.relationshipType) : 'set')

  const noMatchOptions: PolicyTabOption<RelationOnNoMatch>[] = [
    {
      value: 'create',
      label: 'Create',
      description: createAllowed
        ? `A missing ${targetResource?.label ?? 'record'} is created. New records are counted in the preview before anything is written.`
        : (createReason ?? 'This column cannot create records.'),
      disabled: !createAllowed,
      tooltip: createAllowed ? undefined : createReason,
    },
    {
      value: 'blank',
      label: 'Leave blank',
      description: 'The row still imports, without this link.',
    },
    { value: 'fail', label: 'Fail row', description: 'Nothing from this row is imported.' },
  ]

  const hasChanges =
    mergeStrategy !== null ||
    (isRelation && onNoMatch !== null) ||
    (isRelation && isMultiValued && linkMode !== null)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='icon-sm'
          aria-label='Column import policy'
          title='Import policy for this column'
          disabled={disabled}
          className={cn(
            'rounded-none border-r-0 bg-linear-0 shadow-none hover:inset-shadow-none',
            hasChanges ? 'text-info' : 'text-muted-foreground'
          )}
          onClick={(e) => e.stopPropagation()}>
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[340px] p-0' align='end' onClick={(e) => e.stopPropagation()}>
        <div className='px-3 py-2 border-b'>
          <p className='text-sm font-medium'>{field.label}</p>
          <p className='text-xs text-muted-foreground'>How this column is written</p>
        </div>

        {showMerge && (
          <PolicySection title='When updating an existing record'>
            <PolicyTabs
              value={mergeStrategy ?? 'overwrite'}
              options={MERGE_OPTIONS}
              onValueChange={(mergeStrategy) => onChange({ mergeStrategy })}
            />
          </PolicySection>
        )}

        {showMerge && isRelation && <Separator />}

        {isRelation && (
          <PolicySection title='If no matching record is found'>
            <PolicyTabs
              value={effectiveNoMatch}
              options={noMatchOptions}
              onValueChange={(onNoMatch) => onChange({ onNoMatch })}
            />
          </PolicySection>
        )}

        {isRelation && isMultiValued && (
          <>
            <Separator />
            <PolicySection title='On update, existing links'>
              <PolicyTabs
                value={effectiveLinkMode}
                options={LINK_MODE_OPTIONS}
                onValueChange={(linkMode) => onChange({ linkMode })}
              />
            </PolicySection>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** A titled block inside the policy popover. */
function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='px-3 py-2.5'>
      <p className='mb-2 text-xs font-medium text-muted-foreground'>{title}</p>
      {children}
    </div>
  )
}
