// apps/web/src/components/dashboard/hooks/use-kpi-data.ts
'use client'

// Fetches the single-value aggregate (+ optional trend previous value) for the
// KPI and gauge widgets via `dashboard.kpiData`. Same store-sourced context and
// draft-preview behavior as `use-chart-data` — see that file's note. Gauge has
// no trend spec; the server derives `previousValue` only for KPIs with a bounded
// date range, so `previousValue` is simply absent for gauges.

import {
  type GaugeConfig,
  isChartConfigured,
  type KpiConfig,
  toChartQueryInput,
} from '@auxx/lib/dashboards/client'
import { keepPreviousData } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import { selectGlobalFilters, useDashboardStore } from '../stores/dashboard-draft-store'

export function useKpiData(configuration: KpiConfig | GaugeConfig, widgetId?: string) {
  const dashboardId = useDashboardStore((s) => s.dashboardId)
  const globalOverrides = useDashboardStore(selectGlobalFilters)
  const query = useMemo(() => toChartQueryInput(configuration), [configuration])

  return api.dashboard.kpiData.useQuery(
    { dashboardId: dashboardId ?? '', widgetId, query, globalOverrides },
    {
      enabled: Boolean(dashboardId) && isChartConfigured(configuration),
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  )
}
