// apps/web/src/components/drawers/cards/part-family-card.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import {
  getInstanceId,
  isRecordId,
  PartKind,
  ProductStatus,
  parseRecordId,
} from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { pluralize } from '@auxx/utils'
import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  toRecordId,
  useRecordLink,
  useRecordList,
  useResourceProperty,
} from '~/components/resources'
import { useSaveSystemValues } from '~/components/resources/hooks/use-save-system-values'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { isPartKindUnset, shouldSuggestFinishedGood } from './part-family-suggestion'

/** The part's own family-relevant fields. */
const PART_FAMILY_ATTRIBUTES = ['part_product', 'part_kind'] as const
/** ...and the product's, once the relation resolves. */
const PRODUCT_ATTRIBUTES = ['product_title', 'product_status'] as const

/** `ProductStatus.values` keyed by option value, for badge label + color. */
const PRODUCT_STATUS_BY_VALUE = Object.fromEntries(ProductStatus.values.map((v) => [v.value, v]))

/** Unwrap a RELATIONSHIP value into the related instance id. */
function relatedInstanceId(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first !== 'string') return undefined
  return isRecordId(first) ? getInstanceId(first) : first
}

/**
 * Product-family membership for the part drawer's overview
 * (plans/products/01-product-family.md phase 3).
 *
 * Renders NOTHING when the part has no `product` relation — most parts are raw
 * materials with no family, and `TabCardSection` hides the whole "Family"
 * section for them. When it has one: the product (click-through to its record),
 * its status, and the sibling variants with the current part marked.
 *
 * Also hosts the `finished_good` suggestion (§4): a part that has a product
 * and is nobody's subpart is almost certainly a finished good. One click
 * writes `part_kind = 'finished_good'` through the SAME write path the
 * Details panel's select uses (`useSaveSystemValues` → the field-value store
 * mutation) — a suggestion the user confirms, never an auto-write, and never
 * offered over an explicit human choice (`part_kind` set).
 *
 * Reads are the standard drawer paths: the relation via `useSystemValues`,
 * siblings via `useRecordList` filtered on `part:product` (the same filter the
 * product's Variants tab uses), and the "is nobody's subpart" check via a
 * `subpart` list filtered by CHILD part, limit 1 — the child-side twin of
 * part-costing-card's subpart-presence read.
 */
export function PartFamilyCard({ recordId }: DrawerTabProps) {
  const { entityInstanceId: partId } = parseRecordId(recordId)

  const { values } = useSystemValues(recordId, PART_FAMILY_ATTRIBUTES, { autoFetch: true })
  const productId = relatedInstanceId(values.part_product)
  const partKind = values.part_kind

  const productDefId = useResourceProperty('product', 'id')
  const partDefId = useResourceProperty('part', 'id')
  const subpartDefId = useResourceProperty('subpart', 'id')

  const productRecordId =
    productDefId && productId ? toRecordId(productDefId, productId) : undefined
  const { values: productValues } = useSystemValues(productRecordId, PRODUCT_ATTRIBUTES, {
    autoFetch: true,
    enabled: !!productRecordId,
  })
  const productTitle = productValues.product_title as string | undefined
  const productStatus = productValues.product_status as string | undefined
  const productLink = useRecordLink(productRecordId)

  // Sibling variants: every part on the same family edge, this one included.
  const siblingFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'product-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'product-match',
            fieldId: 'part:product' as ResourceFieldId,
            operator: 'is' as const,
            value: productId ?? '',
          },
        ],
      },
    ],
    [productId]
  )
  const { records: siblings, isLoading: isLoadingSiblings } = useRecordList({
    entityDefinitionId: partDefId ?? '',
    filters: siblingFilters,
    enabled: !!productId && !!partDefId,
  })

  // Finished-good condition (b): is this part anybody's subpart? Child-side
  // filter (`subpart:childPart`), limit 1 — presence is the only question.
  const partKindUnset = isPartKindUnset(partKind)
  const usedInFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'child-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'child-match',
            fieldId: 'subpart:childPart' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )
  const { records: usedInRecords, isLoading: isLoadingUsedIn } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: usedInFilters,
    limit: 1,
    enabled: !!productId && partKindUnset && !!partId && !!subpartDefId,
  })

  const { save, isPending } = useSaveSystemValues(recordId)

  const suggestFinishedGood = shouldSuggestFinishedGood({
    hasProduct: !!productId,
    partKind,
    subpartCheckLoaded: !isLoadingUsedIn,
    isSubpartOfAssembly: usedInRecords.length > 0,
  })

  // No family → no card; TabCardSection hides the whole section.
  if (!productId) return null

  const statusMeta = productStatus ? PRODUCT_STATUS_BY_VALUE[productStatus] : undefined
  const variantIndex = siblings.findIndex((record) => record.id === partId)

  return (
    <div className='space-y-2'>
      <FieldPanel resizeId='part-family' defaultLabelWidth={130}>
        <FieldPanelRow title='Product'>
          <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm'>
            {productLink ? (
              <Link href={productLink} className='truncate font-medium hover:underline'>
                {productTitle ?? 'Loading...'}
              </Link>
            ) : (
              <span className='truncate font-medium'>{productTitle ?? 'Loading...'}</span>
            )}
            {statusMeta && (
              <Badge variant={(statusMeta.color ?? 'gray') as Variant} size='xs'>
                {statusMeta.label}
              </Badge>
            )}
          </div>
        </FieldPanelRow>
        <FieldPanelRow title='Variants'>
          <div className='flex min-h-8 flex-col justify-center gap-0.5 py-1.5 text-sm'>
            {isLoadingSiblings ? (
              <span className='text-muted-foreground'>Loading...</span>
            ) : (
              <>
                <span className='text-xs text-muted-foreground'>
                  {variantIndex >= 0
                    ? `Variant ${variantIndex + 1} of ${siblings.length}`
                    : `${siblings.length} ${pluralize(siblings.length, 'variant')}`}
                  {productTitle ? ` in ${productTitle}` : ''}
                </span>
                {siblings.map((sibling) =>
                  sibling.id === partId ? (
                    <span key={sibling.id} className='truncate font-medium'>
                      {sibling.displayName ?? 'Untitled'}
                      <span className='ms-1.5 text-xs font-normal text-muted-foreground'>
                        (this part)
                      </span>
                    </span>
                  ) : (
                    <Link
                      key={sibling.id}
                      href={`/app/parts?id=${sibling.id}`}
                      className='truncate hover:underline'>
                      {sibling.displayName ?? 'Untitled'}
                    </Link>
                  )
                )}
              </>
            )}
          </div>
        </FieldPanelRow>
      </FieldPanel>

      {suggestFinishedGood && (
        <div className='flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/10 p-2.5'>
          <Sparkles className='size-4 shrink-0 text-green-600' />
          <p className='flex-1 text-xs text-muted-foreground'>
            <span className='font-medium text-foreground'>Finished good?</span> This part heads a
            product family and is not used in any assembly.
          </p>
          <Button
            variant='outline'
            size='xs'
            loading={isPending}
            loadingText='Saving...'
            onClick={() => void save({ part_kind: PartKind.FINISHED_GOOD })}>
            Set Finished Good
          </Button>
        </div>
      )}
    </div>
  )
}
