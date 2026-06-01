// apps/web/src/components/activity-log/hooks/use-audit-export.ts
// Wraps the audit export mutation (`export` for org, `exportAll` for super-admin):
// calls the server, turns the returned string content into a Blob, and triggers an
// anchor-click download. Surfaces the server's `truncated` flag as an error toast.

'use client'

import type { AuditCategory, AuditVisibility } from '@auxx/lib/audit-log/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import { api } from '~/trpc/react'

export interface AuditExportFilters {
  category?: AuditCategory
  from?: Date
  to?: Date
  organizationId?: string | null
  visibility?: AuditVisibility
}

/**
 * Returns `{ exportAudit, isExporting }`. `exportAudit(format)` downloads the current
 * filter selection as CSV or NDJSON for the given scope.
 */
export function useAuditExport(scope: 'org' | 'admin', filters: AuditExportFilters) {
  const [isExporting, setIsExporting] = useState(false)
  const exportOrg = api.auditLog.export.useMutation()
  const exportAll = api.auditLog.exportAll.useMutation()

  const exportAudit = useCallback(
    async (format: 'csv' | 'ndjson') => {
      setIsExporting(true)
      try {
        const res =
          scope === 'org'
            ? await exportOrg.mutateAsync({
                format,
                category: filters.category,
                from: filters.from,
                to: filters.to,
              })
            : await exportAll.mutateAsync({
                format,
                category: filters.category,
                organizationId: filters.organizationId,
                visibility: filters.visibility,
                from: filters.from,
                to: filters.to,
              })

        const blob = new Blob([res.content], { type: res.contentType })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.filename
        a.click()
        URL.revokeObjectURL(url)

        if (res.truncated) {
          toastError({
            title: 'Export truncated',
            description: `Hit the 10,000-row export cap (${res.count} rows). Narrow the date range to get the rest.`,
          })
        }
      } catch (error) {
        toastError({
          title: 'Export failed',
          description: error instanceof Error ? error.message : 'Could not export audit events.',
        })
      } finally {
        setIsExporting(false)
      }
    },
    [scope, filters, exportOrg, exportAll]
  )

  return { exportAudit, isExporting }
}
