// apps/web/src/components/data-import/plan-preview/relation-create-summary.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Sparkles } from 'lucide-react'
import { useResource } from '~/components/resources'
import { api } from '~/trpc/react'

interface RelationCreateSummaryProps {
  jobId: string
}

/**
 * What `onNoMatch: 'create'` will mint, before anything is written.
 *
 * This is the control that makes defaulting a relation column to *Create* safe:
 * failing a whole part row over one unrecognised supplier throws away good
 * data, but silently minting companies is worse. The number shown here is what
 * turns the second into an informed choice.
 *
 * Counts are DISTINCT targets, 500 rows naming "Acme" produce one company, and
 * two columns naming the same supplier count once.
 */
export function RelationCreateSummary({ jobId }: RelationCreateSummaryProps) {
  const { data } = api.dataImport.getRelationCreateCounts.useQuery({ jobId })

  if (!data || data.total === 0) return null

  return (
    <div className='mx-4 rounded-2xl border bg-muted/40 px-3 py-2'>
      <div className='flex items-center gap-2'>
        <Sparkles className='size-4 text-info' />
        <span className='text-sm font-medium'>
          {data.total.toLocaleString()} linked record{data.total === 1 ? '' : 's'} will also be
          created
        </span>
      </div>
      <div className='mt-2 flex flex-col gap-1'>
        {data.byColumn.map((column) => (
          <RelationCreateRow
            key={column.jobPropertyId}
            entityDefinitionId={column.entityDefinitionId}
            columnName={column.sourceColumnName ?? `Column ${column.sourceColumnIndex + 1}`}
            matchField={column.matchField}
            values={column.values}
          />
        ))}
      </div>
    </div>
  )
}

interface RelationCreateRowProps {
  entityDefinitionId: string
  columnName: string
  matchField: string
  values: string[]
}

/** One relation column's create count, named with the target resource's label. */
function RelationCreateRow({
  entityDefinitionId,
  columnName,
  matchField,
  values,
}: RelationCreateRowProps) {
  const { resource } = useResource(entityDefinitionId)
  const label = resource?.plural ?? resource?.label ?? 'records'

  return (
    <div className='flex items-center gap-2 text-sm text-muted-foreground'>
      {resource && (
        <EntityIcon
          iconId={resource.icon}
          color={'color' in resource ? resource.color : undefined}
          size='xs'
        />
      )}
      <span className='text-foreground'>
        {values.length.toLocaleString()} {label}
      </span>
      <span>
        from <span className='font-medium'>{columnName}</span>, named by {matchField}
      </span>
      <Badge
        variant='outline'
        size='xs'
        className='truncate max-w-[220px]'
        title={values.join(', ')}>
        {values.slice(0, 3).join(', ')}
        {values.length > 3 ? ` +${values.length - 3}` : ''}
      </Badge>
    </div>
  )
}
