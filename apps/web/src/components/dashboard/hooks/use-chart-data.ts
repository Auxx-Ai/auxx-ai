// apps/web/src/components/dashboard/hooks/use-chart-data.ts
'use client'

// Fetches the aggregate result for a grouped chart widget (bar/line/pie) via
// `dashboard.chartData`. The dashboard id + effective global filters come from
// the draft store (the render site — `dashboard-detail-view` — is owned by the
// grid layer, so we read context from the store rather than prop-drilling).
//
// Draft-preview falls out for free: the query key includes the query projection,
// so editing DATA settings re-fetches with the draft config — but display-only
// edits (color/legend/valueFormat) project identically and DON'T re-fetch (see
// `toChartQueryInput`). `keepPreviousData` avoids skeleton flashes while
// tweaking; `isChartConfigured` gates the request so unconfigured shells never
// hit the server.

import {
  type ChartWidgetConfig,
  isChartConfigured,
  toChartQueryInput,
} from '@auxx/lib/dashboards/client'
import { keepPreviousData } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import { isMailLensSource } from '../lib/widget-source'
import { selectGlobalFilters, useDashboardStore } from '../stores/dashboard-draft-store'

export function useChartData(configuration: ChartWidgetConfig, widgetId?: string) {
  const dashboardId = useDashboardStore((s) => s.dashboardId)
  const globalOverrides = useDashboardStore(selectGlobalFilters)
  const query = useMemo(() => toChartQueryInput(configuration), [configuration])

  return api.dashboard.chartData.useQuery(
    { dashboardId: dashboardId ?? '', widgetId, query, globalOverrides },
    {
      // A stored mail-sourced widget is refused by `prepareAggregate`, so the
      // request is a guaranteed 403 — the body renders the unavailable state off
      // the config alone and never needs the answer.
      enabled:
        Boolean(dashboardId) &&
        isChartConfigured(configuration) &&
        !isMailLensSource(configuration.source),
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  )
}
