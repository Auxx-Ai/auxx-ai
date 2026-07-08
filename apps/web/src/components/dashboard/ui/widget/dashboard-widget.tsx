// apps/web/src/components/dashboard/ui/widget/dashboard-widget.tsx
'use client'

// Top-level widget renderer: error boundary → card shell → content switch on
// `configuration.kind`. Prop-driven (selection + action handlers come from the
// parent; plan 08 wires them to the draft store). Every kind now renders a real
// body: richText/iframe locally, and the data-bound kinds (bar/line/pie via the
// `ChartWidget` container, KPI/gauge/recordList self-contained) fetch through
// plan 03's aggregate procedures.

import type { LayoutWidget, WidgetConfiguration } from '@auxx/lib/dashboards/client'
import { ChartWidget } from './chart-widget'
import { GaugeWidget } from './gauge-widget'
import { IframeWidget } from './iframe-widget'
import { KpiWidget } from './kpi-widget'
import { RecordListWidget } from './record-list-widget'
import { RichTextWidget } from './rich-text-widget'
import { WidgetCard } from './widget-card'
import { WidgetErrorBoundary } from './widget-error-boundary'

type DashboardWidgetProps = {
  widget: LayoutWidget
  isEditMode: boolean
  isSelected?: boolean
  onSelect?: () => void
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  /** Persist a config change (e.g. richText inline edits) — plan 08: `updateWidgetConfig`. */
  onConfigChange?: (config: WidgetConfiguration) => void
}

export function DashboardWidget({
  widget,
  isEditMode,
  isSelected,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onConfigChange,
}: DashboardWidgetProps) {
  // richText is edited inline in its body — no config drawer, so hide the pencil
  // and let card clicks reach the editor instead of opening a (nonexistent) panel.
  const hasConfigPanel = widget.type !== 'richText'

  return (
    <WidgetCard
      title={widget.title}
      kind={widget.type}
      isEditMode={isEditMode}
      isSelected={isSelected}
      hasConfigPanel={hasConfigPanel}
      onSelect={onSelect}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}>
      <WidgetErrorBoundary>
        <WidgetBody
          widget={widget}
          isEditMode={isEditMode}
          onEdit={onEdit}
          onConfigChange={onConfigChange}
        />
      </WidgetErrorBoundary>
    </WidgetCard>
  )
}

function WidgetBody({
  widget,
  isEditMode,
  onEdit,
  onConfigChange,
}: {
  widget: LayoutWidget
  isEditMode: boolean
  onEdit?: () => void
  onConfigChange?: (config: WidgetConfiguration) => void
}) {
  const config = widget.configuration

  switch (config.kind) {
    case 'richText':
      return (
        <RichTextWidget
          config={config}
          isEditMode={isEditMode}
          onChange={(content) => onConfigChange?.({ kind: 'richText', content })}
        />
      )

    case 'iframe':
      return <IframeWidget config={config} isEditMode={isEditMode} onConfigure={onEdit} />

    case 'barChart':
    case 'lineChart':
    case 'pieChart':
      return (
        <ChartWidget
          config={config}
          widgetId={widget.id}
          isEditMode={isEditMode}
          onConfigure={onEdit}
        />
      )

    case 'kpi':
      return (
        <KpiWidget
          config={config}
          widgetId={widget.id}
          isEditMode={isEditMode}
          onConfigure={onEdit}
        />
      )

    case 'gauge':
      return (
        <GaugeWidget
          config={config}
          widgetId={widget.id}
          isEditMode={isEditMode}
          onConfigure={onEdit}
        />
      )

    case 'recordList':
      return (
        <RecordListWidget
          config={config}
          widgetId={widget.id}
          isEditMode={isEditMode}
          onConfigure={onEdit}
        />
      )
  }
}
