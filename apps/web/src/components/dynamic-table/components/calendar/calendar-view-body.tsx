// apps/web/src/components/dynamic-table/components/calendar/calendar-view-body.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { toRecordId } from '@auxx/lib/resources/client'
import type { EventCalendarItem } from '@auxx/ui/components/event-calendar'
import { EventCalendar } from '@auxx/ui/components/event-calendar'
import { useCallback } from 'react'
import { useCalendarRange } from '~/components/calendar/core/use-calendar-range'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useTableConfig } from '../../context/table-config-context'
import { useViewMetadata } from '../../context/view-metadata-context'
import { useCalendarConfig, useTableFilters } from '../../stores/store-selectors'
import { useCalendarEvents } from './use-calendar-events'

/**
 * Calendar view body — read path (plan §3.2) + interactions (plan §3.3). Month
 * range (`useCalendarRange`, the dispatch board's shared shell hook) drives
 * `useCalendarEvents`'s range-scoped `record.listFiltered` query; returned ids
 * hydrate through the shared field-value store, so chips repaint for free on
 * optimistic drag writes and realtime patches.
 */
export function CalendarViewBody() {
  const { tableId, entityDefinitionId } = useTableConfig()
  const { onCardClick, onAddNew } = useViewMetadata()
  const calendarConfig = useCalendarConfig(tableId)
  const viewFilters = useTableFilters(tableId)
  const { saveBulkMultipleFields } = useSaveFieldValue()

  // Month only (plan §3.2 pt.1) — `weekStartsOn` doesn't affect the month window (it only
  // quantizes the week stream), so the hook's Monday default is fine unwired.
  const { date, setDate, range, handleRangeChange } = useCalendarRange('month')

  const { events, dateField, endField } = useCalendarEvents(
    entityDefinitionId,
    calendarConfig,
    range,
    viewFilters
  )

  // Drag to reschedule (plan §3.3) — `event` is the pre-drag original item (its
  // `start`/`end` are untouched), `newStart`/`newEnd` are the drop's computed,
  // duration-preserving position. Kanban's drag-write precedent has no
  // canEdit/permission gate; this mirrors that. `saveBulkMultipleFields` is
  // optimistic (setValueOptimistic → confirm/rollback + toastError on failure),
  // so the store repaints the chip immediately and rolls back on error without
  // any handling needed here.
  const handleEventDrop = useCallback(
    (event: EventCalendarItem, newStart: Date, newEnd: Date) => {
      if (!entityDefinitionId || !calendarConfig?.dateFieldId || !dateField?.fieldType) return

      const fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }> = [
        {
          fieldId: calendarConfig.dateFieldId,
          value: newStart,
          fieldType: dateField.fieldType as FieldType,
        },
      ]

      // Only shift the end field if this event actually had a real span — a
      // point-in-time chip (end === start) must not gain an end value it never had.
      const hadRealEnd = event.end.getTime() !== event.start.getTime()
      if (calendarConfig.endDateFieldId && endField?.fieldType && hadRealEnd) {
        fieldValues.push({
          fieldId: calendarConfig.endDateFieldId,
          value: newEnd,
          fieldType: endField.fieldType as FieldType,
        })
      }

      saveBulkMultipleFields([toRecordId(entityDefinitionId, event.id)], fieldValues)
    },
    [
      entityDefinitionId,
      calendarConfig?.dateFieldId,
      calendarConfig?.endDateFieldId,
      dateField,
      endField,
      saveBulkMultipleFields,
    ]
  )

  // Click empty day to create (plan §3.3) — prefill the date axis and hand off
  // to whatever create-dialog seam the host wired through `onAddNew`
  // (`records-view.tsx` stores presets and opens `EntityInstanceDialog`). Degrades
  // to a no-op when the host doesn't support presets (e.g. a future non-records
  // consumer of the calendar view), matching `onCardClick?.`'s optional-chain style.
  const handleSlotClick = useCallback(
    (startTime: Date) => {
      if (!calendarConfig?.dateFieldId) return
      onAddNew?.({ [calendarConfig.dateFieldId]: startTime })
    },
    [calendarConfig?.dateFieldId, onAddNew]
  )

  if (!calendarConfig?.dateFieldId) {
    return (
      <div className='flex items-center justify-center h-64 text-muted-foreground'>
        Calendar view requires a date field configuration.
      </div>
    )
  }

  return (
    // min-h-0 + overflow-hidden bound the flex chain so the virtualized month
    // stream gets a real scrollport instead of rendering at full stream height.
    <div className='flex flex-col relative h-full flex-1 min-h-0 overflow-hidden'>
      <EventCalendar
        date={date}
        view='month'
        onDateChange={setDate}
        onViewChange={() => {}}
        onRangeChange={handleRangeChange}
        events={events}
        onEventClick={(event) => onCardClick?.({ id: event.id })}
        onEventDrop={handleEventDrop}
        onSlotClick={handleSlotClick}
        hideToolbar
        className='flex-1 min-h-0'
      />
    </div>
  )
}
