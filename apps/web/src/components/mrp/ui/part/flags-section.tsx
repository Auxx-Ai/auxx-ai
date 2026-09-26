// apps/web/src/components/mrp/ui/part/flags-section.tsx
'use client'

import { MRP_FLAG_LABELS, type MrpFlag } from '@auxx/lib/mrp/client'
import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Flag } from 'lucide-react'
import { api } from '~/trpc/react'
import { explainFlag } from './flag-explain'

/** The run's data-quality flags on this part, each with its explanation. */
export function FlagsSection({ partId, runId }: { partId: string; runId: string | null }) {
  const partItem = api.mrp.partItem.useQuery({ partId, runId })
  const item = partItem.data?.item
  const flags = (item?.flags ?? []).filter((f): f is MrpFlag => f in MRP_FLAG_LABELS)
  if (!item || flags.length === 0) return null

  return (
    <Section title='Flags'>
      <TreeRowList
        className='gap-px'
        items={flags}
        getKey={(f) => f}
        renderRow={(f) => (
          <TreeRow
            icon={<Flag className='size-4 text-amber-600' />}
            title={MRP_FLAG_LABELS[f]}
            secondary={explainFlag(f, item) || undefined}
            secondaryFill
          />
        )}
      />
    </Section>
  )
}
