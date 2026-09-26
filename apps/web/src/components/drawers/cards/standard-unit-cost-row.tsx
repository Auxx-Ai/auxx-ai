// apps/web/src/components/drawers/cards/standard-unit-cost-row.tsx
'use client'

import {
  type StandardCostSuggestion,
  suggestStandardCost,
} from '@auxx/lib/inventory/costing/client'
import { Button } from '@auxx/ui/components/button'
import { CurrencyInput, CurrencyInputField } from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency, parseMajorToMinor } from '@auxx/utils/currency'
import { useState } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { api } from '~/trpc/react'

const SOURCE_LABEL: Record<StandardCostSuggestion['source'], string> = {
  supplier: 'Supplier price',
  channel: 'Channel cost',
}

interface StandardUnitCostRowProps {
  partId: string
  currencyCode: string
  hasStandard: boolean
  /** A part with a BOM rolls its standard; typing one is the explicit "Set cost instead" (D-SC3). */
  hasBom: boolean
  purchaseCost: number | null | undefined
  channelCost: number | null | undefined
  onSaved?: () => void
}

/** A typed unit cost (106 §5, 09 D-SC2a): a first standard, or a replacement that revalues on hand. */
export function StandardUnitCostRow({
  partId,
  currencyCode,
  hasStandard,
  hasBom,
  purchaseCost,
  channelCost,
  onSaved,
}: StandardUnitCostRowProps) {
  const [overriding, setOverriding] = useState(false)
  // `undefined` = untouched, so the prefill (which may load after mount) still applies.
  const [draft, setDraft] = useState<number | null | undefined>(undefined)
  const [resetKey, setResetKey] = useState(0)
  const [revaluedMinor, setRevaluedMinor] = useState<number | null>(null)

  const utils = api.useUtils()
  const setStandardCost = api.builds.setStandardCost.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to set the unit cost', description: error.message }),
  })

  const suggestion = hasStandard ? null : suggestStandardCost(purchaseCost, channelCost)
  const prefill = !hasBom && suggestion ? suggestion.unitCost : undefined
  const value = draft === undefined ? (prefill ?? null) : draft

  const save = async () => {
    if (value == null) return
    try {
      const result = await setStandardCost.mutateAsync({
        partId,
        unitCost: value,
        overrideBom: hasBom || undefined,
      })
      setRevaluedMinor(result.revaluationPostedMinor)
      setDraft(undefined)
      setResetKey((key) => key + 1)
      setOverriding(false)
      await utils.builds.previewRoll.invalidate()
      onSaved?.()
    } catch {
      // onError above already surfaced the toast.
    }
  }

  if (hasBom && !overriding) {
    return (
      <FieldPanelRow title='Unit cost' description='Its standard comes from a roll of its BOM'>
        <div className='flex min-h-8 items-center gap-2 text-muted-foreground text-xs'>
          Rolls from its bill of materials
          <Button variant='ghost' size='xs' onClick={() => setOverriding(true)}>
            Set cost instead
          </Button>
        </div>
      </FieldPanelRow>
    )
  }

  const description = hasBom
    ? 'Set by hand: an org-wide roll leaves it alone'
    : hasStandard
      ? 'Replaces the standard and revalues stock on hand at the difference'
      : 'Values every waiting row at its own date. Zero is allowed'

  return (
    <FieldPanelRow title='Unit cost' description={description}>
      <div className='space-y-1'>
        <div className='flex min-h-8 items-center gap-2'>
          <div className='w-32'>
            {/* Save reads the typed text on every keystroke; the input itself commits only on blur. */}
            <CurrencyInput
              key={`${resetKey}-${prefill ?? ''}`}
              defaultValue={prefill}
              onValueChange={(next) => setDraft(next ?? null)}
              currencyCode={currencyCode}
              disabled={setStandardCost.isPending}>
              <InputGroup className='h-[28px] border-0 bg-transparent shadow-none ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-[0px] dark:bg-transparent'>
                <CurrencyInputField
                  placeholder='0.00'
                  className='ps-0 text-start placeholder:text-primary-400'
                  onInput={(e) => {
                    const text = e.currentTarget.value.trim()
                    setRevaluedMinor(null)
                    setDraft(text === '' ? null : parseMajorToMinor(text, currencyCode))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save()
                  }}
                />
              </InputGroup>
            </CurrencyInput>
          </div>
          <Button
            variant='outline'
            size='xs'
            disabled={value == null || value < 0}
            loading={setStandardCost.isPending}
            loadingText='Saving...'
            onClick={save}>
            Save
          </Button>
          {hasBom && (
            <Button variant='ghost' size='xs' onClick={() => setOverriding(false)}>
              Cancel
            </Button>
          )}
        </div>
        <SuggestionHint
          suggestion={suggestion}
          prefilled={prefill != null}
          currencyCode={currencyCode}
        />
        {revaluedMinor != null && revaluedMinor !== 0 && (
          <p className='text-muted-foreground text-xs tabular-nums'>
            Revalued stock on hand: {revaluedMinor > 0 ? '+' : ''}
            {formatCurrency(revaluedMinor, { currencyCode })}
          </p>
        )}
      </div>
    </FieldPanelRow>
  )
}

/** Where the prefill came from, and the other source when it differs (09 D-SC4). */
function SuggestionHint({
  suggestion,
  prefilled,
  currencyCode,
}: {
  suggestion: StandardCostSuggestion | null
  prefilled: boolean
  currencyCode: string
}) {
  if (!suggestion) return null
  const label = SOURCE_LABEL[suggestion.source]
  const parts = [
    prefilled
      ? `From ${label.toLowerCase()}`
      : `${label}: ${formatCurrency(suggestion.unitCost, { currencyCode })}`,
  ]
  if (suggestion.other) {
    const { source, unitCost } = suggestion.other
    parts.push(`${SOURCE_LABEL[source]}: ${formatCurrency(unitCost, { currencyCode })}`)
  }
  return <p className='text-muted-foreground text-xs tabular-nums'>{parts.join(' · ')}</p>
}
