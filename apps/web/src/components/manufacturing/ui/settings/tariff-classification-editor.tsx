// apps/web/src/components/manufacturing/ui/settings/tariff-classification-editor.tsx
'use client'

// The right column of the Classification tab (money 30-tariff-offer-surfaces.md
// §6.2): the selected offer's THREE tariff rows and nothing else - the code
// picker, the override, and the Duty readout - the same three the supplier form
// renders, writing through `useSaveFieldValue` exactly as the Codes editor does.
//
// No price, no lead time, no SKU: that is what the supplier dialog is for, and
// the part badge at the top opens the drawer's Suppliers tab. One action only
// this pane has: Clear override, because the reason to be here is moving offers
// off the hand-keyed number and onto the schedule, and clearing a NUMBER input
// to empty is not an obvious gesture.

import { FieldType } from '@auxx/database/enums'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Package } from 'lucide-react'
import { useCallback, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { BaseType } from '~/components/workflow/types'
import type { ClassifiedOffer } from '../../hooks/use-offer-classification'
import { OfferTariffReadout } from '../offer-tariff-readout'

interface TariffClassificationEditorProps {
  offer: ClassifiedOffer | null
  /** What the schedule alone says for this offer, for the both-set warning. */
  scheduleTariff: ClassifiedOffer['tariff'] | undefined
  unavailable: boolean
  tariffCodeDefId: string | null
  canEdit: boolean
  /** Writes the pointer. Rejects with the server's message. */
  onSetCode: (recordId: RecordId, tariffCodeId: string | null) => Promise<void>
  /** Writes the override. `null` clears it. */
  onSetOverride: (recordId: RecordId, rate: number | null) => Promise<void>
}

export function TariffClassificationEditor({
  offer,
  scheduleTariff,
  unavailable,
  tariffCodeDefId,
  canEdit,
  onSetCode,
  onSetOverride,
}: TariffClassificationEditorProps) {
  if (!offer) {
    return (
      <div className='p-3'>
        <EmptySection
          orientation='horizontal'
          icon={<Package />}
          title='Select an offer'
          description='Set its tariff code, or clear an override so the schedule decides.'
        />
      </div>
    )
  }
  return (
    <OfferForm
      key={offer.id}
      offer={offer}
      scheduleTariff={scheduleTariff}
      unavailable={unavailable}
      tariffCodeDefId={tariffCodeDefId}
      canEdit={canEdit}
      onSetCode={onSetCode}
      onSetOverride={onSetOverride}
    />
  )
}

function OfferForm({
  offer,
  scheduleTariff,
  unavailable,
  tariffCodeDefId,
  canEdit,
  onSetCode,
  onSetOverride,
}: Omit<TariffClassificationEditorProps, 'offer'> & { offer: ClassifiedOffer }) {
  const tariffCodeField = useSystemField('vendor_part_tariff_code')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const run = useCallback(async (write: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await write()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change.')
    } finally {
      setPending(false)
    }
  }, [])

  return (
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <div className='mb-3 flex flex-wrap items-center gap-2 text-sm'>
          {offer.partRecordId && (
            <RecordBadge
              recordId={offer.partRecordId}
              variant='link'
              link={{ tab: 'vendors' }}
              openInStack
            />
          )}
          {offer.supplierRecordId && (
            <>
              <span className='text-muted-foreground text-xs'>from</span>
              <RecordBadge recordId={offer.supplierRecordId} variant='link' openInStack />
            </>
          )}
        </div>

        <FieldPanel
          // Side by side at the default pane width, stacked in the mobile drawer
          // or once the pane is dragged near its minimum.
          orientation='responsive'
          breakpoint='sm'
          resizeId='tariff-classification-detail'
          defaultLabelWidth={150}
          className='shrink-0 grow-0 p-0'>
          <FieldPanelRow
            title='Tariff code'
            type={BaseType.RELATION}
            showIcon
            description='Classification and country of origin. Sets the duty from the schedule.'>
            <FieldInputAdapter
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              fieldType={tariffCodeField?.fieldType ?? FieldType.RELATIONSHIP}
              fieldOptions={tariffCodeField?.options}
              value={
                offer.tariffCodeId && tariffCodeDefId
                  ? [toRecordId(tariffCodeDefId, offer.tariffCodeId)]
                  : []
              }
              onChange={(recordIds) => {
                const ids = recordIds as RecordId[]
                void run(() => onSetCode(offer.recordId, ids[0] ? getInstanceId(ids[0]) : null))
              }}
              placeholder='Select tariff code...'
              disabled={!canEdit || pending}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Override rate (%)'
            type={BaseType.NUMBER}
            showIcon
            description='Leave blank to use the schedule. Set it for a DDP price, a Section 301 exclusion, or an unclassified part.'>
            <div className='flex items-center gap-2'>
              <div className='min-w-0 flex-1'>
                <FieldInputAdapter
                  fieldType={FieldType.NUMBER}
                  value={offer.tariffRate}
                  onChange={(value) => {
                    const next = value === '' || value == null ? null : (value as number)
                    void run(() => onSetOverride(offer.recordId, next))
                  }}
                  placeholder='Schedule'
                  disabled={!canEdit || pending}
                />
              </div>
              {canEdit && offer.tariffRate != null && (
                <Button
                  variant='outline'
                  size='xs'
                  disabled={pending}
                  onClick={() => void run(() => onSetOverride(offer.recordId, null))}>
                  Clear override
                </Button>
              )}
            </div>
          </FieldPanelRow>

          <FieldPanelRow title='Duty' type={BaseType.NUMBER} showIcon>
            <OfferTariffReadout
              tariff={offer.tariff}
              scheduleTariff={scheduleTariff}
              codeLabel={offer.codeLabel ?? undefined}
              unavailable={unavailable}
            />
          </FieldPanelRow>
        </FieldPanel>

        {error && <p className='mt-2 text-destructive text-xs'>{error}</p>}
        <p className='mt-3 text-muted-foreground text-xs'>
          Changes save as you make them and move this part's estimated cost. Nothing already
          received or valued changes - a movement freezes its cost when it is written.
        </p>
      </ScrollArea>
    </div>
  )
}
