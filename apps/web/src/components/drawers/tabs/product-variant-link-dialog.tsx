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
import { toastError } from '@auxx/ui/components/toast'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BaseType } from '~/components/workflow/types'

/** Synthetic relationship config for the ad-hoc part picker (not a real field). */
const PART_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('part', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

/** The candidate's own family, read to decide whether this is an add or a move. */
const CANDIDATE_ATTRIBUTES = ['part_product'] as const
/** ...and the family's name, once the relation resolves. */
const PRODUCT_ATTRIBUTES = ['product_title'] as const

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
 * Link an EXISTING part into a product family
 * (plans/products/09-variant-ui.md §3.3).
 *
 * A create-only "Add variant" would be the wrong tool for the common case: any
 * org reaching this screen already has parts carrying BOMs, costs and supplier
 * offers, and creating fresh ones to group them would leave four duplicates and
 * four orphaned BOMs.
 *
 * ⚠️ `part.product` is **belongs_to**, so linking a part that already has a
 * family MOVES it — silently, if nothing says so. The dialog reads the
 * candidate's current family and, when it has one, names it and changes the
 * confirm verb to "Move". This is the whole reason the picker is a dialog and
 * not an inline combobox.
 *
 * The write is a plain relation save on the PART, through the same
 * `useSaveFieldValue` path the Details panel uses — never a create.
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

  const [selectedPartId, setSelectedPartId] = useState('')

  useEffect(() => {
    if (open) setSelectedPartId('')
  }, [open])

  const selectedRecordId =
    selectedPartId && partDefId ? toRecordId(partDefId, selectedPartId) : undefined

  // The candidate's CURRENT family — the add-vs-move discriminator.
  const { values: candidateValues } = useSystemValues(selectedRecordId, CANDIDATE_ATTRIBUTES, {
    autoFetch: true,
    enabled: !!selectedRecordId,
  })
  const currentProductId = relatedInstanceId(candidateValues.part_product)
  // A part already on THIS family is excluded from the picker, so any current
  // family here is a different one.
  const isMove = !!currentProductId && currentProductId !== productId

  const currentProductRecordId =
    productDefId && currentProductId ? toRecordId(productDefId, currentProductId) : undefined
  const { values: currentProductValues } = useSystemValues(
    currentProductRecordId,
    PRODUCT_ATTRIBUTES,
    { autoFetch: true, enabled: !!currentProductRecordId }
  )
  const currentProductTitle = currentProductValues.product_title as string | undefined

  const { saveMultipleAsync, isPending } = useSaveFieldValue({})

  const handleSubmit = async () => {
    if (!selectedRecordId || !productDefId) return
    const success = await saveMultipleAsync(selectedRecordId, [
      {
        fieldId: 'part_product',
        value: toRecordId(productDefId, productId),
        fieldType: FieldType.RELATIONSHIP,
      },
    ])
    if (!success) {
      toastError({
        title: isMove ? 'Error moving part' : 'Error linking part',
        description: 'The part could not be linked to this product.',
      })
      return
    }
    onSuccess?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <DialogHeader>
          <DialogTitle>Link Existing Part</DialogTitle>
          <DialogDescription>
            Add a part you already have to this product family as a variant
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          className='p-0'
          orientation='responsive'
          breakpoint='md'
          resizeId='variant-link'
          defaultLabelWidth={140}>
          <FieldPanelRow
            title='Part'
            description='Parts already in this family are hidden'
            type={BaseType.RELATION}
            showIcon
            isRequired>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              value={selectedRecordId ? [selectedRecordId] : []}
              onChange={(value) => {
                const recordIds = value as RecordId[]
                const first = recordIds[0]
                setSelectedPartId(first ? getInstanceId(first) : '')
              }}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              placeholder='Select a part...'
              disabled={isPending}
              fieldOptions={{
                relationship: PART_RELATIONSHIP,
                excludeIds: excludeRecordIds,
                showDefinitionIcon: true,
              }}
            />
          </FieldPanelRow>
        </FieldPanel>

        {isMove && (
          <div className='flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5'>
            <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-600' />
            <p className='text-xs text-muted-foreground'>
              <span className='font-medium text-foreground'>Already in a family.</span> This part is
              currently a variant of{' '}
              <span className='font-medium text-foreground'>
                {currentProductTitle ?? 'another product'}
              </span>
              . A part belongs to one product, so linking it here moves it.
            </p>
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
            loadingText={isMove ? 'Moving...' : 'Linking...'}
            disabled={!selectedPartId || !productDefId}
            data-dialog-submit>
            {isMove ? 'Move to This Product' : 'Link Part'}{' '}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
