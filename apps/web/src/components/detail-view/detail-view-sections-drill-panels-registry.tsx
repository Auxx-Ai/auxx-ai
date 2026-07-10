// apps/web/src/components/detail-view/detail-view-sections-drill-panels-registry.tsx
'use client'

// Per-entityType `drillPanels` for `layout: 'sections'` (dispatch M2 build
// spec §F.1/§F.3). `DetailViewSections` already accepts a `drillPanels` prop
// (pushed via the shared `panel`/`item` nuqs params) but `DetailView` didn't
// have a source to feed it from — this is that hookup point, the
// `detail-view-tab-registry.tsx` recipe: a plain `entityType → panels[]`
// lookup, code-split via `next/dynamic` so non-work_order pages never pull in
// the dispatch bundle.

import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import type {
  DetailViewSectionsDrillContext,
  DetailViewSectionsDrillPanel,
} from './detail-view-sections'

const DRILL_LOADING = () => <div className='p-6 text-sm text-muted-foreground'>Loading...</div>

const VisitsListPanel = dynamic(
  () => import('../dispatch/ui/job-schedule/visits-list-panel').then((m) => m.VisitsListPanel),
  { ssr: false, loading: DRILL_LOADING }
)
const VisitDetailPanel = dynamic(
  () => import('../dispatch/ui/job-schedule/visit-detail-panel').then((m) => m.VisitDetailPanel),
  { ssr: false, loading: DRILL_LOADING }
)

/** Back button + title — the `ProcedureDetailBar`/`agent-detail-tabs.tsx` shared-bar
 * pattern, kept inline (generic `@auxx/ui` primitives only) so this registry stays
 * a light, statically-imported hookup point (`detail-view.tsx` imports it eagerly). */
function DrillBackBar({ title }: { title: string }) {
  const { pop } = useNavStack()
  return (
    <div className='flex h-9 items-center gap-2 px-2'>
      <Button variant='ghost' size='icon-xs' className='rounded-md' onClick={() => pop()}>
        <ChevronLeft />
      </Button>
      <span className='text-sm font-medium'>{title}</span>
    </div>
  )
}

const DETAIL_VIEW_SECTIONS_DRILL_PANELS: Record<string, DetailViewSectionsDrillPanel[]> = {
  work_order: [
    {
      value: 'visits',
      bar: (ctx: DetailViewSectionsDrillContext) => (
        <DrillBackBar title={ctx.itemId ? 'Visit' : 'Visits'} />
      ),
      render: (ctx) => <VisitsListPanel {...ctx} />,
      renderItem: (ctx) => <VisitDetailPanel {...ctx} />,
    },
  ],
}

/** Drill panels registered for a `layout: 'sections'` entityType, or `[]`. */
export function getDetailViewSectionsDrillPanels(
  entityType: string
): DetailViewSectionsDrillPanel[] {
  return DETAIL_VIEW_SECTIONS_DRILL_PANELS[entityType] ?? []
}
