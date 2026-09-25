// apps/web/src/components/mrp/ui/part/mrp-settings-panel.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { MRP_BUFFER_MODES, type MrpBufferMode } from '@auxx/lib/mrp/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useSaveSystemValues } from '~/components/resources/hooks/use-save-system-values'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import { defaultLeadTimeFactor, formatQty } from './key-numbers'

const SETTING_ATTRIBUTES = [
  'part_mrp_buffer_mode',
  'part_build_lead_time_days',
  'part_build_cycle_days',
  'part_mrp_lead_time_factor',
  'part_mrp_variability_factor',
] as const

const BUFFER_MODE_LABELS: Record<MrpBufferMode, string> = {
  auto: 'Auto',
  buffered: 'Buffered',
  not_buffered: 'Not buffered',
}

const RESIZE_ID = 'part-mrp-settings'

function readNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function readOption(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : null
}

interface MrpSettingsPanelProps {
  partId: string
  recordId: RecordId
  runId: string | null
}

/** The part's `02` §4 planning fields; the run reads them, so edits show after the next run. */
export function MrpSettingsPanel({ partId, recordId, runId }: MrpSettingsPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const partItem = api.mrp.partItem.useQuery({ partId, runId })
  const { values } = useSystemValues(recordId, SETTING_ATTRIBUTES, { autoFetch: true })
  const { save, isPending } = useSaveSystemValues(recordId)

  const item = partItem.data?.item ?? null
  const part = partItem.data?.part ?? null
  const supplyType =
    item?.supplyType ??
    (part?.costSource === 'bom'
      ? 'made'
      : part?.costSource === 'vendor'
        ? 'bought'
        : (partItem.data?.bom.length ?? 0) > 0
          ? 'made'
          : 'unclassified')
  const made = supplyType === 'made'

  const mode = (readOption(values.part_mrp_buffer_mode) ?? 'auto') as MrpBufferMode
  const lead = readNumber(values.part_mrp_lead_time_factor)
  const variability = readNumber(values.part_mrp_variability_factor)

  const bufferOptions = MRP_BUFFER_MODES.map((value) => ({
    value,
    label:
      value === 'auto' && item
        ? `Auto (${item.proposedBuffered ? 'buffered' : 'not buffered'})`
        : BUFFER_MODE_LABELS[value],
  }))

  // With the field empty the run used its default, so the stored factor is that default.
  const ltfDefault =
    item?.leadTimeFactorSource === 'default'
      ? item.leadTimeFactor
      : defaultLeadTimeFactor(item?.decoupledLeadTimeDays)
  const vfDefault = item?.variabilityFactorSource === 'default' ? item.variabilityFactor : null
  const factorSummary = (value: number | null, fallback: number | null) =>
    value !== null
      ? formatQty(value)
      : fallback !== null
        ? `${formatQty(fallback)} (default)`
        : 'default'

  const saveNumber = (attribute: (typeof SETTING_ATTRIBUTES)[number]) => (value: unknown) =>
    void save({ [attribute]: typeof value === 'number' ? value : null })

  return (
    <Section title='Planning settings'>
      <FieldPanel resizeId={RESIZE_ID} defaultLabelWidth={150}>
        <FieldPanelRow
          title='Buffer mode'
          validationType='warning'
          validationError={
            mode === 'not_buffered' && supplyType === 'bought'
              ? 'A bought part that is not buffered: nothing will suggest ordering it.'
              : undefined
          }>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: bufferOptions }}
            value={mode}
            disabled={isPending}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            onChange={(value) => {
              const next = readOption(value)
              void save({ part_mrp_buffer_mode: next === 'auto' ? null : next })
            }}
          />
        </FieldPanelRow>
        {made ? (
          <>
            <FieldPanelRow title='Build lead time (days)'>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={readNumber(values.part_build_lead_time_days)}
                placeholder='Days to build once parts are on hand'
                onChange={saveNumber('part_build_lead_time_days')}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Build cycle (days)'>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={readNumber(values.part_build_cycle_days)}
                placeholder='Build in batches every N days'
                onChange={saveNumber('part_build_cycle_days')}
              />
            </FieldPanelRow>
          </>
        ) : null}
      </FieldPanel>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className='mt-2'>
        <CollapsibleTrigger asChild>
          <Button
            variant='ghost'
            size='xs'
            className={cn(
              'text-muted-foreground [&_svg]:transition-transform',
              advancedOpen && '[&_svg]:rotate-90'
            )}>
            <ChevronRight />
            Advanced: lead-time factor {factorSummary(lead, ltfDefault)} · variability{' '}
            {factorSummary(variability, vfDefault)}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className='pt-2'>
          <FieldPanel resizeId={RESIZE_ID} defaultLabelWidth={150}>
            <FieldPanelRow title='Lead-time factor'>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={lead}
                placeholder={ltfDefault !== null ? `${formatQty(ltfDefault)} (default)` : 'Default'}
                onChange={saveNumber('part_mrp_lead_time_factor')}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Variability factor'>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={variability}
                placeholder={vfDefault !== null ? `${formatQty(vfDefault)} (default)` : 'Default'}
                onChange={saveNumber('part_mrp_variability_factor')}
              />
            </FieldPanelRow>
          </FieldPanel>
        </CollapsibleContent>
      </Collapsible>
    </Section>
  )
}
