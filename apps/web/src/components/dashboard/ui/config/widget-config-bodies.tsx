// apps/web/src/components/dashboard/ui/config/widget-config-bodies.tsx
'use client'

// Per-kind config bodies (plan 07): each composes the shared sections (data
// source, metric, group-by, filters, global-date binding, appearance) for one
// widget kind. Explicit small components, not a settings-definition engine — the
// per-kind variation is a handful of rows. Every edit writes the whole config
// back via `onChange`; the store live-previews because the widget hooks key on
// the config object (plan 05). Only options the widgets actually consume are
// offered — no dead controls.

import { FieldType } from '@auxx/database/enums'
import type {
  BarChartConfig,
  DataWidgetConfig,
  GaugeConfig,
  IframeConfig,
  KpiConfig,
  LineChartConfig,
  PieChartConfig,
  RecordListConfig,
  TrendCompare,
  WidgetConfiguration,
  WidgetFieldRef,
  WidgetSource,
} from '@auxx/lib/dashboards/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Section } from '@auxx/ui/components/section'
import { Database, Palette } from 'lucide-react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { ColumnsRow } from './columns-row'
import { ConfigFieldRow } from './config-field-row'
import { DataSourceSection } from './data-source-section'
import { FieldRefRow } from './field-ref-picker'
import { FiltersSection } from './filters-section'
import { GroupBySection } from './group-by-section'
import { MetricField } from './metric-field'
import { ColorRow, DateAxisFormatRow, GlobalDateBindingRow, RangeRows } from './style-section'
import { ValueFormatRow } from './value-format-dialog'

const RESIZE_ID = 'dashboard-widget-config'

/** Shared FieldPanel wrapper so every section shares one label-column width. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <FieldPanel orientation='responsive' breakpoint='md' resizeId={RESIZE_ID} className='p-0'>
      {children}
    </FieldPanel>
  )
}

/** True when any field-bound setting is set (drives the source-change reset confirm). */
function hasDependentConfig(config: DataWidgetConfig): boolean {
  const c = config as Record<string, unknown>
  const metric = c.metric as { fieldRef?: unknown } | undefined
  const groupBy = c.groupBy as { fieldRef?: unknown } | undefined
  const secondary = c.secondaryGroupBy as { fieldRef?: unknown } | undefined
  const filters = c.filters as unknown[] | undefined
  const columns = c.columns as unknown[] | undefined
  return Boolean(
    metric?.fieldRef ||
      groupBy?.fieldRef ||
      secondary?.fieldRef ||
      filters?.length ||
      columns?.length ||
      c.sort
  )
}

// ── Shared blocks ────────────────────────────────────────────────────────────

/** Source picker; renders nothing else until a source is chosen. */
function DataSourceBlock({
  config,
  onReset,
}: {
  config: DataWidgetConfig
  onReset: (source: WidgetSource) => void
}) {
  return (
    <DataSourceSection
      source={config.source}
      hasDependentConfig={hasDependentConfig(config)}
      onSelectSource={onReset}
    />
  )
}

// ── Chart bodies (bar / line / pie share metric + group-by) ──────────────────

function BarChartBody({
  config,
  update,
  onReset,
}: {
  config: BarChartConfig
  update: (patch: Partial<BarChartConfig>) => void
  onReset: (source: WidgetSource) => void
}) {
  const source = config.source
  return (
    <>
      <Section title='Data' icon={<Database className='size-3.5' />} collapsible={false}>
        <Panel>
          <DataSourceBlock config={config} onReset={onReset} />
          {source && (
            <>
              <MetricField
                source={source}
                metric={config.metric}
                onChange={(m) => update({ metric: m })}
              />
              {config.metric && (
                <ValueFormatRow
                  metric={config.metric}
                  value={config.valueFormat}
                  onChange={(v) => update({ valueFormat: v })}
                />
              )}
              <GroupBySection
                source={source}
                label='Category'
                description='The field that splits the data — each distinct value becomes one bar or slice.'
                isRequired
                groupBy={config.groupBy}
                onChange={(g) => update({ groupBy: g })}
              />
              <DateAxisFormatRow
                source={source}
                groupBy={config.groupBy}
                value={config.labelFormat}
                onChange={(v) => update({ labelFormat: v })}
              />
              <GroupBySection
                source={source}
                label='Series'
                description='Optionally split each bar into colored parts by a second field — one color + legend entry per value.'
                allowClear
                groupBy={config.secondaryGroupBy}
                onChange={(g) => update({ secondaryGroupBy: g })}
              />
              <GlobalDateBindingRow
                source={source}
                value={config.globalDateFieldRef}
                onChange={(ref) => update({ globalDateFieldRef: ref })}
              />
            </>
          )}
        </Panel>
      </Section>

      {source && (
        <FiltersSection
          source={source}
          filters={config.filters}
          onChange={(f) => update({ filters: f })}
        />
      )}

      {source && (
        <Section title='Appearance' icon={<Palette className='size-3.5' />} collapsible>
          <Panel>
            <ConfigFieldRow
              title='Orientation'
              description='Bars run vertically (columns) or horizontally.'
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: BAR_LAYOUT_OPTIONS }}
              value={config.layout ?? 'vertical'}
              onChange={(v) => update({ layout: v as 'vertical' | 'horizontal' })}
            />
            {config.secondaryGroupBy && (
              <SwitchRow
                title='Stacked'
                description='Stack the series into one bar instead of side-by-side.'
                value={config.stacked}
                onChange={(v) => update({ stacked: v })}
              />
            )}
            <SwitchRow
              title='Cumulative'
              description='Show a running total that adds up across categories.'
              value={config.cumulative}
              onChange={(v) => update({ cumulative: v })}
            />
            <SwitchRow
              title='Data labels'
              description='Print each value directly on the bar, point, or slice.'
              value={config.showDataLabels}
              onChange={(v) => update({ showDataLabels: v })}
            />
            <SwitchRow
              title='Legend'
              description='Show the color key for the series.'
              value={config.showLegend ?? true}
              onChange={(v) => update({ showLegend: v })}
            />
            <ColorRow value={config.color} onChange={(c) => update({ color: c })} />
          </Panel>
        </Section>
      )}
    </>
  )
}

function LineChartBody({
  config,
  update,
  onReset,
}: {
  config: LineChartConfig
  update: (patch: Partial<LineChartConfig>) => void
  onReset: (source: WidgetSource) => void
}) {
  const source = config.source
  return (
    <>
      <Section title='Data' icon={<Database className='size-3.5' />} collapsible={false}>
        <Panel>
          <DataSourceBlock config={config} onReset={onReset} />
          {source && (
            <>
              <MetricField
                source={source}
                metric={config.metric}
                onChange={(m) => update({ metric: m })}
              />
              {config.metric && (
                <ValueFormatRow
                  metric={config.metric}
                  value={config.valueFormat}
                  onChange={(v) => update({ valueFormat: v })}
                />
              )}
              <GroupBySection
                source={source}
                label='Category'
                description='The field that splits the data — each distinct value becomes one point along the axis.'
                isRequired
                groupBy={config.groupBy}
                onChange={(g) => update({ groupBy: g })}
              />
              <DateAxisFormatRow
                source={source}
                groupBy={config.groupBy}
                value={config.labelFormat}
                onChange={(v) => update({ labelFormat: v })}
              />
              <GroupBySection
                source={source}
                label='Series'
                description='Optionally split into one colored line per value of a second field.'
                allowClear
                groupBy={config.secondaryGroupBy}
                onChange={(g) => update({ secondaryGroupBy: g })}
              />
              <GlobalDateBindingRow
                source={source}
                value={config.globalDateFieldRef}
                onChange={(ref) => update({ globalDateFieldRef: ref })}
              />
            </>
          )}
        </Panel>
      </Section>

      {source && (
        <FiltersSection
          source={source}
          filters={config.filters}
          onChange={(f) => update({ filters: f })}
        />
      )}

      {source && (
        <Section title='Appearance' icon={<Palette className='size-3.5' />} collapsible>
          <Panel>
            <SwitchRow
              title='Area'
              description='Fill the space under the line.'
              value={config.area}
              onChange={(v) => update({ area: v })}
            />
            {config.secondaryGroupBy && (
              <SwitchRow
                title='Stacked'
                description='Stack the series instead of overlapping them.'
                value={config.stacked}
                onChange={(v) => update({ stacked: v })}
              />
            )}
            <SwitchRow
              title='Cumulative'
              description='Show a running total that adds up across categories.'
              value={config.cumulative}
              onChange={(v) => update({ cumulative: v })}
            />
            <SwitchRow
              title='Legend'
              description='Show the color key for the series.'
              value={config.showLegend ?? true}
              onChange={(v) => update({ showLegend: v })}
            />
            <ColorRow value={config.color} onChange={(c) => update({ color: c })} />
          </Panel>
        </Section>
      )}
    </>
  )
}

function PieChartBody({
  config,
  update,
  onReset,
}: {
  config: PieChartConfig
  update: (patch: Partial<PieChartConfig>) => void
  onReset: (source: WidgetSource) => void
}) {
  const source = config.source
  return (
    <>
      <Section title='Data' icon={<Database className='size-3.5' />} collapsible={false}>
        <Panel>
          <DataSourceBlock config={config} onReset={onReset} />
          {source && (
            <>
              <MetricField
                source={source}
                metric={config.metric}
                onChange={(m) => update({ metric: m })}
              />
              {config.metric && (
                <ValueFormatRow
                  metric={config.metric}
                  value={config.valueFormat}
                  onChange={(v) => update({ valueFormat: v })}
                />
              )}
              <GroupBySection
                source={source}
                label='Category'
                description='The field that splits the data — each distinct value becomes one slice.'
                isRequired
                groupBy={config.groupBy}
                onChange={(g) => update({ groupBy: g })}
              />
              <DateAxisFormatRow
                source={source}
                groupBy={config.groupBy}
                value={config.labelFormat}
                onChange={(v) => update({ labelFormat: v })}
              />
              <GlobalDateBindingRow
                source={source}
                value={config.globalDateFieldRef}
                onChange={(ref) => update({ globalDateFieldRef: ref })}
              />
            </>
          )}
        </Panel>
      </Section>

      {source && (
        <FiltersSection
          source={source}
          filters={config.filters}
          onChange={(f) => update({ filters: f })}
        />
      )}

      {source && (
        <Section title='Appearance' icon={<Palette className='size-3.5' />} collapsible>
          <Panel>
            <SwitchRow
              title='Donut'
              description='Show as a donut with a hollow center.'
              value={config.donut}
              onChange={(v) => update({ donut: v })}
            />
            {config.donut && (
              <SwitchRow
                title='Center total'
                description='Show the grand total in the middle of the donut.'
                value={config.showCenterTotal}
                onChange={(v) => update({ showCenterTotal: v })}
              />
            )}
            <SwitchRow
              title='Data labels'
              description='Print each value directly on the slice.'
              value={config.showDataLabels}
              onChange={(v) => update({ showDataLabels: v })}
            />
            <SwitchRow
              title='Legend'
              description='Show the color key for the slices.'
              value={config.showLegend ?? true}
              onChange={(v) => update({ showLegend: v })}
            />
            <ColorRow value={config.color} onChange={(c) => update({ color: c })} />
          </Panel>
        </Section>
      )}
    </>
  )
}

// ── KPI ──────────────────────────────────────────────────────────────────────

function KpiBody({
  config,
  update,
  onReset,
}: {
  config: KpiConfig
  update: (patch: Partial<KpiConfig>) => void
  onReset: (source: WidgetSource) => void
}) {
  const source = config.source
  return (
    <>
      <Section title='Data' icon={<Database className='size-3.5' />} collapsible={false}>
        <Panel>
          <DataSourceBlock config={config} onReset={onReset} />
          {source && (
            <>
              <MetricField
                source={source}
                metric={config.metric}
                onChange={(m) => update({ metric: m })}
              />
              {config.metric && (
                <ValueFormatRow
                  metric={config.metric}
                  value={config.valueFormat}
                  onChange={(v) => update({ valueFormat: v })}
                />
              )}
              <ConfigFieldRow
                title='Prefix'
                description='Text shown before the number, like $.'
                fieldType={FieldType.TEXT}
                value={config.prefix}
                onChange={(v) => update({ prefix: (v as string) || undefined })}
                placeholder='$'
              />
              <ConfigFieldRow
                title='Suffix'
                description='Text shown after the number, like hrs or %.'
                fieldType={FieldType.TEXT}
                value={config.suffix}
                onChange={(v) => update({ suffix: (v as string) || undefined })}
                placeholder='hrs'
              />
              <GlobalDateBindingRow
                source={source}
                value={config.globalDateFieldRef}
                onChange={(ref) => update({ globalDateFieldRef: ref })}
              />
            </>
          )}
        </Panel>
      </Section>

      {source && (
        <Section
          title='Trend'
          collapsible
          showEnable
          enabled={!!config.trend}
          onEnableChange={(on) =>
            update({
              trend: on
                ? {
                    dateFieldRef: config.trend?.dateFieldRef ?? ('' as WidgetFieldRef),
                    compare: config.trend?.compare ?? 'previousPeriod',
                  }
                : undefined,
            })
          }>
          {config.trend && (
            <Panel>
              <FieldRefRow
                title='Date field'
                description='The date field used to define the current and prior periods.'
                isRequired
                source={source}
                value={config.trend.dateFieldRef || undefined}
                filterField={(f) => {
                  const ft = f.fieldType
                  return !!f.relationship || ft === 'DATE' || ft === 'DATETIME'
                }}
                onChange={(ref) =>
                  update({
                    trend: {
                      dateFieldRef: ref,
                      compare: config.trend?.compare ?? 'previousPeriod',
                    },
                  })
                }
              />
              <ConfigFieldRow
                title='Compare to'
                description='Compare against the previous period or the same period last year.'
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: TREND_COMPARE_OPTIONS }}
                value={config.trend.compare}
                onChange={(v) =>
                  config.trend && update({ trend: { ...config.trend, compare: v as TrendCompare } })
                }
              />
            </Panel>
          )}
        </Section>
      )}

      {source && (
        <FiltersSection
          source={source}
          filters={config.filters}
          onChange={(f) => update({ filters: f })}
        />
      )}
    </>
  )
}

// ── Gauge ──────────────────────────────────────────────────────────────────

function GaugeBody({
  config,
  update,
  onReset,
}: {
  config: GaugeConfig
  update: (patch: Partial<GaugeConfig>) => void
  onReset: (source: WidgetSource) => void
}) {
  const source = config.source
  return (
    <>
      <Section title='Data' icon={<Database className='size-3.5' />} collapsible={false}>
        <Panel>
          <DataSourceBlock config={config} onReset={onReset} />
          {source && (
            <>
              <MetricField
                source={source}
                metric={config.metric}
                onChange={(m) => update({ metric: m })}
              />
              {config.metric && (
                <ValueFormatRow
                  metric={config.metric}
                  value={config.valueFormat}
                  onChange={(v) => update({ valueFormat: v })}
                />
              )}
              <RangeRows
                min={config.rangeMin}
                max={config.rangeMax}
                maxRequired
                onChange={(p) => update(p)}
              />
              <GlobalDateBindingRow
                source={source}
                value={config.globalDateFieldRef}
                onChange={(ref) => update({ globalDateFieldRef: ref })}
              />
            </>
          )}
        </Panel>
      </Section>

      {source && (
        <FiltersSection
          source={source}
          filters={config.filters}
          onChange={(f) => update({ filters: f })}
        />
      )}

      {source && (
        <Section title='Appearance' icon={<Palette className='size-3.5' />} collapsible>
          <Panel>
            <SwitchRow
              title='Data labels'
              description='Print the value on the gauge.'
              value={config.showDataLabels}
              onChange={(v) => update({ showDataLabels: v })}
            />
            <ColorRow value={config.color} onChange={(c) => update({ color: c })} />
          </Panel>
        </Section>
      )}
    </>
  )
}

// ── Record list ──────────────────────────────────────────────────────────────

function RecordListBody({
  config,
  update,
  onReset,
}: {
  config: RecordListConfig
  update: (patch: Partial<RecordListConfig>) => void
  onReset: (source: WidgetSource) => void
}) {
  const source = config.source
  return (
    <>
      <Section title='Data' icon={<Database className='size-3.5' />} collapsible={false}>
        <Panel>
          <DataSourceSection
            source={config.source}
            hasDependentConfig={
              (config.columns?.length ?? 0) > 0 || !!config.sort || !!config.filters?.length
            }
            onSelectSource={onReset}
          />
          {source && (
            <>
              <ColumnsRow
                source={source}
                columns={config.columns ?? []}
                onChange={(cols) => update({ columns: cols })}
              />
              <FieldRefRow
                title='Sort by'
                description='The field the rows are ordered by.'
                source={source}
                value={config.sort?.fieldRef}
                onChange={(ref) =>
                  update({ sort: { fieldRef: ref, desc: config.sort?.desc ?? true } })
                }
                onClear={() => update({ sort: undefined })}
              />
              {config.sort && (
                <SwitchRow
                  title='Descending'
                  description='Largest or newest first.'
                  value={config.sort.desc}
                  onChange={(v) => config.sort && update({ sort: { ...config.sort, desc: v } })}
                />
              )}
              <ConfigFieldRow
                title='Rows'
                description='How many rows to show per page.'
                fieldType={FieldType.NUMBER}
                value={config.pageSize}
                onChange={(v) => update({ pageSize: v as number | undefined })}
                placeholder='10'
              />
              <GlobalDateBindingRow
                source={source}
                value={config.globalDateFieldRef}
                onChange={(ref) => update({ globalDateFieldRef: ref })}
              />
            </>
          )}
        </Panel>
      </Section>

      {source && (
        <FiltersSection
          source={source}
          filters={config.filters}
          onChange={(f) => update({ filters: f })}
        />
      )}
    </>
  )
}

// ── iframe ──────────────────────────────────────────────────────────────────

function IframeBody({
  config,
  update,
}: {
  config: IframeConfig
  update: (patch: Partial<IframeConfig>) => void
}) {
  return (
    <Section title='Embed' collapsible={false}>
      <Panel>
        <ConfigFieldRow
          title='URL'
          description='The page to embed — it must allow being shown in a frame.'
          fieldType={FieldType.TEXT}
          value={config.url ?? ''}
          onChange={(v) => update({ url: (v as string) || null })}
          placeholder='https://example.com/embed'
        />
      </Panel>
    </Section>
  )
}

// ── Options ──────────────────────────────────────────────────────────────────

const BAR_LAYOUT_OPTIONS: SelectOption[] = [
  { value: 'vertical', label: 'Vertical' },
  { value: 'horizontal', label: 'Horizontal' },
]

const TREND_COMPARE_OPTIONS: SelectOption[] = [
  { value: 'previousPeriod', label: 'Previous period' },
  { value: 'samePeriodLastYear', label: 'Same period last year' },
]

/** A boolean row (switch). Thin, kind-body-local — the ubiquitous appearance control. */
function SwitchRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string
  description?: string
  value: boolean | undefined
  onChange: (value: boolean) => void
}) {
  return (
    <ConfigFieldRow
      title={title}
      description={description}
      fieldType={FieldType.CHECKBOX}
      fieldOptions={{ variant: 'switch' }}
      value={!!value}
      onChange={(v) => onChange(Boolean(v))}
    />
  )
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export function WidgetConfigBody({
  config,
  onChange,
}: {
  config: WidgetConfiguration
  onChange: (config: WidgetConfiguration) => void
}) {
  const update = <C extends WidgetConfiguration>(patch: Partial<C>) =>
    onChange({ ...(config as C), ...patch })

  switch (config.kind) {
    case 'barChart':
      return (
        <BarChartBody
          config={config}
          update={(p) => update<BarChartConfig>(p)}
          onReset={(source) =>
            onChange({ kind: 'barChart', source, metric: { op: 'count' } } as BarChartConfig)
          }
        />
      )
    case 'lineChart':
      return (
        <LineChartBody
          config={config}
          update={(p) => update<LineChartConfig>(p)}
          onReset={(source) =>
            onChange({ kind: 'lineChart', source, metric: { op: 'count' } } as LineChartConfig)
          }
        />
      )
    case 'pieChart':
      return (
        <PieChartBody
          config={config}
          update={(p) => update<PieChartConfig>(p)}
          onReset={(source) =>
            onChange({ kind: 'pieChart', source, metric: { op: 'count' } } as PieChartConfig)
          }
        />
      )
    case 'kpi':
      return (
        <KpiBody
          config={config}
          update={(p) => update<KpiConfig>(p)}
          onReset={(source) => onChange({ kind: 'kpi', source, metric: { op: 'count' } })}
        />
      )
    case 'gauge':
      return (
        <GaugeBody
          config={config}
          update={(p) => update<GaugeConfig>(p)}
          onReset={(source) =>
            onChange({ kind: 'gauge', source, metric: { op: 'count' }, rangeMax: 100 })
          }
        />
      )
    case 'recordList':
      return (
        <RecordListBody
          config={config}
          update={(p) => update<RecordListConfig>(p)}
          onReset={(source) => onChange({ kind: 'recordList', source, columns: [] })}
        />
      )
    case 'iframe':
      return <IframeBody config={config} update={(p) => update<IframeConfig>(p)} />
    case 'richText':
      return (
        <div className='p-4 text-sm text-muted-foreground'>
          Rich-text content is edited directly in the widget.
        </div>
      )
  }
}
