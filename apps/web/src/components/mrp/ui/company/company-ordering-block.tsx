// apps/web/src/components/mrp/ui/company/company-ordering-block.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { MRP_ORDER_MODE_LABELS, MRP_ORDER_MODES, type MrpOrderMode } from '@auxx/lib/mrp/client'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useSaveSystemValues } from '~/components/resources/hooks/use-save-system-values'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import { formatDays } from '../part/key-numbers'

const ORDERING_ATTRIBUTES = [
  'company_order_mode',
  'company_order_cycle_days',
  'company_next_order_date',
] as const

const ORDER_MODE_OPTIONS = MRP_ORDER_MODES.map((value) => ({
  value,
  label: MRP_ORDER_MODE_LABELS[value],
}))

function readOption(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : null
}

/** The supplier's MRP ordering settings (07 §4.7, D28); its next order is `CompanyNextOrderBlock`. */
export function CompanyOrderingBlock({ entityInstanceId: supplierId, recordId }: DrawerTabProps) {
  const performance = api.mrp.supplierPerformance.useQuery({ supplierId })
  const { values } = useSystemValues(recordId, ORDERING_ATTRIBUTES, { autoFetch: true })
  const { save, isPending } = useSaveSystemValues(recordId)

  const data = performance.data
  const mode = (readOption(values.company_order_mode) ?? 'when_needed') as MrpOrderMode
  const cycle =
    typeof values.company_order_cycle_days === 'number' ? values.company_order_cycle_days : null
  const observed = data?.medianOrderIntervalDays ?? null

  return (
    <FieldPanel resizeId='company-mrp-ordering' defaultLabelWidth={150}>
      <FieldPanelRow title='Order mode'>
        <FieldInputAdapter
          fieldType={FieldType.SINGLE_SELECT}
          fieldOptions={{ options: ORDER_MODE_OPTIONS }}
          value={mode}
          disabled={isPending}
          triggerProps={{ className: 'w-full ps-0 pe-1' }}
          onChange={(value) => void save({ company_order_mode: readOption(value) })}
        />
      </FieldPanelRow>
      {mode === 'scheduled' ? (
        <>
          <FieldPanelRow title='Order cycle (days)'>
            <FieldInputAdapter
              fieldType={FieldType.NUMBER}
              value={cycle}
              placeholder='Order every N days'
              onChange={(value) =>
                void save({ company_order_cycle_days: typeof value === 'number' ? value : null })
              }
            />
          </FieldPanelRow>
          {/* Comparison only: the stated cycle is what the plan uses (02 D16). */}
          <FieldPanelRow
            title='Observed interval'
            description='Median days between this supplier’s purchase orders'>
            <span className='px-1 font-mono text-muted-foreground text-xs tabular-nums'>
              {observed === null
                ? 'not enough orders'
                : `${formatDays(observed)} over ${data?.orderCount ?? 0} orders`}
            </span>
          </FieldPanelRow>
          <FieldPanelRow title='Next order date'>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              value={values.company_next_order_date ?? null}
              placeholder='Last order plus the cycle'
              onChange={(value) => void save({ company_next_order_date: value ?? null })}
            />
          </FieldPanelRow>
        </>
      ) : null}
    </FieldPanel>
  )
}
