// apps/web/src/components/data-import/plan-preview/select-create-summary.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ListPlus } from 'lucide-react'
import { api } from '~/trpc/react'

/** How many option names are spelled out before the rest collapse into a `+N`. */
const NAMED_LABEL_LIMIT = 8

interface SelectCreateSummaryProps {
  jobId: string
}

/**
 * Which OPTIONS a `select:create` column will append to its field, by name.
 *
 * The twin of {@link RelationCreateSummary}, and the entire safety story behind
 * the resolution-type picker. Choosing `select:create` on a column IS the
 * per-column consent to grow that field's taxonomy — so the one thing standing
 * between a typo in row 47 and a permanent option on the field is reading the
 * list before Import is pressed. That is why the labels are NAMED here and not
 * merely counted: *"13 new Categories"* is a number a user can only accept on
 * faith, *"Steel, Plastic, Shelf, …"* is one they can check.
 *
 * Nothing is written until execution; the counts come from the same
 * `mintOrMatchOptions` dry run the real write uses, so an option already on the
 * field (in any casing or spacing) is folded away here exactly as it will be
 * then, and the preview cannot promise options the run will not create.
 */
export function SelectCreateSummary({ jobId }: SelectCreateSummaryProps) {
  const { data } = api.dataImport.getSelectCreateCounts.useQuery({ jobId })

  if (!data || data.total === 0) return null

  return (
    <div className='mx-4 rounded-2xl border bg-muted/40 px-3 py-2'>
      <div className='flex items-center gap-2'>
        <ListPlus className='size-4 text-info' />
        <span className='text-sm font-medium'>
          {data.total.toLocaleString()} new option{data.total === 1 ? '' : 's'} will be added
        </span>
      </div>
      <div className='mt-2 flex flex-col gap-1.5'>
        {data.byField.map((field) => (
          <SelectCreateRow
            key={field.fieldId}
            fieldLabel={field.fieldLabel || field.targetFieldKey}
            labels={field.labels}
          />
        ))}
      </div>
    </div>
  )
}

interface SelectCreateRowProps {
  fieldLabel: string
  labels: string[]
}

/** One grown field's new options, named. */
function SelectCreateRow({ fieldLabel, labels }: SelectCreateRowProps) {
  const named = labels.slice(0, NAMED_LABEL_LIMIT)
  const overflow = labels.length - named.length

  return (
    <div className='flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground'>
      <span className='text-foreground'>
        {labels.length.toLocaleString()} new {fieldLabel}
      </span>
      <span>option{labels.length === 1 ? '' : 's'}:</span>
      {named.map((label) => (
        <Badge key={label} variant='outline' size='xs' className='max-w-[220px] truncate'>
          {label}
        </Badge>
      ))}
      {overflow > 0 && (
        // The full list stays reachable rather than being lost to the cap — the
        // whole point of this panel is that a bad label can be spotted.
        <Badge variant='outline' size='xs' title={labels.join(', ')}>
          +{overflow.toLocaleString()} more
        </Badge>
      )}
    </div>
  )
}
