// apps/web/src/components/dashboard/ui/config/data-source-section.tsx
'use client'

// The data-source row (plan 07): a ResourcePicker over entity defs + the three
// system-aggregate tables (thread/message/article). Every other registry system
// table (user/inbox/dataset/…) is excluded — the aggregate engine can't query
// them. Changing the source invalidates every field-bound setting (metric,
// group-by, filters, columns), so we confirm before resetting when any were set.

import type { WidgetSource } from '@auxx/lib/dashboards/client'
import { isSystemResource } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { ResourcePicker } from '~/components/pickers/resource-picker/resource-picker'
import { useResources } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import {
  isMailLensSourceId,
  isSystemAggregateSourceId,
  resourceIdToSource,
  sourceResourceId,
} from '../../lib/widget-source'

export function DataSourceSection({
  source,
  hasDependentConfig,
  excludeMailLensTables,
  onSelectSource,
}: {
  source: WidgetSource | undefined
  /** Whether any field-bound setting is set (drives the reset confirm). */
  hasDependentConfig: boolean
  /**
   * Drop `thread` / `message` from the offer list. Set by **every** data widget
   * body (via `DataSourceBlock`): both generic server paths a widget can take
   * refuse mail tables — rows through `record.listFiltered`
   * (`assertNotMailLensTable`) and aggregates through `prepareAggregate` — because
   * the metadata/subject/body lens lives only in `mail-query/`. Offering one
   * would produce a widget that can only render the unavailable state.
   */
  excludeMailLensTables?: boolean
  onSelectSource: (source: WidgetSource) => void
}) {
  const { resources } = useResources()
  const [confirm, ConfirmDialog] = useConfirm()

  // Hide registry system tables that aren't aggregate-queryable, plus the
  // mail-content tables when the caller can't serve rows from them.
  const excludeIds = useMemo(
    () =>
      resources
        .filter(
          (r) =>
            isSystemResource(r) &&
            (!isSystemAggregateSourceId(r.id) ||
              (excludeMailLensTables && isMailLensSourceId(r.id)))
        )
        .map((r) => r.id),
    [resources, excludeMailLensTables]
  )

  const handleSelect = async (id: string) => {
    if (sourceResourceId(source ?? ({} as WidgetSource)) === id) return
    if (hasDependentConfig) {
      const ok = await confirm({
        title: 'Change data source?',
        description:
          'The metric, category, series, filters and columns depend on the current source and will be cleared.',
        confirmText: 'Change source',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!ok) return
    }
    onSelectSource(resourceIdToSource(id))
  }

  return (
    <FieldPanelRow
      title='Data source'
      isRequired
      description='The records this widget charts — an object (Contacts, Tickets, Orders…) or a system table.'>
      <ConfirmDialog />
      <ResourcePicker
        value={source ? [sourceResourceId(source)] : []}
        onChange={() => {}}
        excludeIds={excludeIds}
        emptyLabel='Select a source…'
        triggerProps={{ className: 'w-full ps-0 pe-1' }}
        onSelectSingle={(id) => void handleSelect(id)}
      />
    </FieldPanelRow>
  )
}
