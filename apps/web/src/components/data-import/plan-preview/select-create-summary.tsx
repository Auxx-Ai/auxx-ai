// apps/web/src/components/data-import/plan-preview/select-create-summary.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { ListPlus } from 'lucide-react'
import { api } from '~/trpc/react'
import { SummaryTreeRow } from './summary-tree-row'

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
    <SummaryTreeRow
      icon={<ListPlus className='size-4 text-info' />}
      title={`${data.total.toLocaleString()} new option${data.total === 1 ? '' : 's'} will be added`}>
      {data.byField.map((field) => (
        <SelectCreateRow
          key={field.fieldId}
          fieldLabel={field.fieldLabel || field.targetFieldKey}
          labels={field.labels}
        />
      ))}
    </SummaryTreeRow>
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
    <TreeRow
      depth={1}
      title={`${labels.length.toLocaleString()} new ${fieldLabel} option${labels.length === 1 ? '' : 's'}`}
      secondary={
        <span className='flex min-w-0 items-center gap-1 overflow-hidden'>
          {named.map((label) => (
            <Badge key={label} variant='outline' size='xs' className='max-w-[160px] truncate'>
              {label}
            </Badge>
          ))}
          {overflow > 0 && (
            // The full list stays reachable rather than being lost to the cap: a bad label must be spottable.
            <Badge variant='outline' size='xs' title={labels.join(', ')}>
              +{overflow.toLocaleString()} more
            </Badge>
          )}
        </span>
      }
    />
  )
}
