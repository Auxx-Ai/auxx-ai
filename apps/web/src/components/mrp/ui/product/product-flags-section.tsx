// apps/web/src/components/mrp/ui/product/product-flags-section.tsx
'use client'

import { MRP_FLAG_LABELS, type MrpFlag } from '@auxx/lib/mrp/client'
import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Flag } from 'lucide-react'
import { api } from '~/trpc/react'
import { explainFlag } from '../part/flag-explain'
import { type MrpProductVariantData, variantName } from './product-key-numbers'

interface VariantFlag {
  partId: string
  flag: MrpFlag
  item: NonNullable<MrpProductVariantData['item']>
}

/** The stocked variants' run flags, one row per (variant, flag), the variant named first. */
export function ProductFlagsSection({
  productId,
  runId,
}: {
  productId: string
  runId: string | null
}) {
  const productItem = api.mrp.productItem.useQuery({ productId, runId })
  const data = productItem.data
  const rows: VariantFlag[] = []
  for (const { partId, flag } of data?.flags ?? []) {
    if (!(flag in MRP_FLAG_LABELS)) continue
    const item = data?.variants.find((v) => v.partId === partId)?.item
    if (item) rows.push({ partId, flag: flag as MrpFlag, item })
  }
  if (rows.length === 0) return null

  return (
    <Section title='Flags'>
      <TreeRowList
        className='gap-px'
        items={rows}
        getKey={(r) => `${r.partId}:${r.flag}`}
        renderRow={(r) => {
          const explanation = explainFlag(r.flag, r.item)
          const name = variantName(data, r.partId)
          return (
            <TreeRow
              icon={<Flag className='size-4 text-amber-600' />}
              title={MRP_FLAG_LABELS[r.flag]}
              secondary={explanation ? `${name} · ${explanation}` : name}
              secondaryFill
            />
          )
        }}
      />
    </Section>
  )
}
