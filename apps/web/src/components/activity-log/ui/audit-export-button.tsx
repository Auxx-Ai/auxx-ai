// apps/web/src/components/activity-log/ui/audit-export-button.tsx
// Export button with a small format menu (CSV default, NDJSON for SIEM). Sits in the
// SettingsPage button slot (org view) and the filter bar (super-admin view).

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ChevronDown, Download } from 'lucide-react'
import { type AuditExportFilters, useAuditExport } from '../hooks/use-audit-export'

interface AuditExportButtonProps {
  scope: 'org' | 'admin'
  filters: AuditExportFilters
}

/** Downloads the current filter selection as CSV or NDJSON. */
export function AuditExportButton({ scope, filters }: AuditExportButtonProps) {
  const { exportAudit, isExporting } = useAuditExport(scope, filters)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' loading={isExporting} loadingText='Exporting…'>
          <Download />
          Export
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={() => exportAudit('csv')}>Export as CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportAudit('ndjson')}>Export as NDJSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
