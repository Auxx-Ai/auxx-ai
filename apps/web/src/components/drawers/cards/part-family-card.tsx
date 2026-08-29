// apps/web/src/components/drawers/cards/part-family-card.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import {
  getInstanceId,
  isRecordId,
  PartKind,
  ProductStatus,
  parseRecordId,
  type RecordId,
} from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { pluralize } from '@auxx/utils'
import { Package, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSaveSystemValues } from '~/components/resources/hooks/use-save-system-values'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordLink } from '~/components/resources/ui/record-link'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  isPartKindUnclassified,
  shouldSuggestFamily,
  shouldSuggestFinishedGood,
} from './part-family-suggestion'

/** The part's own family-relevant fields. */
const PART_FAMILY_ATTRIBUTES = ['part_product', 'part_kind'] as const
/** ...and the product's, once the relation resolves. */
const PRODUCT_ATTRIBUTES = ['product_title', 'product_status'] as const

/** `ProductStatus.values` keyed by option value, for badge label + color. */
const PRODUCT_STATUS_BY_VALUE = Object.fromEntries(ProductStatus.values.map((v) => [v.value, v]))

/**
 * How many siblings render before the list collapses behind "Show all".
 *
 * A Shopify family can carry dozens of variants, and an overview card is not a
 * list surface — the product's own Variants tab is. Five is enough to see what
 * kind of family this is.
 */
const SIBLING_LIMIT = 5

/** Synthetic relationship config for the ad-hoc product picker (not a real field). */
const PRODUCT_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('product', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

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
 * The card hosts BOTH halves of the classification loop, and they are mutually
 * exclusive by construction:
 *
 * - the `finished_good` suggestion (01 §4) — a part that has a product and is
 *   nobody's subpart is almost certainly a finished good. Offered while
 *   `part_kind` is unclassified (unset, or the `component` the field defaults
 *   to since 15-costing-usability.md §4c); never over an explicit
 *   `subassembly` or `finished_good`.
 * - the **family** suggestion (09 §6) — a part already classified
 *   `finished_good` that sits in no family. Without it a part with no family
 *   rendered nothing at all, so there was no route into a family from this side
 *   either: the user had to know products existed and find the Product field in
 *   the Details panel.
 *
 * Both write through the SAME path the Details panel's inputs use
 * (`useSaveSystemValues` → the field-value store mutation) — a suggestion the
 * user confirms, never an auto-write.
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

  const [showAllSiblings, setShowAllSiblings] = useState(false)
  const [isPickingProduct, setIsPickingProduct] = useState(false)

  const productRecordId =
    productDefId && productId ? toRecordId(productDefId, productId) : undefined
  const { values: productValues } = useSystemValues(productRecordId, PRODUCT_ATTRIBUTES, {
    autoFetch: true,
    enabled: !!productRecordId,
  })
  const productTitle = productValues.product_title as string | undefined
  const productStatus = productValues.product_status as string | undefined

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
  //
  // Gated on the same predicate condition (c) uses, so the read runs for every
  // part the suggestion could fire on. That now includes a part sitting on the
  // defaulted `component` (15-costing-usability.md §4c). With the old
  // unset-only gate the lookup would never run for those, `subpartCheckLoaded`
  // would stay false, and the widened suggestion could never appear.
  const partKindUnclassified = isPartKindUnclassified(partKind)
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
    enabled: !!productId && partKindUnclassified && !!partId && !!subpartDefId,
  })

  const { save, isPending } = useSaveSystemValues(recordId)

  const suggestFinishedGood = shouldSuggestFinishedGood({
    hasProduct: !!productId,
    partKind,
    subpartCheckLoaded: !isLoadingUsedIn,
    isSubpartOfAssembly: usedInRecords.length > 0,
  })

  const suggestFamily = shouldSuggestFamily({ hasProduct: !!productId, partKind })

  // No family. A finished good still gets the one row that offers it one —
  // everything else renders nothing and TabCardSection hides the section.
  if (!productId) {
    if (!suggestFamily) return null
    return (
      <div className='flex flex-wrap items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 p-2.5'>
        <Package className='size-4 shrink-0 text-blue-600' />
        <p className='min-w-40 flex-1 text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>Not in a product family.</span> Finished
          goods usually belong to one.
        </p>
        {isPickingProduct ? (
          <div className='w-48'>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              value={[]}
              onChange={(value) => {
                const recordIds = value as RecordId[]
                const first = recordIds[0]
                if (!first) return
                void save({ part_product: first })
                setIsPickingProduct(false)
              }}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              placeholder='Select a product...'
              disabled={isPending}
              fieldOptions={{ relationship: PRODUCT_RELATIONSHIP, showDefinitionIcon: true }}
            />
          </div>
        ) : (
          <Button
            variant='outline'
            size='xs'
            loading={isPending}
            loadingText='Saving...'
            onClick={() => setIsPickingProduct(true)}>
            Choose Product
          </Button>
        )}
      </div>
    )
  }

  const statusMeta = productStatus ? PRODUCT_STATUS_BY_VALUE[productStatus] : undefined
  const variantIndex = siblings.findIndex((record) => record.id === partId)
  const hiddenSiblingCount = Math.max(0, siblings.length - SIBLING_LIMIT)
  const visibleSiblings = showAllSiblings ? siblings : siblings.slice(0, SIBLING_LIMIT)

  return (
    <div className='space-y-2'>
      <FieldPanel resizeId='part-family' defaultLabelWidth={130}>
        <FieldPanelRow title='Product'>
          <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm'>
            <RecordLink recordId={productRecordId} className='truncate font-medium' openInStack>
              {productTitle ?? 'Loading...'}
            </RecordLink>
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
                {visibleSiblings.map((sibling) =>
                  sibling.id === partId ? (
                    <span key={sibling.id} className='truncate font-medium'>
                      {sibling.displayName ?? 'Untitled'}
                      <span className='ms-1.5 text-xs font-normal text-muted-foreground'>
                        (this part)
                      </span>
                    </span>
                  ) : (
                    <RecordLink
                      key={sibling.id}
                      recordId={toRecordId(partDefId ?? 'part', sibling.id)}
                      className='truncate'
                      openInStack>
                      {sibling.displayName ?? 'Untitled'}
                    </RecordLink>
                  )
                )}
                {hiddenSiblingCount > 0 && !showAllSiblings && (
                  <button
                    type='button'
                    className='self-start text-xs text-muted-foreground hover:text-foreground hover:underline'
                    onClick={() => setShowAllSiblings(true)}>
                    Show all {siblings.length}
                  </button>
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
