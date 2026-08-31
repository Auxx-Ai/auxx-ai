// apps/web/src/components/drawers/tabs/product-variant-link-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { getInstanceId, isRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { BaseType } from '~/components/workflow/types'

/** Synthetic relationship config for the ad-hoc part picker (not a real field). */
const PART_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('part', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

/** The candidates' own family, read to decide whether each is an add or a move. */
const CANDIDATE_ATTRIBUTES = ['part_product'] as const
/** ...and those families' names, once the relations resolve. */
const PRODUCT_ATTRIBUTES = ['product_title'] as const

/** How many moving parts are named before the banner collapses to "+n more". */
const MAX_LISTED_MOVES = 6

/** Unwrap a RELATIONSHIP value into the related instance id. */
function relatedInstanceId(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first !== 'string') return undefined
  return isRecordId(first) ? getInstanceId(first) : first
}

interface ProductVariantLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The family being linked INTO. */
  productId: string
  /** Parts already on this family — excluded so the picker cannot be a no-op. */
  excludeRecordIds: RecordId[]
  /** Called after a successful link. */
  onSuccess?: () => void
}

/**
 * Link EXISTING parts into a product family
 * (plans/products/09-variant-ui.md §3.3).
 *
 * A create-only "Add variant" would be the wrong tool for the common case: any
 * org reaching this screen already has parts carrying BOMs, costs and supplier
 * offers, and creating fresh ones to group them would leave four duplicates and
 * four orphaned BOMs.
 *
 * The picker is multi-select, and the write is ONE `fieldValue.setBulk` for the
 * whole selection — not a loop — through the same store-optimistic path the
 * Details panel uses. Never a create.
 *
 * ⚠️ `part.product` is **belongs_to**, so linking a part that already has a
 * family MOVES it — silently, if nothing says so. The dialog batch-reads every
 * candidate's current family, names the ones that would move and the families
 * they'd leave, and changes the confirm verb. This is the whole reason the
 * picker is a dialog and not an inline combobox.
 *
 * That check is also why the confirm button waits on `candidatesResolved`: the
 * picker returns an id instantly but its family lands a wave later, so a fast
 * click could otherwise move parts before the warning ever painted.
 */
export function ProductVariantLinkDialog({
  open,
  onOpenChange,
  productId,
  excludeRecordIds,
  onSuccess,
}: ProductVariantLinkDialogProps) {
  const partDefId = useResourceProperty('part', 'id')
  const productDefId = useResourceProperty('product', 'id')

  // Held exactly as the picker emits them — the picker matches its rows by
  // string equality against this array, so re-shaping the ids here would break
  // the checkmarks and let the same part be selected twice.
  const [selectedRecordIds, setSelectedRecordIds] = useState<RecordId[]>([])

  useEffect(() => {
    if (open) setSelectedRecordIds([])
  }, [open])

  // ...and canonicalised on the def id for every read and write.
  const partRecordIds = useMemo(
    () =>
      partDefId ? selectedRecordIds.map((id) => toRecordId(partDefId, getInstanceId(id))) : [],
    [partDefId, selectedRecordIds]
  )

  // The candidates' CURRENT families — the add-vs-move discriminator, one batch.
  const { valuesById: candidateValues, loadedById: candidateLoaded } = useSystemValuesForRecords(
    partRecordIds,
    CANDIDATE_ATTRIBUTES,
    { autoFetch: true, enabled: partRecordIds.length > 0 }
  )

  /** Whether every selected part's family has actually been read. */
  const candidatesResolved = partRecordIds.every(
    (recordId) => candidateLoaded[recordId]?.part_product === true
  )

  // Parts already in THIS family are excluded from the picker, so any current
  // family here is a different one.
  const moving = useMemo(
    () =>
      partRecordIds
        .map((recordId) => ({
          recordId,
          currentProductId: relatedInstanceId(candidateValues[recordId]?.part_product),
        }))
        .filter(
          (entry): entry is { recordId: RecordId; currentProductId: string } =>
            !!entry.currentProductId && entry.currentProductId !== productId
        ),
    [partRecordIds, candidateValues, productId]
  )

  const currentProductRecordIds = useMemo(() => {
    if (!productDefId) return []
    const ids = new Set<RecordId>()
    for (const { currentProductId } of moving) ids.add(toRecordId(productDefId, currentProductId))
    return [...ids]
  }, [productDefId, moving])

  const { valuesById: currentProductValues } = useSystemValuesForRecords(
    currentProductRecordIds,
    PRODUCT_ATTRIBUTES,
    { autoFetch: true, enabled: currentProductRecordIds.length > 0 }
  )

  // All-or-nothing on purpose: naming three of four families reads as "these
  // are the ones you'd empty", which is a lie about the fourth.
  const currentProductTitles = currentProductRecordIds
    .map((recordId) => currentProductValues[recordId]?.product_title)
    .filter((title): title is string => typeof title === 'string' && title !== '')
  const familyLabel =
    currentProductTitles.length === currentProductRecordIds.length
      ? currentProductTitles.join(', ')
      : currentProductRecordIds.length > 1
        ? 'their current products'
        : 'another product'

  const handleSaved = useCallback(() => {
    onSuccess?.()
    onOpenChange(false)
  }, [onSuccess, onOpenChange])

  // The hook is dialog-local, so its `onSuccess` can only be this one write.
  const { saveBulkValues, isPending } = useSaveFieldValue({ onSuccess: handleSaved })

  const handleSubmit = () => {
    if (!partRecordIds.length || !productDefId) return
    saveBulkValues(
      partRecordIds,
      'part_product',
      toRecordId(productDefId, productId),
      FieldType.RELATIONSHIP
    )
  }

  const count = partRecordIds.length
  const moveCount = moving.length
  const confirmLabel = (() => {
    if (moveCount === 0) return count > 1 ? `Link ${count} Parts` : 'Link Part'
    if (moveCount === count) return count > 1 ? `Move ${count} Parts` : 'Move to This Product'
    return `Link & Move ${count} Parts`
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <DialogHeader>
          <DialogTitle>Link Existing Parts</DialogTitle>
          <DialogDescription>
            Add parts you already have to this product family as variants
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          className='p-0'
          orientation='responsive'
          breakpoint='md'
          resizeId='variant-link'
          defaultLabelWidth={140}>
          <FieldPanelRow
            title='Parts'
            description='Parts already in this family are hidden'
            type={BaseType.RELATION}
            showIcon
            isRequired>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              value={selectedRecordIds}
              allowMultiple
              onChange={(value) => setSelectedRecordIds(value as RecordId[])}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              placeholder='Select parts...'
              disabled={isPending}
              fieldOptions={{
                relationship: PART_RELATIONSHIP,
                excludeIds: excludeRecordIds,
                showDefinitionIcon: true,
              }}
            />
          </FieldPanelRow>
        </FieldPanel>

        {moveCount > 0 && (
          <div className='flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5'>
            <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-600' />
            <div className='space-y-1.5'>
              <p className='text-xs text-muted-foreground'>
                <span className='font-medium text-foreground'>
                  {moveCount === 1
                    ? 'Already in a family.'
                    : `${moveCount} of these parts are already in a family.`}
                </span>{' '}
                A part belongs to one product, so linking {moveCount === 1 ? 'it' : 'them'} here
                moves {moveCount === 1 ? 'it' : 'them'} out of{' '}
                <span className='font-medium text-foreground'>{familyLabel}</span>.
              </p>
              <div className='flex flex-wrap items-center gap-1'>
                {moving.slice(0, MAX_LISTED_MOVES).map(({ recordId }) => (
                  <RecordBadge key={recordId} recordId={recordId} size='sm' />
                ))}
                {moveCount > MAX_LISTED_MOVES && (
                  <span className='text-xs text-muted-foreground'>
                    +{moveCount - MAX_LISTED_MOVES} more
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText={moveCount > 0 ? 'Moving...' : 'Linking...'}
            disabled={!count || !productDefId || !candidatesResolved}
            data-dialog-submit>
            {confirmLabel} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
