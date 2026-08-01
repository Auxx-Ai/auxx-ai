// apps/web/src/components/dynamic-table/components/calendar/use-calendar-events.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getOptionColorHex } from '@auxx/lib/custom-fields/client'
import { formatToDisplayValue, formatToRawValue } from '@auxx/lib/field-values/client'
import type { DroppedFilterNotice, ResourceField } from '@auxx/lib/resources/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { toResourceFieldId } from '@auxx/types/field'
import type { TypedFieldValue } from '@auxx/types/field-value'
import type { EventCalendarItem } from '@auxx/ui/components/event-calendar'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { DateRange } from '~/components/calendar/core/use-calendar-range'
import { useResource, useResourceFields } from '~/components/resources'
import { fieldValueFetchQueue } from '~/components/resources/store/field-value-fetch-queue'
import {
  buildFieldValueKey,
  type StoredFieldValue,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { api } from '~/trpc/react'
import type { CalendarViewConfig } from '../../types'

/** `record.listFiltered` caps `limit` at 500 (router); this bounds the drain
 * loop itself — a month denser than 5000 records goes unfetched past the cap rather
 * than looping forever. */
const PAGE_LIMIT = 500
const MAX_PAGES = 10

/**
 * `after`/`before` are strict `>`/`<` on `FieldValue.valueDate`
 * (`entity-condition-builder.ts`), not inclusive — a naive `[range.from, range.to]`
 * window silently drops records that land exactly on a month boundary at midnight.
 * Widen by 1ms on each side so the boundary instants are included.
 */
function buildRangeFilterGroup(dateFieldId: string, range: DateRange): ConditionGroup {
  const after = new Date(range.from.getTime() - 1).toISOString()
  const before = new Date(range.to.getTime() + 1).toISOString()
  return {
    id: 'calendar-range',
    logicalOperator: 'AND',
    conditions: [
      { id: 'calendar-range-after', fieldId: dateFieldId, operator: 'after', value: after },
      { id: 'calendar-range-before', fieldId: dateFieldId, operator: 'before', value: before },
    ],
  }
}

/** Stable empty array — a fresh `[]` per render would churn every consumer's memo. */
const NO_DROPPED_CONDITIONS: DroppedFilterNotice[] = []

/** One page's slice of the dropped-filter report, as `record.listFiltered` returns it. */
type DroppedFilterPage = {
  droppedConditions?: DroppedFilterNotice[]
  droppedConditionCount?: number
}

/**
 * Fold the per-page dropped-filter reports the drain loop collects into one.
 *
 * Every page compiles the SAME filters against the same fields, so every page
 * reports the same drops — but this does not *assume* that. Concatenating would
 * turn one ignored filter into "10 filters ignored" purely as a function of how
 * many pages the month needed, which is the same class of wrong number the
 * notice exists to stop, so notices are deduped by `conditionId`.
 *
 * The count is the MAX rather than a sum for the matching reason: each page's
 * `droppedConditionCount` is already that page's UNCAPPED total, so summing
 * would multiply it — and the max still exceeds the deduped array whenever the
 * server cap truncated the notices.
 */
export function mergeDroppedFilterPages(pages: DroppedFilterPage[]): {
  droppedConditions: DroppedFilterNotice[]
  droppedConditionCount: number
} {
  const byConditionId = new Map<string, DroppedFilterNotice>()
  let droppedConditionCount = 0

  for (const page of pages) {
    for (const dropped of page.droppedConditions ?? []) {
      if (!byConditionId.has(dropped.conditionId)) byConditionId.set(dropped.conditionId, dropped)
    }
    droppedConditionCount = Math.max(droppedConditionCount, page.droppedConditionCount ?? 0)
  }

  return { droppedConditions: [...byConditionId.values()], droppedConditionCount }
}

/**
 * Record ids on the calendar's date axis within `range`, honoring the view's own saved
 * filters (`viewFilters`) plus an injected range condition group. Pure `(entityDefinitionId,
 * config, range, viewFilters) → { ids, isLoading }` — extractable per plan §5 (a records-view
 * "source" for the personal calendar would reuse this shape unchanged).
 *
 * A range query doesn't fit `useRecordList`'s infinite-query shape (the range itself changes
 * under the cursor), so this drains `record.listFiltered` offset pages directly — which is
 * also why the dropped-filter report has to be **aggregated** here rather than read off one
 * page; see the drain loop.
 *
 * The injected range group matters for the report: if `after`/`before` on the configured date
 * field ever fail to compile, every record on the axis shows regardless of the month being
 * viewed. That is the one drop on this surface a user would otherwise read as a data bug.
 */
export function useCalendarRecordIds(
  entityDefinitionId: string | undefined,
  config: CalendarViewConfig | undefined,
  range: DateRange,
  viewFilters: ConditionGroup[]
): {
  ids: string[]
  isLoading: boolean
  droppedConditions: DroppedFilterNotice[]
  droppedConditionCount: number
} {
  const utils = api.useUtils()
  const dateFieldId = config?.dateFieldId

  const filters = useMemo(() => {
    if (!dateFieldId) return []
    return [...viewFilters, buildRangeFilterGroup(dateFieldId, range)]
  }, [viewFilters, dateFieldId, range])

  // Deterministic key — `filters` is plain JSON-serializable condition data, and `range` is
  // reduced to timestamps so an unchanged (quantized, debounced) range doesn't churn the key.
  const query = useQuery({
    queryKey: [
      'calendar-record-ids',
      entityDefinitionId,
      range.from.getTime(),
      range.to.getTime(),
      JSON.stringify(filters),
    ],
    queryFn: async () => {
      const ids: string[] = []
      // Collected per page and folded once — see `mergeDroppedFilterPages` for
      // why this dedupes rather than concatenates.
      const droppedPages: DroppedFilterPage[] = []
      let offset = 0
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await utils.record.listFiltered.fetch({
          entityDefinitionId: entityDefinitionId as string,
          filters,
          limit: PAGE_LIMIT,
          offset,
        })
        ids.push(...result.ids)
        droppedPages.push(result)
        if (!result.hasMore) break
        offset += result.ids.length
      }
      return { ids, ...mergeDroppedFilterPages(droppedPages) }
    },
    enabled: Boolean(entityDefinitionId && dateFieldId),
    staleTime: 30_000,
  })

  return {
    ids: query.data?.ids ?? [],
    isLoading: query.isFetching,
    droppedConditions: query.data?.droppedConditions ?? NO_DROPPED_CONDITIONS,
    droppedConditionCount: query.data?.droppedConditionCount ?? 0,
  }
}

/**
 * Read-path top-level hook: drains ids for `range` (`useCalendarRecordIds`), hydrates the
 * configured fields through the shared field-value fetch queue (kanban's exact
 * `queueFetchBatch` pattern — idempotent, so re-running this effect on every render is a
 * no-op once cached), and maps to `EventCalendarItem[]`. Chips read from the zustand
 * field-value store, so optimistic drag writes (`calendar-view-body.tsx`'s
 * `onEventDrop`, plan §3.3) and realtime patches repaint for free.
 */
export function useCalendarEvents(
  entityDefinitionId: string | undefined,
  config: CalendarViewConfig | undefined,
  range: DateRange,
  viewFilters: ConditionGroup[]
): {
  events: EventCalendarItem[]
  isLoading: boolean
  /** The resolved date-axis field — Phase 3 writes reuse this for `fieldType`
   *  instead of re-deriving it from `useResourceFields`. */
  dateField: ResourceField | undefined
  /** The resolved end-date field, if `config.endDateFieldId` is set. */
  endField: ResourceField | undefined
  /**
   * Filter conditions the server could not compile, deduped across the drained
   * pages. Non-empty ⇒ the calendar is showing MORE than the view's filters (or
   * the month window) ask for.
   */
  droppedConditions: DroppedFilterNotice[]
  /** Uncapped total behind {@link droppedConditions}. */
  droppedConditionCount: number
} {
  const { fields } = useResourceFields(entityDefinitionId)
  const { resource } = useResource(entityDefinitionId)

  const { ids, isLoading, droppedConditions, droppedConditionCount } = useCalendarRecordIds(
    entityDefinitionId,
    config,
    range,
    viewFilters
  )

  const dateField = useMemo(
    () => fields?.find((f) => f.id === config?.dateFieldId),
    [fields, config?.dateFieldId]
  )
  const endField = useMemo(
    () => fields?.find((f) => f.id === config?.endDateFieldId),
    [fields, config?.endDateFieldId]
  )
  const colorField = useMemo(
    () => fields?.find((f) => f.id === config?.colorFieldId),
    [fields, config?.colorFieldId]
  )

  // Title field: view config's `primaryFieldId`, else the entity's own identity/primary
  // display field (kanban's `primaryFieldId` derivation precedent, `kanban-view-body.tsx`).
  const primaryFieldId = config?.primaryFieldId ?? resource?.display.primaryDisplayField?.id
  const primaryField = useMemo(
    () => fields?.find((f) => f.id === primaryFieldId),
    [fields, primaryFieldId]
  )

  const fieldIdsToHydrate = useMemo(() => {
    const ordered = [
      config?.dateFieldId,
      config?.endDateFieldId,
      config?.colorFieldId,
      primaryFieldId,
    ].filter((id): id is string => Boolean(id))
    return [...new Set(ordered)]
  }, [config?.dateFieldId, config?.endDateFieldId, config?.colorFieldId, primaryFieldId])

  // Hydration — queue field-value fetches for every returned id × configured field
  // (kanban-view-body.tsx:102-118's exact pattern). `queueFetchBatch` is a no-op for
  // keys already cached/in-flight, so this effect re-running on every render (ids is a new
  // array each query resolution, not every render) never storms requests.
  useEffect(() => {
    if (!entityDefinitionId || fieldIdsToHydrate.length === 0 || ids.length === 0) return
    fieldValueFetchQueue.queueFetchBatch(
      ids.flatMap((id) =>
        fieldIdsToHydrate.map((fieldId) => ({
          recordId: toRecordId(entityDefinitionId, id),
          fieldRef: toResourceFieldId(entityDefinitionId, fieldId),
        }))
      )
    )
  }, [entityDefinitionId, ids, fieldIdsToHydrate])

  // One shallow-compared selector across every (record, field) pair the calendar needs —
  // mirrors `useFieldValues`'s single-record pattern, extended to many records. Only
  // re-renders when one of these specific values changes, not on unrelated store writes.
  // The map MUST stay flat (`recordId:fieldId` → stored value): useShallow compares
  // top-level values by reference, so nested per-record objects (rebuilt every snapshot)
  // would fail equality every time — React's "getSnapshot should be cached" infinite loop.
  const storedValues = useFieldValueStore(
    useShallow((state) => {
      if (!entityDefinitionId) return {}
      const map: Record<string, StoredFieldValue | undefined> = {}
      for (const id of ids) {
        const recordId = toRecordId(entityDefinitionId, id)
        for (const fieldId of fieldIdsToHydrate) {
          const fieldRef = toResourceFieldId(entityDefinitionId, fieldId)
          map[`${id}:${fieldId}`] = state.values[buildFieldValueKey(recordId, fieldRef)]
        }
      }
      return map
    })
  )

  const events = useMemo<EventCalendarItem[]>(() => {
    if (!entityDefinitionId || !config?.dateFieldId) return []

    const result: EventCalendarItem[] = []
    for (const id of ids) {
      const stored = (fieldId: string | undefined) =>
        fieldId ? storedValues[`${id}:${fieldId}`] : undefined

      // Multi-value date fields: first row wins (plan §3.2 pt.4).
      const dateRaw = formatToRawValue(stored(config.dateFieldId), dateField?.fieldType ?? 'DATE')
      const dateValue = Array.isArray(dateRaw) ? dateRaw[0] : dateRaw
      if (dateValue == null) continue // defensive — the range filter already excludes these
      const start = new Date(dateValue as string)
      if (Number.isNaN(start.getTime())) continue

      let end = start
      if (config.endDateFieldId && endField) {
        const endRaw = formatToRawValue(stored(config.endDateFieldId), endField.fieldType)
        const endValue = Array.isArray(endRaw) ? endRaw[0] : endRaw
        if (endValue != null) {
          const candidateEnd = new Date(endValue as string)
          if (!Number.isNaN(candidateEnd.getTime()) && candidateEnd > start) end = candidateEnd
        }
      }

      let color: string | undefined
      if (config.colorFieldId && colorField) {
        const colorRaw = formatToRawValue(stored(config.colorFieldId), colorField.fieldType)
        // SINGLE_SELECT values are arrays (standing repo gotcha) — raw[0] ?? null.
        const colorValue = Array.isArray(colorRaw) ? (colorRaw[0] ?? null) : colorRaw
        const option = colorField.options?.options?.find(
          (o) => o.value === colorValue || o.id === colorValue
        )
        if (option?.color) color = getOptionColorHex(option.color)
      }

      // Title: primaryFieldId's display value (kanban-card.tsx:80-86 precedent — handles both
      // TypedFieldValue objects and raw scalars already in the store).
      let title = 'Untitled'
      const primaryValue = stored(primaryFieldId)
      if (primaryValue != null) {
        if (typeof primaryValue === 'object' && 'type' in primaryValue) {
          const formatted = formatToDisplayValue(
            primaryValue as TypedFieldValue,
            primaryField?.fieldType ?? 'TEXT'
          )
          if (typeof formatted === 'string' && formatted) title = formatted
        } else {
          title = String(primaryValue) || 'Untitled'
        }
      }

      // Field-level truth (`CustomField.options.includeTime`, `field-options.ts`) rather than
      // the fieldType-only approximation — a DATE field only renders all-day when it doesn't
      // also carry a time-of-day.
      const allDay = !dateField?.options?.includeTime

      result.push({ id, title, start, end, allDay, color })
    }
    return result
  }, [
    entityDefinitionId,
    config,
    ids,
    storedValues,
    dateField,
    endField,
    colorField,
    primaryFieldId,
    primaryField,
  ])

  return { events, isLoading, dateField, endField, droppedConditions, droppedConditionCount }
}
