// apps/web/src/components/drawers/cards/part-pricing-card.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { parseRecordId } from '@auxx/lib/resources/client'
import type { FieldId } from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { formatCurrency } from '@auxx/utils/currency'
import { Sparkles } from 'lucide-react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useConnectorName } from '~/components/resources/hooks/use-connector-name'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useFieldManagedState } from '~/components/resources/hooks/use-field-values'
import { useSaveSystemValues } from '~/components/resources/hooks/use-save-system-values'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { derivePricingCardState } from './part-sellable-state'

const PART_ATTRIBUTES = [
  'part_kind',
  'part_sellable',
  'part_sell_price',
  'part_markup',
  'part_taxable',
  'part_cost',
] as const

function readNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** The part drawer's `part:pricing` overview card: the part's own selling fields (107 D3, D5, D11). */
export function PartPricingCard({ recordId }: DrawerTabProps) {
  const { entityDefinitionId } = parseRecordId(recordId)
  const { values } = useSystemValues(recordId, PART_ATTRIBUTES, { autoFetch: true })
  const { save, isPending } = useSaveSystemValues(recordId)

  const priceField = useSystemField('part_sell_price', entityDefinitionId)
  const sync = useFieldManagedState(recordId, priceField?.id ?? ('' as FieldId))
  // A paused binding leaves the price to the person, so markup applies again.
  const connectorPriced = !!sync && sync.state !== 'paused'
  const connectorName = useConnectorName(connectorPriced ? sync?.connectorId : null)

  // Unfetched reads `undefined`; a toggle guessed off it would flash the wrong answer.
  if (values.part_sellable === undefined) return null

  const sellable = values.part_sellable === true
  const priceCents = readNumber(values.part_sell_price)
  const markup = readNumber(values.part_markup)
  const cost = readNumber(values.part_cost)
  // Stored default is true; an older part may have no row.
  const taxable = values.part_taxable !== false

  const state = derivePricingCardState({
    partKind: values.part_kind,
    sellable,
    priceCents,
    markup,
    connectorPriced,
  })

  return (
    <div className='space-y-2'>
      <FieldPanel resizeId='part-pricing' defaultLabelWidth={130}>
        <FieldPanelRow title='Sellable'>
          <div className='flex min-h-8 items-center'>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              fieldOptions={{ variant: 'switch' }}
              value={sellable}
              disabled={isPending}
              onChange={(value) => void save({ part_sellable: value === true })}
            />
          </div>
        </FieldPanelRow>

        {state.showPricing && (
          <>
            <FieldPanelRow title='Price'>
              {state.priceEditable ? (
                <div className='flex flex-1 items-center gap-2'>
                  <FieldInputAdapter
                    fieldType={FieldType.CURRENCY}
                    fieldOptions={priceField?.options}
                    value={priceCents}
                    onChange={(value) =>
                      void save({ part_sell_price: (value as number | undefined) ?? null })
                    }
                    placeholder='0.00'
                  />
                  {state.autoPriced && (
                    <Badge variant='blue' size='xs'>
                      Auto
                    </Badge>
                  )}
                </div>
              ) : (
                <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm tabular-nums'>
                  {priceCents !== null ? formatCurrency(priceCents) : 'No price'}
                  <span className='text-xs text-muted-foreground'>
                    Edit in {connectorName ?? 'the connected store'}
                  </span>
                </div>
              )}
            </FieldPanelRow>

            {state.showMarkup && (
              <FieldPanelRow title='Markup (%)'>
                <FieldInputAdapter
                  fieldType={FieldType.NUMBER}
                  value={markup}
                  onChange={(value) =>
                    void save({ part_markup: (value as number | undefined) ?? null })
                  }
                  placeholder='Set to price from cost'
                />
              </FieldPanelRow>
            )}

            <FieldPanelRow title='Taxable'>
              <div className='flex min-h-8 items-center'>
                <FieldInputAdapter
                  fieldType={FieldType.CHECKBOX}
                  fieldOptions={{ variant: 'switch' }}
                  value={taxable}
                  disabled={isPending}
                  onChange={(value) => void save({ part_taxable: value === true })}
                />
              </div>
            </FieldPanelRow>

            <FieldPanelRow title='Cost'>
              <div className='flex min-h-8 items-center text-sm tabular-nums'>
                {cost !== null ? (
                  formatCurrency(cost)
                ) : (
                  <span className='text-muted-foreground'>No cost</span>
                )}
              </div>
            </FieldPanelRow>
          </>
        )}
      </FieldPanel>

      {state.nudge && (
        <div className='flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-2.5'>
          <Sparkles className='size-4 shrink-0 text-amber-600' />
          <p className='flex-1 text-xs text-muted-foreground'>
            <span className='font-medium text-foreground'>
              {state.nudge === 'no-price' ? 'No price set.' : 'Not sellable.'}
            </span>{' '}
            {state.nudge === 'no-price'
              ? 'Set a price, or a markup once the item has a cost.'
              : "This item can't be picked on quotes or invoices. Turn on Sellable to sell it."}
          </p>
        </div>
      )}
    </div>
  )
}
