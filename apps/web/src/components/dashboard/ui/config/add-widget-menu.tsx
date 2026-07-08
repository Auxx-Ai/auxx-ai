// apps/web/src/components/dashboard/ui/config/add-widget-menu.tsx
'use client'

// The "+ Add widget" dropdown (plan 07): one first-class item per widget kind,
// grouped Charts / Content, each with an icon + one-line description. No two-step
// type→subtype dance — every chart kind is its own menu item. Used by the detail
// header button and the empty-tab CTA; on pick the caller adds the widget and
// opens the config panel on it (plan 06 mints the final id).
//
// Also reused (plan 09) as the "Change type" list inside the config panel's menu:
// `variant='inline'` drops the outer Dropdown+trigger so it nests in a
// DropdownMenuSub; `filterKind` hides incompatible targets; `currentKind` shows
// the source kind disabled.

import type { WidgetKind } from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  BarChart3,
  ChevronDown,
  Gauge,
  Globe,
  LineChart,
  type LucideIcon,
  PieChart,
  Plus,
  Sigma,
  Table2,
  Type,
} from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

export type WidgetKindMeta = {
  kind: WidgetKind
  label: string
  description: string
  icon: LucideIcon
}

/** Kind → lucide icon, shared with the config-panel header. */
export const WIDGET_KIND_ICONS: Record<WidgetKind, LucideIcon> = {
  barChart: BarChart3,
  lineChart: LineChart,
  pieChart: PieChart,
  kpi: Sigma,
  gauge: Gauge,
  recordList: Table2,
  richText: Type,
  iframe: Globe,
}

export const CHART_KINDS: WidgetKindMeta[] = [
  {
    kind: 'barChart',
    label: 'Bar chart',
    description: 'Compare a metric across categories',
    icon: BarChart3,
  },
  { kind: 'lineChart', label: 'Line chart', description: 'A metric over time', icon: LineChart },
  {
    kind: 'pieChart',
    label: 'Pie chart',
    description: 'Share of a total by category',
    icon: PieChart,
  },
  { kind: 'kpi', label: 'KPI', description: 'A single headline number with trend', icon: Sigma },
  { kind: 'gauge', label: 'Gauge', description: 'Progress toward a target', icon: Gauge },
  {
    kind: 'recordList',
    label: 'Record list',
    description: 'A filtered table of records',
    icon: Table2,
  },
]

export const CONTENT_KINDS: WidgetKindMeta[] = [
  { kind: 'richText', label: 'Rich text', description: 'Notes, headings, links', icon: Type },
  { kind: 'iframe', label: 'Embed', description: 'An external page by URL', icon: Globe },
]

function KindItem({
  meta,
  onAdd,
  isCurrent,
}: {
  meta: WidgetKindMeta
  onAdd: (kind: WidgetKind) => void
  isCurrent?: boolean
}) {
  const Icon = meta.icon
  return (
    <DropdownMenuItem
      disabled={isCurrent}
      className='items-start gap-2.5 py-2'
      onClick={() => onAdd(meta.kind)}>
      <Icon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
      <div className='flex flex-col'>
        <span className='text-sm'>
          {meta.label}
          {isCurrent && ' (current)'}
        </span>
        <span className='text-xs text-muted-foreground'>{meta.description}</span>
      </div>
    </DropdownMenuItem>
  )
}

/** The grouped kind items (no Dropdown wrapper) — shared by the menu + submenu. */
function WidgetKindList({
  onAdd,
  filterKind,
  currentKind,
}: {
  onAdd: (kind: WidgetKind) => void
  filterKind?: (kind: WidgetKind) => boolean
  currentKind?: WidgetKind
}) {
  const groups = [
    { label: 'Charts', kinds: CHART_KINDS },
    { label: 'Content', kinds: CONTENT_KINDS },
  ]
    .map((g) => ({ ...g, kinds: filterKind ? g.kinds.filter((m) => filterKind(m.kind)) : g.kinds }))
    .filter((g) => g.kinds.length > 0)

  return (
    <>
      {groups.map((group, i) => (
        <Fragment key={group.label}>
          {i > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
          {group.kinds.map((meta) => (
            <KindItem
              key={meta.kind}
              meta={meta}
              onAdd={onAdd}
              isCurrent={meta.kind === currentKind}
            />
          ))}
        </Fragment>
      ))}
    </>
  )
}

export function AddWidgetMenu({
  onAdd,
  trigger,
  align = 'end',
  variant = 'dropdown',
  filterKind,
  currentKind,
}: {
  onAdd: (kind: WidgetKind) => void
  trigger?: ReactNode
  align?: 'start' | 'center' | 'end'
  /** `'inline'` renders just the grouped items for nesting in a parent menu (plan 09). */
  variant?: 'dropdown' | 'inline'
  /** Return false to hide a kind — e.g. incompatible change-type targets. */
  filterKind?: (kind: WidgetKind) => boolean
  /** Rendered disabled with a "(current)" hint — the change-type source kind. */
  currentKind?: WidgetKind
}) {
  const list = <WidgetKindList onAdd={onAdd} filterKind={filterKind} currentKind={currentKind} />

  if (variant === 'inline') return list

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant='outline' size='sm'>
            <Plus />
            Add widget
            <ChevronDown />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className='w-64'>
        {list}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
