// apps/web/src/components/dashboard/ui/widget/widget-dropped-filters.tsx
'use client'

import type { WidgetSource } from '@auxx/lib/dashboards/client'
import type { DroppedFilterNotice } from '@auxx/lib/resources/client'
import { DroppedFiltersNotice } from '~/components/dynamic-table/components/dropped-filters-notice'
import { useResourceFields } from '~/components/resources'

/** The entity def id / system table id a widget's source points at. */
function sourceId(source: WidgetSource | undefined): string {
  if (!source) return ''
  return source.kind === 'entity' ? source.entityDefinitionId : source.tableId
}

interface WidgetDroppedFiltersProps {
  /** The widget's data source — used only to name the offending field. */
  source: WidgetSource | undefined
  /** Server-capped conditions that produced no SQL. */
  droppedConditions: DroppedFilterNotice[] | undefined
  /** Uncapped total behind {@link droppedConditions}. */
  droppedConditionCount: number | undefined
}

/**
 * The aggregate engine's half of {@link DroppedFiltersNotice} — same primitive,
 * same wording, wrapped in the tiny footer strip the chart widgets already use
 * for "Top N shown".
 *
 * A widget's filters are STORED, so they outlive the fields they name; and
 * unlike a list, a chart or KPI that loses a filter does not show extra rows —
 * it shows a number that is simply too HIGH. `runAggregate` logs the drop but
 * the person reading the tile never sees the log, which is what this closes.
 *
 * Renders nothing in the overwhelmingly common clean case.
 */
export function WidgetDroppedFilters({
  source,
  droppedConditions,
  droppedConditionCount,
}: WidgetDroppedFiltersProps) {
  const { fields } = useResourceFields(sourceId(source))

  if (!droppedConditionCount) return null

  return (
    <div className='shrink-0 pt-1 text-center text-[10px] text-muted-foreground'>
      <DroppedFiltersNotice
        droppedConditions={droppedConditions ?? []}
        droppedConditionCount={droppedConditionCount}
        fields={fields}
      />
    </div>
  )
}
